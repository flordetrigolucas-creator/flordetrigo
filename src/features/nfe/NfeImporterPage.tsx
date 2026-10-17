import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { UploadCloud, FileCode2, ArrowRightLeft, CheckCircle2, Sparkles } from 'lucide-react';
import { localDb } from '@/lib/offlineDb';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { parseNfeXml, SAMPLE_BAKERY_NFE_XML, type ParsedNfeInvoice } from '@/features/nfe/nfeXmlParser';
import { Decimal, formatBRL, formatQuantity, formatUnitCost, SCALE, toDb } from '@/lib/decimal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface LineMappingState {
  linkedItemId: string;
  conversionFactor: number; // Quantas unidades base (g/ml/un) existem em 1 uCom da NF
  expirationDate: string;
}

export function NfeImporterPage() {
  const items = useLiveQuery(() => localDb.items.toArray(), [], []);
  const stockCandidates = useMemo(
    () => items.filter((i) => i.type === 'INSUMO' || i.type === 'REVENDA'),
    [items],
  );

  const [invoice, setInvoice] = useState<ParsedNfeInvoice | null>(null);
  const [mappings, setMappings] = useState<Record<number, LineMappingState>>({});
  const [isConfirming, setIsConfirming] = useState(false);

  const loadXmlText = (xmlText: string) => {
    try {
      const parsed = parseNfeXml(xmlText);
      setInvoice(parsed);

      const defaultExp = new Date();
      defaultExp.setDate(defaultExp.getDate() + 90);
      const expStr = defaultExp.toISOString().slice(0, 10);

      const initialMap: Record<number, LineMappingState> = {};
      for (const line of parsed.lines) {
        const descUpper = line.description.toUpperCase();
        const autoItem =
          stockCandidates.find(
            (i) =>
              (descUpper.includes('FARINHA') && i.sku.includes('FARINHA')) ||
              (descUpper.includes('MELHORADOR') && i.sku.includes('MELHORADOR')) ||
              (descUpper.includes('FERMENTO') && i.sku.includes('FERMENTO')),
          ) ?? stockCandidates[0];

        initialMap[line.lineNumber] = {
          linkedItemId: autoItem?.id ?? '',
          conversionFactor: line.suggestedFactorToBase,
          expirationDate: expStr,
        };
      }
      setMappings(initialMap);
      toast.success(
        `NF-e #${parsed.invoiceNumber} (${parsed.supplierName}) lida com ${parsed.lines.length} itens!`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao interpretar XML da NF-e.');
    }
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    loadXmlText(text);
  };

  const handleConfirmEntry = async () => {
    if (!invoice) return;
    setIsConfirming(true);
    try {
      const rpcLines = invoice.lines.map((line) => {
        const map = mappings[line.lineNumber];
        if (!map?.linkedItemId || map.conversionFactor <= 0) {
          throw new Error(`Configure o De/Para da linha #${line.lineNumber} (${line.description}).`);
        }
        return {
          line_number: line.lineNumber,
          supplier_product_code: line.supplierProductCode,
          description: line.description,
          ncm: line.ncm,
          commercial_unit: line.commercialUnit,
          commercial_quantity: line.commercialQuantity,
          commercial_unit_value: line.commercialUnitValue,
          total_value: line.totalValue,
          linked_item_id: map.linkedItemId,
          conversion_factor: map.conversionFactor,
          expiration_date: map.expirationDate || null,
          batch_code: `NFE-${invoice.invoiceNumber}-L${line.lineNumber}`,
        };
      });

      const { error: rpcError } = await supabase.rpc('confirm_nfe_xml_entry', {
        p_access_key: invoice.accessKey,
        p_supplier_cnpj: invoice.supplierCnpj,
        p_supplier_name: invoice.supplierName,
        p_invoice_number: invoice.invoiceNumber,
        p_series: invoice.series,
        p_issued_at: invoice.issuedAt,
        p_total_amount: invoice.totalAmount,
        p_raw_xml: SAMPLE_BAKERY_NFE_XML,
        p_lines: rpcLines,
      });

      if (!rpcError) {
        await pullSupabaseToLocalCache();
        toast.success(
          `NF-e #${invoice.invoiceNumber} gravada no Supabase! Estoque convertido para g/ml/un, lotes FEFO gerados e CMV atualizado.`,
        );
        setInvoice(null);
        return;
      }

      await localDb.transaction('rw', [localDb.items, localDb.inventoryBatches], async () => {
        for (const line of invoice.lines) {
          const map = mappings[line.lineNumber];
          if (!map?.linkedItemId || map.conversionFactor <= 0) {
            throw new Error(`Configure o De/Para da linha #${line.lineNumber} (${line.description}).`);
          }

          const targetItem = await localDb.items.get(map.linkedItemId);
          if (!targetItem) throw new Error('Insumo vinculado não encontrado.');

          const baseQtyAdded = new Decimal(line.commercialQuantity).times(map.conversionFactor);
          const totalLineCost = new Decimal(line.totalValue);
          const prevStock = Decimal.max(new Decimal(targetItem.current_stock), 0);
          const newAvgCost = prevStock
            .times(targetItem.avg_cost)
            .plus(totalLineCost)
            .dividedBy(prevStock.plus(baseQtyAdded));

          const unitCostBase = totalLineCost.dividedBy(baseQtyAdded);

          await localDb.inventoryBatches.put({
            id: crypto.randomUUID(),
            item_id: targetItem.id,
            batch_code: `NFE-${invoice.invoiceNumber}-L${line.lineNumber}`,
            expiration_date: map.expirationDate || null,
            quantity: toDb(baseQtyAdded, SCALE.quantity),
            initial_quantity: toDb(baseQtyAdded, SCALE.quantity),
            unit_cost: toDb(unitCostBase, SCALE.unitCost),
            reference_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          await localDb.items.update(targetItem.id, {
            current_stock: toDb(new Decimal(targetItem.current_stock).plus(baseQtyAdded), SCALE.quantity),
            avg_cost: toDb(newAvgCost, SCALE.unitCost),
            updated_at: new Date().toISOString(),
          });
        }
      });

      toast.success(
        `Entrada da NF-e #${invoice.invoiceNumber} confirmada! Estoque convertido para g/ml/un e CMV das Fichas Técnicas atualizado.`,
      );
      setInvoice(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao dar entrada na NF-e.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="space-y-5 p-3.5 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Entrada de Nota Fiscal Eletrônica (Parser XML NF-e & De/Para de Unidades)
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Converte fardos/sacos/caixas (`uCom`) para a unidade base (`g`, `ml`, `un`) e recalcula o Custo Médio Ponderado automaticamente.
          </p>
        </div>

        <Button variant="default" className="w-full sm:w-auto text-xs sm:text-sm" onClick={() => loadXmlText(SAMPLE_BAKERY_NFE_XML)}>
          <Sparkles className="h-4 w-4 shrink-0" /> Carregar XML NF-e de Exemplo (Moinho 50kg)
        </Button>
      </div>

      {/* Zona Drag and Drop */}
      <Card className="border-2 border-dashed">
        <CardContent className="flex flex-col items-center justify-center px-4 py-6 sm:py-8 text-center">
          <UploadCloud className="mb-3 h-10 w-10 text-primary" />
          <p className="text-sm sm:text-base font-semibold">
            Arraste e solte o arquivo <code className="font-mono">.xml</code> da NF-e aqui ou selecione do dispositivo
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            Leitura nativa das tags &lt;det&gt;, &lt;prod&gt;, xProd, qCom, uCom, vUnCom e NCM.
          </p>
          <input
            type="file"
            accept=".xml,text/xml"
            onChange={(e) => handleFileUpload(e.target.files?.[0])}
            className="max-w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground"
          />
        </CardContent>
      </Card>

      {invoice && (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3.5 border-b">
            <div className="min-w-0 max-w-full">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-5 w-5 shrink-0 text-primary" />
                <CardTitle className="text-base sm:text-lg">
                  NF-e #{invoice.invoiceNumber} (Série {invoice.series}) — {invoice.supplierName}
                </CardTitle>
              </div>
              <CardDescription className="mt-1 break-all font-mono text-[11px] sm:text-xs">
                CNPJ: {invoice.supplierCnpj} • Chave: {invoice.accessKey} • Total NF:{' '}
                <strong>{formatBRL(invoice.totalAmount)}</strong>
              </CardDescription>
            </div>

            <Button size="lg" variant="success" className="w-full sm:w-auto text-xs sm:text-sm" disabled={isConfirming} onClick={handleConfirmEntry}>
              <CheckCircle2 className="h-5 w-5 shrink-0" /> Confirmar Conversão e Dar Entrada
            </Button>
          </CardHeader>

          <CardContent className="overflow-x-auto pt-4">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Produto na NF-e (&lt;xProd&gt; / NCM)</TableHead>
                  <TableHead className="text-right">Qtd Comercial (&lt;qCom&gt;)</TableHead>
                  <TableHead>Insumo Vinculado no ERP</TableHead>
                  <TableHead className="w-40 text-right">
                    <span className="inline-flex items-center gap-1">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-primary" /> Fator p/ Base
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Entrada na Base</TableHead>
                  <TableHead className="text-right">Novo Custo Base</TableHead>
                  <TableHead className="w-36">Validade Lote (FEFO)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line) => {
                  const map = mappings[line.lineNumber] ?? {
                    linkedItemId: stockCandidates[0]?.id ?? '',
                    conversionFactor: line.suggestedFactorToBase,
                    expirationDate: '',
                  };
                  const linkedItem = items.find((i) => i.id === map.linkedItemId);
                  const convertedBaseQty = line.commercialQuantity * (map.conversionFactor || 1);
                  const unitCostInBase = line.totalValue / (convertedBaseQty || 1);

                  return (
                    <TableRow key={line.lineNumber}>
                      <TableCell className="font-mono font-bold">{line.lineNumber}</TableCell>
                      <TableCell>
                        <div className="font-semibold">{line.description}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          cProd: {line.supplierProductCode} • NCM: {line.ncm} • Total:{' '}
                          {formatBRL(line.totalValue)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <Badge variant="outline">
                          {line.commercialQuantity} {line.commercialUnit} × {formatBRL(line.commercialUnitValue)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <select
                          value={map.linkedItemId}
                          onChange={(e) =>
                            setMappings((prev) => ({
                              ...prev,
                              [line.lineNumber]: { ...map, linkedItemId: e.target.value },
                            }))
                          }
                          className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs font-medium"
                        >
                          {stockCandidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} (Base: {c.base_unit})
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="1"
                          value={map.conversionFactor}
                          onChange={(e) =>
                            setMappings((prev) => ({
                              ...prev,
                              [line.lineNumber]: {
                                ...map,
                                conversionFactor: Number(e.target.value),
                              },
                            }))
                          }
                          className="h-9 text-right font-mono font-bold"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          1 {line.commercialUnit} = {map.conversionFactor} {linkedItem?.base_unit ?? 'G'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-extrabold text-emerald-700">
                        +{formatQuantity(convertedBaseQty, linkedItem?.base_unit ?? 'G')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatUnitCost(unitCostInBase)}/{(linkedItem?.base_unit ?? 'G').toLowerCase()}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={map.expirationDate}
                          onChange={(e) =>
                            setMappings((prev) => ({
                              ...prev,
                              [line.lineNumber]: { ...map, expirationDate: e.target.value },
                            }))
                          }
                          className="h-9 font-mono text-xs"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

