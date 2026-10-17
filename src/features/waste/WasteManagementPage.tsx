import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Recycle, Trash2, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { localDb } from '@/lib/offlineDb';
import { executeTransformWasteProduct } from '@/features/pcp/pcpService';
import { Decimal, formatBRL, formatPercent, formatQuantity, formatUnitCost } from '@/lib/decimal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WasteType } from '@/types/database.types';

export function WasteManagementPage() {
  const items = useLiveQuery(() => localDb.items.toArray(), [], []);
  const wasteHistory = useLiveQuery(
    () => localDb.wasteRecords.orderBy('created_at').reverse().toArray(),
    [],
    [],
  );

  const sourceCandidates = useMemo(
    () => items.filter((i) => i.type === 'PRODUTO_ACABADO' || i.type === 'INSUMO'),
    [items],
  );
  const targetByproducts = useMemo(
    () => items.filter((i) => i.type === 'SUBPRODUTO' || i.type === 'PRODUTO_ACABADO'),
    [items],
  );

  const [mode, setMode] = useState<WasteType>('TRANSFORMACAO');
  const [sourceItemId, setSourceItemId] = useState<string>('20000000-0000-4000-a000-000000000001'); // Pão Francês
  const [sourceQtyInput, setSourceQtyInput] = useState<number>(10000); // 10kg = 10.000g
  const [targetItemId, setTargetItemId] = useState<string>('20000000-0000-4000-a000-000000000003'); // Farinha de Rosca
  const [targetQtyInput, setTargetQtyInput] = useState<number>(8500); // 8,5kg = 8.500g
  const [reason, setReason] = useState<string>('Sobra de Pão Francês do dia → Torra e moagem p/ Farinha de Rosca');
  const [isExecuting, setIsExecuting] = useState(false);

  const selectedSource = useMemo(
    () => items.find((i) => i.id === sourceItemId),
    [items, sourceItemId],
  );
  const selectedTarget = useMemo(
    () => items.find((i) => i.id === targetItemId),
    [items, targetItemId],
  );

  const accountingPreview = useMemo(() => {
    const srcQty = Decimal.max(new Decimal(sourceQtyInput || 0), 0);
    const tgtQty = Decimal.max(new Decimal(targetQtyInput || 0), 1);
    const srcUnitCost = new Decimal(selectedSource?.avg_cost ?? 0);
    const transferredCost = srcQty.times(srcUnitCost);
    const newTargetBatchUnitCost = transferredCost.dividedBy(tgtQty);
    const yieldPct = srcQty.gt(0) ? tgtQty.dividedBy(srcQty).times(100) : new Decimal(0);

    return {
      transferredCost: transferredCost.toNumber(),
      newTargetBatchUnitCost: newTargetBatchUnitCost.toNumber(),
      yieldPct: yieldPct.toNumber(),
    };
  }, [sourceQtyInput, targetQtyInput, selectedSource]);

  const handleQuickPresetBreadToCrumbs = () => {
    setMode('TRANSFORMACAO');
    setSourceItemId('20000000-0000-4000-a000-000000000001');
    setSourceQtyInput(10000);
    setTargetItemId('20000000-0000-4000-a000-000000000003');
    setTargetQtyInput(8500);
    setReason('Transformar 10kg de Pão Francês Dormido em 8,5kg de Farinha de Rosca');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecuting(true);
    try {
      const result = await executeTransformWasteProduct({
        sourceItemId,
        sourceQuantity: Number(sourceQtyInput),
        type: mode,
        targetItemId: mode === 'TRANSFORMACAO' ? targetItemId : null,
        targetQuantity: mode === 'TRANSFORMACAO' ? Number(targetQtyInput) : null,
        reason,
      });

      if (mode === 'TRANSFORMACAO') {
        toast.success(
          `OP Reversa concluída! Custo contábil de ${formatBRL(result.source_cost)} transferido para "${selectedTarget?.name}" (Rendimento ${formatPercent(result.yield_ratio_pct ?? 0)})`,
        );
      } else {
        toast.warning(
          `Perda registrada no DRE: ${formatBRL(result.source_cost)} baixados do estoque.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha na operação.');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-5 p-3.5 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Gestão de Perdas & Reaproveitamento (OP Reversa)
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Transforme sobras de produção em subprodutos mantendo a integridade contábil do DRE via RPC{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">transform_waste_product</code>.
          </p>
        </div>

        <Button variant="outline" className="w-full sm:w-auto text-xs sm:text-sm" onClick={handleQuickPresetBreadToCrumbs}>
          <Sparkles className="h-4 w-4 shrink-0 text-amber-600" /> Preset: 10kg Pão Dormido → 8,5kg Farinha de Rosca
        </Button>
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-6 overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base sm:text-lg">Lançar Transformação ou Descarte</CardTitle>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'TRANSFORMACAO' ? 'default' : 'outline'}
                  onClick={() => setMode('TRANSFORMACAO')}
                >
                  <Recycle className="h-4 w-4 shrink-0" /> Transformar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'DESCARTE_PERDA' ? 'destructive' : 'outline'}
                  onClick={() => setMode('DESCARTE_PERDA')}
                >
                  <Trash2 className="h-4 w-4 shrink-0" /> Descarte
                </Button>
              </div>
            </div>
            <CardDescription>
              Na transformação, o custo contábil do produto de origem é integralmente absorvido pelo novo custo médio do subproduto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-3.5 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="font-semibold">1. Produto de Origem (Saída FEFO)</Label>
                  {selectedSource && (
                    <Badge variant="outline">
                      Disponível: {formatQuantity(selectedSource.current_stock, selectedSource.base_unit)}
                    </Badge>
                  )}
                </div>

                <select
                  value={sourceItemId}
                  onChange={(e) => setSourceItemId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-medium"
                >
                  {sourceCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (Estoque: {formatQuantity(item.current_stock, item.base_unit)})
                    </option>
                  ))}
                </select>

                <div className="space-y-1">
                  <Label>
                    Quantidade de Origem ({selectedSource?.base_unit ?? 'G'}) — Ex: 10000g = 10kg
                  </Label>
                  <Input
                    type="number"
                    step="10"
                    value={sourceQtyInput}
                    onChange={(e) => setSourceQtyInput(Number(e.target.value))}
                    className="font-mono text-base font-bold"
                  />
                </div>
              </div>

              {mode === 'TRANSFORMACAO' && (
                <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-50/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-emerald-950">
                      2. Subproduto Gerado (Entrada com Custo Herdado)
                    </Label>
                    {selectedTarget && (
                      <Badge variant="success">
                        Estoque Atual: {formatQuantity(selectedTarget.current_stock, selectedTarget.base_unit)}
                      </Badge>
                    )}
                  </div>

                  <select
                    value={targetItemId}
                    onChange={(e) => setTargetItemId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-medium"
                  >
                    {targetByproducts
                      .filter((t) => t.id !== sourceItemId)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.base_unit})
                        </option>
                      ))}
                  </select>

                  <div className="space-y-1">
                    <Label>
                      Quantidade Líquida Gerada ({selectedTarget?.base_unit ?? 'G'}) — Ex: 8500g = 8,5kg
                    </Label>
                    <Input
                      type="number"
                      step="10"
                      value={targetQtyInput}
                      onChange={(e) => setTargetQtyInput(Number(e.target.value))}
                      className="font-mono text-base font-bold"
                    />
                  </div>
                </div>
              )}

              {/* Resumo Contábil antes de gravar */}
              <div className="rounded-xl border bg-card p-3.5 sm:p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Espelho Contábil da Operação (Impacto DRE)
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                  <span>
                    Saída:{' '}
                    <strong>
                      {formatQuantity(sourceQtyInput, selectedSource?.base_unit ?? 'G')}
                    </strong>{' '}
                    de {selectedSource?.name}
                  </span>
                  <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:inline" />
                  <span>
                    Custo Contábil: <strong>{formatBRL(accountingPreview.transferredCost)}</strong>
                  </span>
                </div>
                {mode === 'TRANSFORMACAO' && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-emerald-800">
                    <span>
                      Aproveitamento Técnico: <strong>{formatPercent(accountingPreview.yieldPct)}</strong>
                    </span>
                    <span>
                      Novo CMV do Lote Gerado:{' '}
                      <strong>
                        {formatUnitCost(accountingPreview.newTargetBatchUnitCost)}/
                        {(selectedTarget?.base_unit ?? 'G').toLowerCase()} (
                        {formatBRL(accountingPreview.newTargetBatchUnitCost * 1000)}/kg)
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Motivo / Justificativa para Auditoria</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>

              <Button
                type="submit"
                size="lg"
                variant={mode === 'TRANSFORMACAO' ? 'default' : 'destructive'}
                className="w-full text-xs sm:text-sm"
                disabled={isExecuting}
              >
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                {mode === 'TRANSFORMACAO'
                  ? 'Executar Transformação e Transferir Custo Contábil'
                  : 'Registrar Baixa por Perda no DRE'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Histórico de Perdas e Transformações */}
        <Card className="lg:col-span-6 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Histórico de Reaproveitamento & Quebras</CardTitle>
            <CardDescription>Rastreabilidade completa de custos transferidos ou baixados.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {wasteHistory.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum movimento registrado ainda nesta sessão. Clique no preset acima e execute para testar!
              </p>
            ) : (
              <Table className="min-w-[460px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Custo Contábil</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wasteHistory.map((row) => {
                    const src = items.find((i) => i.id === row.source_item_id);
                    const tgt = items.find((i) => i.id === row.target_item_id);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge variant={row.type === 'TRANSFORMACAO' ? 'success' : 'destructive'}>
                            {row.type === 'TRANSFORMACAO' ? 'OP REVERSA' : 'PERDA'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-semibold">{src?.name}</div>
                          <div className="font-mono text-muted-foreground">
                            -{formatQuantity(row.source_quantity, src?.base_unit ?? 'G')}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {tgt && row.target_quantity_generated ? (
                            <>
                              <div className="font-semibold">{tgt.name}</div>
                              <div className="font-mono text-emerald-700">
                                +{formatQuantity(row.target_quantity_generated, tgt.base_unit)}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{row.reason}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold">
                          {formatBRL(row.transferred_cost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

