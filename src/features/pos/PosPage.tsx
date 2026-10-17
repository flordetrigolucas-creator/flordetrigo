import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  Barcode,
  Scale,
  Wifi,
  WifiOff,
  Trash2,
  QrCode,
  CreditCard,
  Banknote,
  Building2,
  ArrowLeft,
  RefreshCw,
  Tag,
  Usb,
} from 'lucide-react';
import { localDb, type OfflinePendingSaleItem } from '@/lib/offlineDb';
import { parsePosBarcode, buildScaleEan13Label, type ScaleBarcodeEncoding } from '@/features/pos/scaleBarcodeParser';
import { ScaleSerialService, type ScaleReading } from '@/features/pos/scaleSerialService';
import { Decimal, formatBRL, formatQuantity, lineTotal, SCALE, toDb } from '@/lib/decimal';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { ItemRow, PaymentMethod } from '@/types/database.types';

interface CartLine extends OfflinePendingSaleItem {
  lineId: string;
}

export function PosPage() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const profile = useAuthStore((s) => s.profile);

  const sellableItems = useLiveQuery(
    () => localDb.items.filter((i) => i.active && i.type !== 'INSUMO').toArray(),
    [],
    [],
  );
  const b2bCustomers = useLiveQuery(
    () => localDb.customers.where('customer_type').equals('B2B').toArray(),
    [],
    [],
  );
  const pendingOfflineSales = useLiveQuery(
    () => localDb.pendingSales.where('synced').equals(0).toArray(),
    [],
    [],
  );

  const [barcodeInput, setBarcodeInput] = useState('');
  const [scaleEncoding, setScaleEncoding] = useState<ScaleBarcodeEncoding>('WEIGHT_GRAMS');
  const [scaleReading, setScaleReading] = useState<ScaleReading>(() => ScaleSerialService.getLastReading());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountBrl, setDiscountBrl] = useState<number>(0);
  const [selectedB2bCustomerId, setSelectedB2bCustomerId] = useState<string>('');
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mantém foco automático no leitor de código de barras
  const focusScannerInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    focusScannerInput();
    const unsub = ScaleSerialService.subscribe(setScaleReading);
    return unsub;
  }, [focusScannerInput]);

  // Adiciona item ao carrinho (em gramas para pesados, em UN para unitários)
  const addItemToCart = useCallback((item: ItemRow, quantityBase: number) => {
    const unitPrice = item.sale_price ?? 0;
    const computedTotal = lineTotal({
      quantityBase,
      unitPrice,
      isWeighed: item.is_weighed,
    }).toNumber();

    setCart((prev) => [
      ...prev,
      {
        lineId: crypto.randomUUID(),
        item_id: item.id,
        sku: item.sku,
        name: item.name,
        is_weighed: item.is_weighed,
        quantity: toDb(quantityBase, SCALE.quantity),
        unit_price: unitPrice,
        total_price: computedTotal,
      },
    ]);
  }, []);

  // Processa leitura do scanner (EAN-13 balança prefixo 2, EAN comercial ou PLU rápido)
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    const parsed = parsePosBarcode(code);

    if (parsed.isScaleLabel) {
      const matched = sellableItems.find(
        (i) =>
          i.scale_plu === parsed.plu4 ||
          i.scale_plu === parsed.plu5 ||
          i.scale_plu?.padStart(4, '0') === parsed.plu4,
      );

      if (!matched) {
        toast.error(`PLU de balança (${parsed.plu4}) não encontrado no catálogo.`);
        setBarcodeInput('');
        return;
      }

      const { weightGrams, totalPriceBrl } = parsed.resolveForItem({
        salePricePerKg: matched.sale_price ?? 0,
        encoding: scaleEncoding,
      });

      addItemToCart(matched, weightGrams);
      toast.success(
        `Etiqueta Balança: ${matched.name} • ${(weightGrams / 1000).toFixed(3)} kg → ${formatBRL(totalPriceBrl)}`,
      );
      setBarcodeInput('');
      return;
    }

    // Código de barras comercial (EAN-13 / SKU / PLU direto)
    const matched = sellableItems.find(
      (i) => i.barcode === parsed.rawCode || i.sku.toLowerCase() === parsed.rawCode.toLowerCase() || i.scale_plu === parsed.rawCode,
    );

    if (!matched) {
      toast.error(`Código "${parsed.rawCode}" não localizado.`);
      setBarcodeInput('');
      return;
    }

    if (matched.is_weighed) {
      const grams = scaleReading.weightGrams > 0 ? scaleReading.weightGrams : 350;
      addItemToCart(matched, grams);
      toast.success(`${matched.name}: ${(grams / 1000).toFixed(3)} kg lidos da balança.`);
    } else {
      addItemToCart(matched, 1);
    }
    setBarcodeInput('');
  };

  // Totais com Decimal.js (Zero Float)
  const totals = useMemo(() => {
    const subtotal = cart.reduce((acc, line) => acc.plus(line.total_price), new Decimal(0));
    const discount = Decimal.min(Decimal.max(new Decimal(discountBrl || 0), 0), subtotal);
    const total = subtotal.minus(discount);
    return {
      subtotal: toDb(subtotal, SCALE.money),
      discount: toDb(discount, SCALE.money),
      total: toDb(total, SCALE.money),
    };
  }, [cart, discountBrl]);

  // Finalização de Venda (Offline-First no IndexedDB + tentativa de sync)
  const finalizeSale = useCallback(
    async (paymentMethod: PaymentMethod) => {
      if (cart.length === 0) {
        toast.error('Adicione itens ao cupom antes de finalizar.');
        return;
      }

      if (paymentMethod === 'FATURADO_B2B' && !selectedB2bCustomerId) {
        toast.error('Selecione o cliente corporativo B2B para faturar no boleto/ciclo.');
        return;
      }

      const offlineClientId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      let syncedWithSupabase: 0 | 1 = 0;

      if (isOnline) {
        const { error: rpcErr } = await supabase.rpc('record_pos_or_ai_sale', {
          p_origin: 'PDV_BALCAO',
          p_payment_method: paymentMethod,
          p_items: cart.map((c) => ({
            item_id: c.item_id,
            quantity: c.quantity,
            unit_price: c.unit_price,
          })),
          p_discount: totals.discount,
          p_customer_id: paymentMethod === 'FATURADO_B2B' ? selectedB2bCustomerId : null,
          p_offline_client_id: offlineClientId,
        });
        if (!rpcErr) {
          syncedWithSupabase = 1;
          await pullSupabaseToLocalCache();
        }
      }

      await localDb.transaction(
        'rw',
        [localDb.pendingSales, localDb.items, localDb.customers],
        async () => {
          if (syncedWithSupabase === 0) {
            if (paymentMethod === 'FATURADO_B2B') {
              const cust = await localDb.customers.get(selectedB2bCustomerId);
              if (!cust) throw new Error('Cliente B2B não encontrado.');
              const available = new Decimal(cust.credit_limit).minus(cust.current_balance_due);
              if (available.lt(totals.total)) {
                throw new Error(
                  `Limite B2B insuficiente para ${cust.name}. Disponível: ${formatBRL(available.toNumber())}`,
                );
              }
              await localDb.customers.update(cust.id, {
                current_balance_due: toDb(new Decimal(cust.current_balance_due).plus(totals.total), SCALE.money),
                updated_at: nowIso,
              });
            }

            for (const line of cart) {
              const current = await localDb.items.get(line.item_id);
              if (current) {
                await localDb.items.update(current.id, {
                  current_stock: toDb(new Decimal(current.current_stock).minus(line.quantity), SCALE.quantity),
                  updated_at: nowIso,
                });
              }
            }
          }

          await localDb.pendingSales.put({
            offline_client_id: offlineClientId,
            origin: 'PDV_BALCAO',
            customer_id: paymentMethod === 'FATURADO_B2B' ? selectedB2bCustomerId : null,
            cashier_id: profile?.id ?? 'aaaaaaaa-0000-4000-a000-000000000004',
            subtotal: totals.subtotal,
            discount: totals.discount,
            total: totals.total,
            payment_method: paymentMethod,
            fiscal_status: syncedWithSupabase === 1 ? 'EMITIDA' : 'CONTINGENCIA_OFFLINE',
            items: cart.map(({ lineId: _unused, ...rest }) => rest),
            created_at: nowIso,
            synced: syncedWithSupabase,
            sync_error: null,
          });
        },
      );

      setCart([]);
      setDiscountBrl(0);
      toast.success(
        `Venda concluída no ${paymentMethod} (${formatBRL(totals.total)}) • ${
          syncedWithSupabase === 1
            ? 'Sincronizada em tempo real com Supabase (Kardex + FEFO)'
            : 'Gravada em Contingência Offline (IndexedDB)'
        }`,
      );
      focusScannerInput();
    },
    [cart, selectedB2bCustomerId, totals, profile?.id, isOnline, focusScannerInput],
  );

  // Sincroniza fila offline com Supabase quando online via RPC idempotente
  const syncOfflineQueue = useCallback(async () => {
    if (pendingOfflineSales.length === 0) {
      toast.info('Fila de contingência já está 100% sincronizada.');
      return;
    }
    setIsSyncingQueue(true);
    try {
      for (const sale of pendingOfflineSales) {
        const { error } = await supabase.rpc('record_pos_or_ai_sale', {
          p_origin: sale.origin,
          p_payment_method: sale.payment_method,
          p_items: sale.items.map((i) => ({
            item_id: i.item_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
          })),
          p_discount: sale.discount,
          p_customer_id: sale.customer_id,
          p_offline_client_id: sale.offline_client_id,
        });
        if (!error) {
          await localDb.pendingSales.update(sale.offline_client_id, {
            synced: 1,
            fiscal_status: 'EMITIDA',
          });
        }
      }
      await pullSupabaseToLocalCache();
      toast.success(`${pendingOfflineSales.length} venda(s) da fila offline sincronizada(s) com o Supabase!`);
    } finally {
      setIsSyncingQueue(false);
    }
  }, [pendingOfflineSales]);

  // Atalhos globais de teclado do PDV (F1 a F12)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'F2':
          e.preventDefault();
          focusScannerInput();
          break;
        case 'F4': {
          e.preventDefault();
          const reading = ScaleSerialService.simulateWeightReading();
          toast.info(`Balança Simulada: ${reading.weightGrams} g (${reading.weightKg.toFixed(3)} kg)`);
          break;
        }
        case 'F6': {
          e.preventDefault();
          // Simula leitura de etiqueta EAN-13 prefixo 2 de Pão Francês (PLU 0101, 380g)
          const label = buildScaleEan13Label({ plu: '0101', payloadValue: 380 });
          setBarcodeInput(label);
          toast.info(`Etiqueta EAN-13 gerada no leitor: ${label} (Pressione Enter)`);
          focusScannerInput();
          break;
        }
        case 'F7':
          e.preventDefault();
          void finalizeSale('PIX');
          break;
        case 'F8':
          e.preventDefault();
          void finalizeSale('DEBITO');
          break;
        case 'F9':
          e.preventDefault();
          void finalizeSale('CREDITO');
          break;
        case 'F10':
          e.preventDefault();
          void finalizeSale('DINHEIRO');
          break;
        case 'F11':
          e.preventDefault();
          void finalizeSale('FATURADO_B2B');
          break;
        case 'F12':
          e.preventDefault();
          setCart([]);
          setDiscountBrl(0);
          toast.warning('Cupom limpo (F12).');
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusScannerInput, finalizeSale]);

  return (
    <div className="theme-pos flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Topbar de Missão Crítica */}
      <header className="flex items-center justify-between border-b border-white/20 bg-black px-5 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="border-white/30 bg-zinc-900 text-white hover:bg-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" /> Retaguarda ERP
          </Button>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide text-amber-400">
              PDV FLOR DO TRIGO • BALCÃO RÁPIDO
            </h1>
            <p className="text-xs text-zinc-400">
              Operador: {profile?.full_name} • Atalhos F2..F12 ativos
            </p>
          </div>
        </div>

        {/* Display Ao Vivo da Balança Serial + Conexão */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border-2 border-amber-400/60 bg-zinc-950 px-4 py-1.5">
            <Scale className="h-6 w-6 text-amber-400" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Balança ({scaleReading.source})
              </p>
              <p className="font-mono text-2xl font-extrabold text-amber-400">
                {scaleReading.weightKg.toFixed(3)} kg{' '}
                <span className="text-xs text-zinc-400">({scaleReading.weightGrams} g)</span>
              </p>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                const r = ScaleSerialService.simulateWeightReading();
                toast.success(`Peso simulado no prato: ${r.weightGrams}g`);
                focusScannerInput();
              }}
              title="Atalho: F4"
            >
              Simular Peso (F4)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 text-white"
              onClick={async () => {
                try {
                  await ScaleSerialService.connectHardwareScale();
                  toast.success('Balança serial conectada via Web Serial API!');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Falha na porta serial');
                }
              }}
            >
              <Usb className="h-4 w-4" /> Porta Serial
            </Button>
          </div>

          {/* Badge de Contingência Offline + Sincronização */}
          <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-zinc-900 px-3 py-2">
            {isOnline ? (
              <Badge variant="success" className="gap-1">
                <Wifi className="h-3.5 w-3.5" /> ONLINE
              </Badge>
            ) : (
              <Badge variant="warning" className="gap-1">
                <WifiOff className="h-3.5 w-3.5" /> CONTINGÊNCIA OFFLINE
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={isSyncingQueue}
              onClick={syncOfflineQueue}
              className="h-7 px-2 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingQueue ? 'animate-spin' : ''}`} />
              Fila ({pendingOfflineSales.length})
            </Button>
          </div>
        </div>
      </header>

      {/* Corpo do PDV */}
      <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden p-4">
        {/* Esquerda: Scanner EAN-13 + Teclado Touch de Produtos */}
        <div className="col-span-7 flex flex-col gap-4 overflow-hidden">
          <form onSubmit={handleBarcodeSubmit} className="space-y-2 rounded-2xl border-2 border-amber-400 bg-zinc-900 p-4">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-amber-400">
                <Barcode className="h-4 w-4" /> Leitor EAN-13 / Etiqueta Balança (Prefixo 2) / PLU (F2)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setScaleEncoding((m) => (m === 'WEIGHT_GRAMS' ? 'TOTAL_PRICE_CENTS' : 'WEIGHT_GRAMS'))
                  }
                  className="rounded border border-white/20 bg-zinc-800 px-2 py-0.5 text-[11px] font-mono text-amber-300"
                >
                  Modo Etiqueta 2: {scaleEncoding === 'WEIGHT_GRAMS' ? '5 díg = PESO (g)' : '5 díg = VALOR (R$)'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const label = buildScaleEan13Label({
                      plu: '0101',
                      payloadValue: scaleEncoding === 'WEIGHT_GRAMS' ? 380 : 642,
                    });
                    setBarcodeInput(label);
                    focusScannerInput();
                  }}
                  className="inline-flex items-center gap-1 rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-300 hover:bg-amber-400/30"
                >
                  <Tag className="h-3 w-3" /> Gerar Etiqueta Pão 380g (F6)
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Bipe a etiqueta EAN-13 (ex: 2010100038009) ou digite o PLU..."
                className="h-14 border-2 border-white/30 bg-black font-mono text-2xl font-bold text-white placeholder:text-zinc-600"
              />
              <Button type="submit" size="xl" className="shrink-0">
                Lançar
              </Button>
            </div>
          </form>

          {/* Grade Touch Screen de Produtos Rápidos */}
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              {sellableItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.is_weighed) {
                      const grams = scaleReading.weightGrams > 0 ? scaleReading.weightGrams : 350;
                      addItemToCart(item, grams);
                    } else {
                      addItemToCart(item, 1);
                    }
                    focusScannerInput();
                  }}
                  className="touch-target flex flex-col justify-between rounded-2xl border-2 border-white/20 bg-zinc-900 p-4 text-left transition hover:border-amber-400 hover:bg-zinc-800 active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-zinc-400">
                      {item.scale_plu ? `PLU ${item.scale_plu}` : item.sku}
                    </span>
                    <Badge variant={item.is_weighed ? 'default' : 'secondary'} className="text-[10px]">
                      {item.is_weighed ? 'BALANÇA (KG)' : 'UNIDADE'}
                    </Badge>
                  </div>
                  <p className="my-2 line-clamp-2 text-base font-extrabold text-white">{item.name}</p>
                  <div className="flex items-baseline justify-between border-t border-white/10 pt-2">
                    <span className="text-xs text-zinc-400">
                      Est: {formatQuantity(item.current_stock, item.base_unit)}
                    </span>
                    <span className="font-mono text-lg font-extrabold text-amber-400">
                      {formatBRL(item.sale_price ?? 0)}
                      {item.is_weighed ? '/kg' : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Direita: Cupom Fiscal & Finalizadores de Pagamento */}
        <div className="col-span-5 flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-white/25 bg-zinc-950 p-4">
          <div className="flex items-center justify-between border-b border-white/15 pb-3">
            <span className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              Cupom de Venda ({cart.length} itens)
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCart([])}
              className="h-8 text-xs text-red-400 hover:bg-red-950/50"
            >
              <Trash2 className="h-4 w-4" /> Limpar (F12)
            </Button>
          </div>

          {/* Lista de Itens do Cupom */}
          <div className="my-3 flex-1 space-y-2 overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
                <Barcode className="mb-2 h-12 w-12 opacity-40" />
                <p className="text-base font-semibold">Caixa Livre</p>
                <p className="text-xs">Bipe um código de barras, pressione F6 ou toque em um produto.</p>
              </div>
            ) : (
              cart.map((line, index) => (
                <div
                  key={line.lineId}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-bold text-white">
                      {index + 1}. {line.name}
                    </p>
                    <p className="font-mono text-xs text-zinc-400">
                      {line.is_weighed
                        ? `${(line.quantity / 1000).toFixed(3)} kg × ${formatBRL(line.unit_price)}/kg`
                        : `${line.quantity} un × ${formatBRL(line.unit_price)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-lg font-extrabold text-amber-400">
                      {formatBRL(line.total_price)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCart((c) => c.filter((i) => i.lineId !== line.lineId))}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totalizador Gigante + Meios de Pagamento */}
          <div className="space-y-3 border-t border-white/20 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold uppercase text-zinc-400">Desconto (R$)</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={discountBrl || ''}
                  onChange={(e) => setDiscountBrl(Number(e.target.value))}
                  className="h-9 bg-zinc-900 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase text-zinc-400">
                  Conta Corporativa (Faturado B2B)
                </label>
                <select
                  value={selectedB2bCustomerId}
                  onChange={(e) => setSelectedB2bCustomerId(e.target.value)}
                  className="h-9 w-full rounded-md border border-white/25 bg-zinc-900 px-2 text-xs text-white"
                >
                  <option value="">Balcão Consumidor Final</option>
                  {b2bCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Disp: {formatBRL(c.credit_limit - c.current_balance_due)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-baseline justify-between rounded-2xl bg-black px-4 py-3">
              <span className="text-sm font-bold uppercase tracking-wider text-zinc-400">Total a Pagar</span>
              <span className="font-mono text-pos-total text-amber-400">{formatBRL(totals.total)}</span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              <Button
                size="xl"
                className="flex-col gap-1 bg-emerald-500 px-2 text-black hover:bg-emerald-400"
                onClick={() => finalizeSale('PIX')}
              >
                <QrCode className="h-5 w-5" />
                <span className="text-xs font-extrabold">PIX (F7)</span>
              </Button>
              <Button
                size="xl"
                className="flex-col gap-1 bg-sky-500 px-2 text-black hover:bg-sky-400"
                onClick={() => finalizeSale('DEBITO')}
              >
                <CreditCard className="h-5 w-5" />
                <span className="text-xs font-extrabold">DÉB (F8)</span>
              </Button>
              <Button
                size="xl"
                className="flex-col gap-1 bg-indigo-500 px-2 text-white hover:bg-indigo-400"
                onClick={() => finalizeSale('CREDITO')}
              >
                <CreditCard className="h-5 w-5" />
                <span className="text-xs font-extrabold">CRÉD (F9)</span>
              </Button>
              <Button
                size="xl"
                className="flex-col gap-1 bg-amber-400 px-2 text-black hover:bg-amber-300"
                onClick={() => finalizeSale('DINHEIRO')}
              >
                <Banknote className="h-5 w-5" />
                <span className="text-xs font-extrabold">DIN (F10)</span>
              </Button>
              <Button
                size="xl"
                className="flex-col gap-1 bg-purple-500 px-2 text-white hover:bg-purple-400"
                onClick={() => finalizeSale('FATURADO_B2B')}
              >
                <Building2 className="h-5 w-5" />
                <span className="text-xs font-extrabold">B2B (F11)</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

