import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  Calculator,
  Plus,
  Trash2,
  Save,
  Droplets,
  Wheat,
  Flame,
  TrendingUp,
  Scale,
} from 'lucide-react';
import { localDb } from '@/lib/offlineDb';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { computeTechnicalSheetMetrics } from '@/features/pcp/bakersMath';
import { formatBRL, formatPercent, formatQuantity, formatUnitCost } from '@/lib/decimal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const sheetFormSchema = z.object({
  id: z.string(),
  product_id: z.string().min(1, 'Selecione o produto acabado'),
  name: z.string().min(3, 'Informe o nome da receita base'),
  base_flour_weight_kg: z.coerce.number().positive('Farinha base deve ser > 0'),
  expected_yield_units: z.coerce.number().positive('Rendimento esperado deve ser > 0'),
  expected_unit_weight_raw_g: z.coerce.number().positive('Peso cru > 0'),
  expected_unit_weight_baked_g: z.coerce.number().positive('Peso assado > 0'),
  operational_overhead_pct: z.coerce.number().min(0).max(200),
  notes: z.string().optional(),
  ingredients: z
    .array(
      z.object({
        ingredient_id: z.string().min(1, 'Selecione o insumo'),
        quantity_g_ml: z.coerce.number().positive('Gramatura > 0'),
      }),
    )
    .min(1, 'Adicione ao menos 1 ingrediente'),
});

type SheetFormValues = z.infer<typeof sheetFormSchema>;

export function TechnicalSheetsPage() {
  const sheets = useLiveQuery(() => localDb.technicalSheets.toArray(), [], []);
  const allItems = useLiveQuery(() => localDb.items.toArray(), [], []);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('40000000-0000-4000-a000-000000000001');

  const finishedProducts = useMemo(
    () => allItems.filter((i) => i.type === 'PRODUTO_ACABADO' || i.type === 'SUBPRODUTO'),
    [allItems],
  );
  const rawMaterials = useMemo(() => allItems.filter((i) => i.type === 'INSUMO'), [allItems]);

  const form = useForm<SheetFormValues>({
    resolver: zodResolver(sheetFormSchema),
    defaultValues: {
      id: '40000000-0000-4000-a000-000000000001',
      product_id: '20000000-0000-4000-a000-000000000001',
      name: 'Receita Base Pão Francês 50kg',
      base_flour_weight_kg: 50,
      expected_yield_units: 1200,
      expected_unit_weight_raw_g: 65,
      expected_unit_weight_baked_g: 50,
      operational_overhead_pct: 18,
      notes: '',
      ingredients: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'ingredients',
  });

  // Carrega a ficha selecionada do IndexedDB
  useEffect(() => {
    let active = true;
    async function loadSheet() {
      const sheet = await localDb.technicalSheets.get(selectedSheetId);
      if (!sheet || !active) return;
      const items = await localDb.technicalSheetItems
        .where('sheet_id')
        .equals(sheet.id)
        .sortBy('sort_order');

      form.reset({
        id: sheet.id,
        product_id: sheet.product_id,
        name: sheet.name,
        base_flour_weight_kg: sheet.base_flour_weight_g / 1000,
        expected_yield_units: sheet.expected_yield_units,
        expected_unit_weight_raw_g: sheet.expected_unit_weight_raw_g ?? 65,
        expected_unit_weight_baked_g: sheet.expected_unit_weight_baked_g ?? 50,
        operational_overhead_pct: sheet.operational_overhead_pct,
        notes: sheet.notes ?? '',
        ingredients: items.map((i) => ({
          ingredient_id: i.ingredient_id,
          quantity_g_ml: i.quantity_g_ml,
        })),
      });
    }
    loadSheet();
    return () => {
      active = false;
    };
  }, [selectedSheetId, form]);

  const watched = form.watch();
  const selectedProduct = useMemo(
    () => allItems.find((i) => i.id === watched.product_id),
    [allItems, watched.product_id],
  );

  const metrics = useMemo(() => {
    const baseFlourG = (Number(watched.base_flour_weight_kg) || 0) * 1000;
    const ingInputs = (watched.ingredients ?? []).map((row) => {
      const item = allItems.find((i) => i.id === row.ingredient_id);
      return {
        ingredient_id: row.ingredient_id,
        name: item?.name ?? 'Insumo',
        base_unit: item?.base_unit ?? 'G',
        quantity_g_ml: Number(row.quantity_g_ml) || 0,
        avg_cost: item?.avg_cost ?? 0,
        current_stock: item?.current_stock ?? 0,
      };
    });

    return computeTechnicalSheetMetrics({
      baseFlourWeightG: baseFlourG,
      expectedYieldUnits: Number(watched.expected_yield_units) || 1,
      expectedUnitWeightRawG: Number(watched.expected_unit_weight_raw_g) || 65,
      expectedUnitWeightBakedG: Number(watched.expected_unit_weight_baked_g) || 50,
      operationalOverheadPct: Number(watched.operational_overhead_pct) || 0,
      productSalePrice: selectedProduct?.sale_price ?? 0,
      productIsWeighed: selectedProduct?.is_weighed ?? false,
      ingredients: ingInputs,
    });
  }, [watched, allItems, selectedProduct]);

  const onSubmit = async (values: SheetFormValues) => {
    const now = new Date().toISOString();
    const baseFlourG = values.base_flour_weight_kg * 1000;

    // 1. Grava diretamente no Supabase PostgreSQL
    const { error: sheetErr } = await supabase.from('technical_sheets').upsert({
      id: values.id,
      product_id: values.product_id,
      name: values.name,
      base_flour_weight_g: baseFlourG,
      expected_yield_units: values.expected_yield_units,
      expected_unit_weight_raw_g: values.expected_unit_weight_raw_g,
      expected_unit_weight_baked_g: values.expected_unit_weight_baked_g,
      operational_overhead_pct: values.operational_overhead_pct,
      notes: values.notes || null,
      active: true,
    });

    if (!sheetErr) {
      await supabase.from('technical_sheet_items').delete().eq('sheet_id', values.id);
      await supabase.from('technical_sheet_items').insert(
        values.ingredients.map((ing, idx) => ({
          sheet_id: values.id,
          ingredient_id: ing.ingredient_id,
          quantity_g_ml: ing.quantity_g_ml,
          sort_order: idx + 1,
        })),
      );
      await pullSupabaseToLocalCache();
      toast.success('Ficha Técnica e Porcentagens de Padeiro salvas no Supabase!');
      return;
    }

    // 2. Fallback Offline no IndexedDB
    await localDb.transaction('rw', [localDb.technicalSheets, localDb.technicalSheetItems], async () => {
      await localDb.technicalSheets.put({
        id: values.id,
        product_id: values.product_id,
        name: values.name,
        base_flour_weight_g: baseFlourG,
        expected_yield_units: values.expected_yield_units,
        expected_unit_weight_raw_g: values.expected_unit_weight_raw_g,
        expected_unit_weight_baked_g: values.expected_unit_weight_baked_g,
        operational_overhead_pct: values.operational_overhead_pct,
        notes: values.notes || null,
        active: true,
        created_at: now,
        updated_at: now,
      });

      await localDb.technicalSheetItems.where('sheet_id').equals(values.id).delete();

      await localDb.technicalSheetItems.bulkPut(
        values.ingredients.map((ing, idx) => ({
          id: crypto.randomUUID(),
          sheet_id: values.id,
          ingredient_id: ing.ingredient_id,
          quantity_g_ml: ing.quantity_g_ml,
          bakers_percentage: Number(((ing.quantity_g_ml / baseFlourG) * 100).toFixed(2)),
          sort_order: idx + 1,
          created_at: now,
          updated_at: now,
        })),
      );
    });

    toast.success('Ficha Técnica e Porcentagens de Padeiro salvas com sucesso!');
  };

  const handleCreateNewSheet = () => {
    const newId = crypto.randomUUID();
    const firstProduct = finishedProducts[0];
    const flourItem = rawMaterials[0];
    setSelectedSheetId(newId);
    form.reset({
      id: newId,
      product_id: firstProduct?.id ?? '',
      name: 'Nova Receita Base 25kg',
      base_flour_weight_kg: 25,
      expected_yield_units: 600,
      expected_unit_weight_raw_g: 65,
      expected_unit_weight_baked_g: 50,
      operational_overhead_pct: 18,
      notes: '',
      ingredients: flourItem ? [{ ingredient_id: flourItem.id, quantity_g_ml: 25000 }] : [],
    });
  };

  return (
    <div className="space-y-5 p-3.5 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Engenharia de Cardápio & Ficha Técnica (Baker&apos;s Percentage)
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            A farinha é sempre a base 100%. Hidratação, CMV unitário e margem de contribuição recalculados em tempo real.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select
            value={selectedSheetId}
            onChange={(e) => setSelectedSheetId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-medium sm:h-9 sm:w-auto"
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button variant="outline" className="flex-1 sm:flex-initial" onClick={handleCreateNewSheet}>
            <Plus className="h-4 w-4" /> Nova Receita
          </Button>
          <Button className="flex-1 sm:flex-initial" onClick={form.handleSubmit(onSubmit)}>
            <Save className="h-4 w-4" /> Salvar Ficha
          </Button>
        </div>
      </div>

      {/* KPIs de Engenharia da Ficha */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5 sm:gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Wheat className="h-4 w-4 text-amber-600" /> Farinha Base (100%)
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {formatQuantity(metrics.base_flour_weight_g, 'G')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Massa total batida: <strong>{formatQuantity(metrics.total_dough_weight_g, 'G')}</strong>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Droplets className="h-4 w-4 text-sky-600" /> Hidratação (Água/Gelo)
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-sky-700">
              {formatPercent(metrics.hydration_pct)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Quebra de forno estimada: <strong>{formatPercent(metrics.bake_loss_pct, 1)}</strong>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-orange-600" /> Custo Total da Batida
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{formatBRL(metrics.total_batch_cost)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Insumos {formatBRL(metrics.ingredients_cost)} + CIF {formatBRL(metrics.overhead_cost)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-stone-600" /> CMV Unitário Teórico
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{formatUnitCost(metrics.unit_cmv)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Rendimento: <strong>{metrics.expected_yield_units} un</strong> ({watched.expected_unit_weight_baked_g}g assado)
          </CardContent>
        </Card>

        <Card className="border-emerald-500/40 bg-emerald-50/40">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-emerald-800">
              <TrendingUp className="h-4 w-4 text-emerald-600" /> Margem de Contribuição
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">
              {formatPercent(metrics.contribution_margin_pct)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-emerald-900">
            Venda eq.: <strong>{formatBRL(metrics.unit_sale_price)}/un</strong> (Lucro Bruto:{' '}
            {formatBRL(metrics.contribution_margin_brl)}/un)
          </CardContent>
        </Card>
      </div>

      {/* Formulário Principal */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Parâmetros Industriais</CardTitle>
            <CardDescription>Rendimento, gramatura de divisão e rateio de custos indiretos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome da Ficha Técnica</Label>
              <Input {...form.register('name')} />
            </div>

            <div className="space-y-1.5">
              <Label>Produto Acabado / Subproduto</Label>
              <select
                {...form.register('product_id')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {finishedProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name} ({p.is_weighed ? `${formatBRL(p.sale_price ?? 0)}/kg` : `${formatBRL(p.sale_price ?? 0)}/un`})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Farinha Base (kg = 100%)</Label>
                <Input type="number" step="0.5" {...form.register('base_flour_weight_kg')} />
              </div>
              <div className="space-y-1.5">
                <Label>Rendimento Esperado (un)</Label>
                <Input type="number" step="1" {...form.register('expected_yield_units')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Peso Cru Boleado (g)</Label>
                <Input type="number" step="1" {...form.register('expected_unit_weight_raw_g')} />
              </div>
              <div className="space-y-1.5">
                <Label>Peso Assado Final (g)</Label>
                <Input type="number" step="1" {...form.register('expected_unit_weight_baked_g')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Custos Indiretos — Gás / Energia / M.O. (%)</Label>
              <Input type="number" step="0.5" {...form.register('operational_overhead_pct')} />
            </div>

            <div className="space-y-1.5">
              <Label>Instruções de Masseira / Forno</Label>
              <textarea
                rows={3}
                {...form.register('notes')}
                className="w-full rounded-md border border-input bg-transparent p-2.5 text-sm shadow-sm"
                placeholder="Ex: 4 min 1ª vel + 6 min 2ª vel. Vapor 4s a 210°C..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Tabela de Ingredientes com Baker's Percentage */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Scale className="h-5 w-5 shrink-0 text-primary" /> Composição da Receita & Baker&apos;s Percentage
              </CardTitle>
              <CardDescription>
                Quantidades salvas sempre na unidade base (g ou ml). O percentual é calculado sobre a farinha base.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto shrink-0"
              onClick={() =>
                append({
                  ingredient_id: rawMaterials[0]?.id ?? '',
                  quantity_g_ml: 500,
                })
              }
            >
              <Plus className="h-4 w-4" /> Adicionar Insumo
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo (Unidade Base)</TableHead>
                  <TableHead className="w-36 text-right">Gramatura (g / ml)</TableHead>
                  <TableHead className="w-32 text-right">Baker&apos;s %</TableHead>
                  <TableHead className="w-32 text-right">Custo Médio</TableHead>
                  <TableHead className="w-32 text-right">Custo na Receita</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => {
                  const computed = metrics.ingredients[index];
                  return (
                    <TableRow key={field.id}>
                      <TableCell>
                        <select
                          {...form.register(`ingredients.${index}.ingredient_id`)}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                          {rawMaterials.map((rm) => (
                            <option key={rm.id} value={rm.id}>
                              {rm.name} ({rm.base_unit})
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="1"
                          className="text-right font-mono"
                          {...form.register(`ingredients.${index}.quantity_g_ml`)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        <Badge variant={computed && computed.bakers_percentage === 100 ? 'default' : 'secondary'}>
                          {computed ? formatPercent(computed.bakers_percentage) : '0,00%'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {computed ? `${formatUnitCost(computed.line_cost / (computed.quantity_g_ml || 1))}/${computed.base_unit.toLowerCase()}` : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {computed ? formatBRL(computed.line_cost) : 'R$ 0,00'}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          disabled={fields.length <= 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

