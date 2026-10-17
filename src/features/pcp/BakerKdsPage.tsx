import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  ChefHat,
  Flame,
  Play,
  CheckCircle2,
  BellRing,
  Scale,
  AlertTriangle,
  PlusCircle,
} from 'lucide-react';
import { localDb } from '@/lib/offlineDb';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { computeTechnicalSheetMetrics } from '@/features/pcp/bakersMath';
import { executeCompleteProductionOrder } from '@/features/pcp/pcpService';
import { formatBRL, formatPercent, formatQuantity } from '@/lib/decimal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { ProductionStatus } from '@/types/database.types';

const QUICK_FLOUR_PRESETS_KG = [10, 15, 25, 35, 50, 75] as const;

export function BakerKdsPage() {
  const sheets = useLiveQuery(() => localDb.technicalSheets.toArray(), [], []);
  const sheetItems = useLiveQuery(() => localDb.technicalSheetItems.toArray(), [], []);
  const items = useLiveQuery(() => localDb.items.toArray(), [], []);
  const orders = useLiveQuery(
    () => localDb.productionOrders.orderBy('order_number').reverse().toArray(),
    [],
    [],
  );
  const openAlerts = useLiveQuery(
    () => localDb.productionAlerts.filter((a) => !a.acknowledged_at).toArray(),
    [],
    [],
  );

  // Estado da Calculadora de Masseira
  const [selectedSheetId, setSelectedSheetId] = useState<string>('40000000-0000-4000-a000-000000000001');
  const [desiredFlourKg, setDesiredFlourKg] = useState<number>(15); // Ex.: 15kg = fator 0.3 sobre 50kg
  const [opNotes, setOpNotes] = useState<string>('Fornada programada — Masseira Espiral 01');

  // Estado do Modal/Painel de Finalização Atômica de OP
  const [finishingOrderId, setFinishingOrderId] = useState<string | null>(null);
  const [actualYieldInput, setActualYieldInput] = useState<string>('');
  const [damagedInput, setDamagedInput] = useState<string>('0');
  const [isSubmittingRpc, setIsSubmittingRpc] = useState(false);

  const selectedSheet = useMemo(
    () => sheets.find((s) => s.id === selectedSheetId) ?? sheets[0],
    [sheets, selectedSheetId],
  );

  const scaledPreview = useMemo(() => {
    if (!selectedSheet) return null;
    const product = items.find((i) => i.id === selectedSheet.product_id);
    const lines = sheetItems
      .filter((si) => si.sheet_id === selectedSheet.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((si) => {
        const ing = items.find((i) => i.id === si.ingredient_id);
        return {
          ingredient_id: si.ingredient_id,
          name: ing?.name ?? 'Insumo',
          base_unit: ing?.base_unit ?? 'G',
          quantity_g_ml: si.quantity_g_ml,
          avg_cost: ing?.avg_cost ?? 0,
          current_stock: ing?.current_stock ?? 0,
        };
      });

    return computeTechnicalSheetMetrics({
      baseFlourWeightG: selectedSheet.base_flour_weight_g,
      targetFlourWeightG: (Number(desiredFlourKg) || 0) * 1000,
      expectedYieldUnits: selectedSheet.expected_yield_units,
      expectedUnitWeightRawG: selectedSheet.expected_unit_weight_raw_g,
      expectedUnitWeightBakedG: selectedSheet.expected_unit_weight_baked_g,
      operationalOverheadPct: selectedSheet.operational_overhead_pct,
      productSalePrice: product?.sale_price ?? 0,
      productIsWeighed: product?.is_weighed ?? false,
      ingredients: lines,
    });
  }, [selectedSheet, sheetItems, items, desiredFlourKg]);

  const handleLaunchProductionOrder = async () => {
    if (!selectedSheet || !scaledPreview) return;
    const now = new Date().toISOString();

    const { data: inserted, error } = await supabase
      .from('production_orders')
      .insert({
        sheet_id: selectedSheet.id,
        status: 'PLANEJADA',
        scaling_factor: scaledPreview.scaling_factor,
        planned_quantity: scaledPreview.scaled_yield_units,
        notes: opNotes,
      })
      .select()
      .single();

    if (!error && inserted) {
      await pullSupabaseToLocalCache();
      toast.success(
        `OP #${inserted.order_number} gravada no Supabase! Fator ${scaledPreview.scaling_factor}x (${desiredFlourKg}kg farinha → ${scaledPreview.scaled_yield_units} un)`,
      );
      return;
    }

    const maxNum = orders.reduce((acc, o) => Math.max(acc, o.order_number), 100);
    await localDb.productionOrders.put({
      id: crypto.randomUUID(),
      order_number: maxNum + 1,
      sheet_id: selectedSheet.id,
      baker_id: null,
      sales_order_id: null,
      status: 'PLANEJADA',
      scaling_factor: scaledPreview.scaling_factor,
      planned_quantity: scaledPreview.scaled_yield_units,
      actual_yield_quantity: null,
      damaged_quantity: 0,
      total_production_cost: null,
      scheduled_for: now,
      started_at: null,
      completed_at: null,
      notes: opNotes,
      created_by: null,
      created_at: now,
      updated_at: now,
    });

    toast.success(
      `OP #${maxNum + 1} lançada! Fator ${scaledPreview.scaling_factor}x (${desiredFlourKg}kg farinha → ${scaledPreview.scaled_yield_units} un)`,
    );
  };

  const handleAdvanceStatus = async (orderId: string, nextStatus: ProductionStatus) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('production_orders')
      .update({ status: nextStatus })
      .eq('id', orderId);

    if (!error) {
      await pullSupabaseToLocalCache();
    } else {
      await localDb.productionOrders.update(orderId, {
        status: nextStatus,
        started_at: nextStatus === 'EM_PRODUCAO' ? now : undefined,
        updated_at: now,
      });
    }
    toast.info(`Status da OP atualizado para ${nextStatus}.`);
  };

  const openFinishPanel = (orderId: string, plannedQty: number) => {
    setFinishingOrderId(orderId);
    setActualYieldInput(String(Math.round(plannedQty)));
    setDamagedInput('0');
  };

  const handleConfirmFinishOp = async () => {
    if (!finishingOrderId) return;
    const yieldQty = Number(actualYieldInput);
    const damagedQty = Number(damagedInput) || 0;
    if (!yieldQty || yieldQty <= 0) {
      toast.error('Informe o rendimento real (unidades boas saídas do forno).');
      return;
    }

    setIsSubmittingRpc(true);
    try {
      const result = await executeCompleteProductionOrder({
        orderId: finishingOrderId,
        actualYieldQuantity: yieldQty,
        damagedQuantity: damagedQty,
      });

      toast.success(
        `OP #${result.order_number} finalizada atomicamente! +${formatQuantity(result.stock_added, result.stock_unit)} em estoque (${result.batch_code}) • Custo Total: ${formatBRL(result.total_production_cost)}`,
      );
      setFinishingOrderId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao finalizar OP.');
    } finally {
      setIsSubmittingRpc(false);
    }
  };

  const handleAckAlert = async (alertId: string) => {
    const now = new Date().toISOString();
    await supabase.from('production_alerts').update({ acknowledged_at: now }).eq('id', alertId);
    await localDb.productionAlerts.update(alertId, {
      acknowledged_at: now,
    });
  };

  return (
    <div className="theme-kds no-touch-callout min-h-screen space-y-5 bg-background p-3.5 text-foreground sm:space-y-6 sm:p-6">
      {/* Cabeçalho estilo Totem / Tablet Industrial */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3.5 sm:gap-4 sm:pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md sm:h-14 sm:w-14">
            <ChefHat className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-kds-title">
              Tela do Padeiro • KDS & Masseira
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Toque rápido • Escalabilidade instantânea de batida • Baixa FEFO atômica
            </p>
          </div>
        </div>
      </div>

      {/* Alertas em Tempo Real (Encomendas IA / B2B) */}
      {openAlerts.length > 0 && (
        <div className="space-y-2">
          {openAlerts.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border-2 border-amber-500 bg-amber-50 px-4 py-3.5 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:px-5 sm:py-4"
            >
              <div className="flex items-start gap-3 sm:items-center">
                <BellRing className="mt-0.5 h-6 w-6 shrink-0 animate-bounce text-amber-600 sm:mt-0 sm:h-7 sm:w-7" />
                <div>
                  <p className="text-sm font-bold sm:text-base">{alert.title}</p>
                  <p className="text-xs sm:text-sm">{alert.message}</p>
                </div>
              </div>
              <Button size="lg" variant="default" className="w-full sm:w-auto shrink-0" onClick={() => handleAckAlert(alert.id)}>
                Ciente na Produção
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-12">
        {/* Coluna 1: Calculadora de Masseira Dinâmica */}
        <Card className="border-2 xl:col-span-5">
          <CardHeader className="bg-amber-500/10">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Scale className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" /> Calculadora de Masseira (Escala Dinâmica)
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Digite quantos quilos de farinha vai bater agora; todas as gramaturas são recalculadas na hora.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 sm:space-y-5 sm:pt-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold sm:text-base">1. Receita / Ficha Técnica</Label>
              <select
                value={selectedSheet?.id ?? ''}
                onChange={(e) => setSelectedSheetId(e.target.value)}
                className="h-12 w-full rounded-xl border-2 border-input bg-card px-3 text-sm font-bold sm:h-14 sm:px-4 sm:text-base"
              >
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Base: {s.base_flour_weight_g / 1000}kg)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-semibold sm:text-base">2. Farinha da Batida (kg)</Label>
                {scaledPreview && (
                  <Badge variant="default" className="text-xs sm:text-sm">
                    Fator Escala: {scaledPreview.scaling_factor}x
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {QUICK_FLOUR_PRESETS_KG.map((kg) => (
                  <Button
                    key={kg}
                    type="button"
                    variant={desiredFlourKg === kg ? 'default' : 'outline'}
                    className="h-11 font-mono text-sm font-bold sm:h-12 sm:text-base"
                    onClick={() => setDesiredFlourKg(kg)}
                  >
                    {kg}kg
                  </Button>
                ))}
              </div>

              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={desiredFlourKg}
                onChange={(e) => setDesiredFlourKg(Number(e.target.value))}
                className="h-14 text-center font-mono text-2xl font-extrabold"
              />
            </div>

            {/* Pesagem exata da batida */}
            {scaledPreview && (
              <div className="rounded-xl border-2 bg-stone-50 p-4">
                <div className="mb-3 flex items-center justify-between border-b pb-2">
                  <span className="text-sm font-bold uppercase tracking-wider text-stone-600">
                    Pesagem para {desiredFlourKg} kg de Farinha
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    Rendimento: ~{Math.round(scaledPreview.scaled_yield_units)} un
                  </span>
                </div>

                <div className="space-y-2.5">
                  {scaledPreview.ingredients.map((ing) => (
                    <div
                      key={ing.ingredient_id}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2.5 shadow-sm"
                    >
                      <div>
                        <p className="text-base font-bold">{ing.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Baker&apos;s {formatPercent(ing.bakers_percentage)} • Estoque:{' '}
                          {formatQuantity(ing.current_stock, ing.base_unit)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xl font-extrabold text-stone-900">
                          {formatQuantity(ing.scaled_quantity_g_ml, ing.base_unit)}
                        </p>
                        {!ing.has_sufficient_stock && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" /> Falta estoque
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
                  <span>
                    Massa Total: <strong>{formatQuantity(scaledPreview.scaled_dough_weight_g, 'G')}</strong>
                  </span>
                  <span>
                    Custo Estimado OP: <strong>{formatBRL(scaledPreview.scaled_batch_cost)}</strong>
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Observação / Forno</Label>
              <Input
                value={opNotes}
                onChange={(e) => setOpNotes(e.target.value)}
                className="h-12 text-base"
              />
            </div>

            <Button size="xl" className="w-full" onClick={handleLaunchProductionOrder}>
              <PlusCircle className="h-6 w-6" /> Gerar Ordem de Produção (OP)
            </Button>
          </CardContent>
        </Card>

        {/* Coluna 2: Quadro KDS de Fornadas do Dia */}
        <div className="space-y-4 xl:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Fornadas & Ordens de Produção (Tempo Real)</h2>
            <Badge variant="outline" className="text-sm">
              {orders.filter((o) => o.status !== 'FINALIZADA' && o.status !== 'CANCELADA').length} em andamento
            </Badge>
          </div>

          {/* Modal inline de fechamento atômico */}
          {finishingOrderId && (
            <Card className="border-2 border-emerald-600 bg-emerald-50/90 shadow-lg">
              <CardHeader>
                <CardTitle className="text-lg text-emerald-950">
                  Finalizar OP Atomicamente (`complete_production_order`)
                </CardTitle>
                <CardDescription className="text-emerald-900">
                  Deduz os insumos pelo lote mais próximo do vencimento (FEFO), grava o Kardex e recalcula o Custo Médio Ponderado do produto acabado.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-emerald-950 font-bold">Rendimento Real Bom (un)</Label>
                  <Input
                    type="number"
                    value={actualYieldInput}
                    onChange={(e) => setActualYieldInput(e.target.value)}
                    className="h-14 bg-white font-mono text-2xl font-extrabold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-emerald-950 font-bold">Quebra / Avaria na Fornada (un)</Label>
                  <Input
                    type="number"
                    value={damagedInput}
                    onChange={(e) => setDamagedInput(e.target.value)}
                    className="h-14 bg-white font-mono text-2xl font-extrabold"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    size="xl"
                    variant="success"
                    className="flex-1"
                    disabled={isSubmittingRpc}
                    onClick={handleConfirmFinishOp}
                  >
                    <CheckCircle2 className="h-6 w-6" /> Confirmar Baixa
                  </Button>
                  <Button
                    size="xl"
                    variant="outline"
                    onClick={() => setFinishingOrderId(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {orders.map((order) => {
              const sheet = sheets.find((s) => s.id === order.sheet_id);
              const flourKg = sheet ? (sheet.base_flour_weight_g * order.scaling_factor) / 1000 : 0;

              return (
                <Card
                  key={order.id}
                  className={
                    order.status === 'ASSANDO'
                      ? 'border-2 border-orange-500 bg-orange-50/40'
                      : order.status === 'EM_PRODUCAO'
                        ? 'border-2 border-sky-500 bg-sky-50/40'
                        : order.status === 'FINALIZADA'
                          ? 'opacity-75'
                          : 'border-2'
                  }
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-lg font-extrabold">OP #{order.order_number}</span>
                      <Badge
                        variant={
                          order.status === 'ASSANDO'
                            ? 'warning'
                            : order.status === 'FINALIZADA'
                              ? 'success'
                              : 'secondary'
                        }
                        className="text-xs font-bold"
                      >
                        {order.status}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg">{sheet?.name ?? 'Receita'}</CardTitle>
                    <CardDescription className="text-xs font-medium text-stone-600">
                      {order.notes || 'Sem observações'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 rounded-xl bg-muted/70 p-3 text-center">
                      <div>
                        <p className="text-[11px] uppercase text-muted-foreground">Farinha</p>
                        <p className="font-mono text-base font-extrabold">{flourKg.toFixed(1)} kg</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase text-muted-foreground">Escala</p>
                        <p className="font-mono text-base font-extrabold">{order.scaling_factor}x</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase text-muted-foreground">Previsto</p>
                        <p className="font-mono text-base font-extrabold">{order.planned_quantity} un</p>
                      </div>
                    </div>

                    {order.status === 'FINALIZADA' ? (
                      <div className="rounded-lg bg-emerald-100/70 px-3 py-2 text-xs text-emerald-950">
                        Rendimento Real: <strong>{order.actual_yield_quantity} un</strong> (Quebra:{' '}
                        {order.damaged_quantity} un) • Custo OP:{' '}
                        <strong>{formatBRL(order.total_production_cost ?? 0)}</strong>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {order.status === 'PLANEJADA' && (
                          <Button
                            size="xl"
                            className="w-full"
                            onClick={() => handleAdvanceStatus(order.id, 'EM_PRODUCAO')}
                          >
                            <Play className="h-5 w-5" /> Iniciar Masseira
                          </Button>
                        )}
                        {order.status === 'EM_PRODUCAO' && (
                          <Button
                            size="xl"
                            variant="default"
                            className="w-full bg-orange-600 hover:bg-orange-700"
                            onClick={() => handleAdvanceStatus(order.id, 'ASSANDO')}
                          >
                            <Flame className="h-5 w-5" /> Entrar no Forno
                          </Button>
                        )}
                        {(order.status === 'EM_PRODUCAO' || order.status === 'ASSANDO') && (
                          <Button
                            size="xl"
                            variant="success"
                            className="w-full"
                            onClick={() => openFinishPanel(order.id, order.planned_quantity)}
                          >
                            <CheckCircle2 className="h-5 w-5" /> Tirar Fornada
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

