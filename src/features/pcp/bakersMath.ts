/**
 * Motor Determinístico de Engenharia de Cardápio (Baker's Percentage) e Escalonamento de Masseira.
 *
 * Regras:
 * 1. A farinha base é SEMPRE 100%.
 * 2. Cada ingrediente tem % de padeiro = (quantity_g_ml / base_flour_weight_g) * 100.
 * 3. CMV Total da Receita = Soma(quantity_g_ml * avg_cost) * (1 + operational_overhead_pct / 100).
 * 4. Fator de Escalonamento (scaling_factor) = farinha_desejada_g / base_flour_weight_g.
 */
import { Decimal, SCALE, toDb, type DecimalInput } from '@/lib/decimal';
import type { StorageUnit } from '@/types/database.types';

export interface SheetIngredientCalcInput {
  ingredient_id: string;
  name: string;
  base_unit: StorageUnit;
  quantity_g_ml: DecimalInput;
  avg_cost: DecimalInput;
  current_stock: DecimalInput;
}

export interface SheetIngredientComputed {
  ingredient_id: string;
  name: string;
  base_unit: StorageUnit;
  quantity_g_ml: number;
  bakers_percentage: number;
  line_cost: number;
  scaled_quantity_g_ml: number;
  scaled_line_cost: number;
  current_stock: number;
  has_sufficient_stock: boolean;
}

export interface TechnicalSheetSummaryComputed {
  base_flour_weight_g: number;
  scaling_factor: number;
  scaled_flour_weight_g: number;
  total_dough_weight_g: number;
  scaled_dough_weight_g: number;
  hydration_pct: number;
  ingredients_cost: number;
  overhead_cost: number;
  total_batch_cost: number;
  scaled_batch_cost: number;
  expected_yield_units: number;
  scaled_yield_units: number;
  unit_cmv: number;
  unit_sale_price: number;
  contribution_margin_brl: number;
  contribution_margin_pct: number;
  bake_loss_pct: number;
  ingredients: SheetIngredientComputed[];
}

export function computeTechnicalSheetMetrics(params: {
  baseFlourWeightG: DecimalInput;
  targetFlourWeightG?: DecimalInput;
  expectedYieldUnits: DecimalInput;
  expectedUnitWeightRawG?: DecimalInput | null;
  expectedUnitWeightBakedG?: DecimalInput | null;
  operationalOverheadPct: DecimalInput;
  productSalePrice: DecimalInput;
  productIsWeighed: boolean;
  ingredients: readonly SheetIngredientCalcInput[];
}): TechnicalSheetSummaryComputed {
  const baseFlour = Decimal.max(new Decimal(params.baseFlourWeightG || 1), 1);
  const targetFlour =
    params.targetFlourWeightG !== undefined ? Decimal.max(new Decimal(params.targetFlourWeightG), 0) : baseFlour;
  const scalingFactor = targetFlour.dividedBy(baseFlour);

  const expectedYield = Decimal.max(new Decimal(params.expectedYieldUnits || 1), 1);
  const overheadPct = Decimal.max(new Decimal(params.operationalOverheadPct || 0), 0);

  let totalDoughWeight = new Decimal(0);
  let totalIngredientsCost = new Decimal(0);
  let waterMl = new Decimal(0);

  const computedIngredients: SheetIngredientComputed[] = params.ingredients.map((ing) => {
    const qty = Decimal.max(new Decimal(ing.quantity_g_ml || 0), 0);
    const unitCost = Decimal.max(new Decimal(ing.avg_cost || 0), 0);
    const stock = new Decimal(ing.current_stock || 0);

    const bakersPct = qty.dividedBy(baseFlour).times(100);
    const lineCost = qty.times(unitCost);
    const scaledQty = qty.times(scalingFactor);
    const scaledCost = lineCost.times(scalingFactor);

    totalDoughWeight = totalDoughWeight.plus(qty);
    totalIngredientsCost = totalIngredientsCost.plus(lineCost);

    if (ing.base_unit === 'ML' || ing.name.toLowerCase().includes('água') || ing.name.toLowerCase().includes('gelo')) {
      waterMl = waterMl.plus(qty);
    }

    return {
      ingredient_id: ing.ingredient_id,
      name: ing.name,
      base_unit: ing.base_unit,
      quantity_g_ml: toDb(qty, SCALE.quantity),
      bakers_percentage: toDb(bakersPct, SCALE.percentage),
      line_cost: toDb(lineCost, 4),
      scaled_quantity_g_ml: toDb(scaledQty, SCALE.quantity),
      scaled_line_cost: toDb(scaledCost, 4),
      current_stock: toDb(stock, SCALE.quantity),
      has_sufficient_stock: stock.gte(scaledQty),
    };
  });

  const overheadCost = totalIngredientsCost.times(overheadPct.dividedBy(100));
  const totalBatchCost = totalIngredientsCost.plus(overheadCost);
  const scaledBatchCost = totalBatchCost.times(scalingFactor);
  const scaledYieldUnits = expectedYield.times(scalingFactor);
  const unitCmv = totalBatchCost.dividedBy(expectedYield);

  const bakedWeightG = new Decimal(params.expectedUnitWeightBakedG || 50);
  const rawWeightG = new Decimal(params.expectedUnitWeightRawG || 65);
  const salePrice = new Decimal(params.productSalePrice || 0);

  // Se o produto é vendido a quilo (ex: Pão Francês R$ 16,90/kg e 50g assado -> R$ 0,845/un)
  const unitSalePrice = params.productIsWeighed ? salePrice.times(bakedWeightG).dividedBy(1000) : salePrice;

  const marginBrl = unitSalePrice.minus(unitCmv);
  const marginPct = unitSalePrice.gt(0) ? marginBrl.dividedBy(unitSalePrice).times(100) : new Decimal(0);

  const bakeLossPct = rawWeightG.gt(0)
    ? rawWeightG.minus(bakedWeightG).dividedBy(rawWeightG).times(100)
    : new Decimal(0);

  const hydrationPct = waterMl.dividedBy(baseFlour).times(100);

  return {
    base_flour_weight_g: toDb(baseFlour, SCALE.quantity),
    scaling_factor: toDb(scalingFactor, SCALE.scalingFactor),
    scaled_flour_weight_g: toDb(targetFlour, SCALE.quantity),
    total_dough_weight_g: toDb(totalDoughWeight, SCALE.quantity),
    scaled_dough_weight_g: toDb(totalDoughWeight.times(scalingFactor), SCALE.quantity),
    hydration_pct: toDb(hydrationPct, SCALE.percentage),
    ingredients_cost: toDb(totalIngredientsCost, 4),
    overhead_cost: toDb(overheadCost, 4),
    total_batch_cost: toDb(totalBatchCost, SCALE.money),
    scaled_batch_cost: toDb(scaledBatchCost, SCALE.money),
    expected_yield_units: toDb(expectedYield, 2),
    scaled_yield_units: toDb(scaledYieldUnits, 2),
    unit_cmv: toDb(unitCmv, 4),
    unit_sale_price: toDb(unitSalePrice, 4),
    contribution_margin_brl: toDb(marginBrl, 4),
    contribution_margin_pct: toDb(marginPct, SCALE.percentage),
    bake_loss_pct: toDb(bakeLossPct, SCALE.percentage),
    ingredients: computedIngredients,
  };
}

