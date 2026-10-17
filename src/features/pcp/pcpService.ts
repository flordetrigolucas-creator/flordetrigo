/**
 * Camada de Execução de Operações Transacionais (Supabase RPC + Fallback Atômico IndexedDB).
 *
 * Em produção conectada ao Supabase, invoca `supabase.rpc('complete_production_order')` e
 * `supabase.rpc('transform_waste_product')`. Quando operando em modo Contingência/Demo local,
 * executa exatamente a mesma lógica FEFO + Custo Médio Ponderado dentro de uma transação Dexie.
 */
import { supabase } from '@/lib/supabase';
import { localDb } from '@/lib/offlineDb';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { Decimal, SCALE, toDb } from '@/lib/decimal';
import type {
  CompleteProductionOrderResult,
  ConsumedIngredient,
  TransformWasteResult,
  WasteType,
} from '@/types/database.types';

export async function executeCompleteProductionOrder(params: {
  orderId: string;
  actualYieldQuantity: number;
  damagedQuantity: number;
  allowNegativeStock?: boolean;
}): Promise<CompleteProductionOrderResult> {
  // 1. Tenta executar no PostgreSQL via RPC atômica
  try {
    const { data, error } = await supabase.rpc('complete_production_order', {
      p_order_id: params.orderId,
      p_actual_yield_quantity: params.actualYieldQuantity,
      p_damaged_quantity: params.damagedQuantity,
      p_allow_negative_stock: params.allowNegativeStock ?? false,
    });
    if (!error && data) {
      await pullSupabaseToLocalCache();
      return data;
    }
    if (error) {
      throw new Error(error.message);
    }
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine && err instanceof Error) {
      throw err;
    }
  }

  // 2. Transação Atômica Local (Dexie) espelhando a PL/pgSQL `complete_production_order`
  return localDb.transaction(
    'rw',
    [
      localDb.productionOrders,
      localDb.technicalSheets,
      localDb.technicalSheetItems,
      localDb.items,
      localDb.inventoryBatches,
    ],
    async () => {
      const op = await localDb.productionOrders.get(params.orderId);
      if (!op) throw new Error('Ordem de Produção não encontrada.');
      if (op.status === 'FINALIZADA' || op.status === 'CANCELADA') {
        throw new Error(`OP #${op.order_number} já está ${op.status}.`);
      }

      const sheet = await localDb.technicalSheets.get(op.sheet_id);
      if (!sheet) throw new Error('Ficha técnica vinculada não encontrada.');

      const product = await localDb.items.get(sheet.product_id);
      if (!product) throw new Error('Produto acabado não encontrado.');

      const sheetItems = await localDb.technicalSheetItems.where('sheet_id').equals(sheet.id).sortBy('sort_order');
      if (sheetItems.length === 0) throw new Error('Ficha técnica sem ingredientes cadastrados.');

      const consumed: ConsumedIngredient[] = [];
      let ingredientsCost = new Decimal(0);

      for (const line of sheetItems) {
        const ing = await localDb.items.get(line.ingredient_id);
        if (!ing) throw new Error(`Insumo ${line.ingredient_id} não encontrado.`);

        const requiredQty = new Decimal(line.quantity_g_ml).times(op.scaling_factor).toDecimalPlaces(SCALE.quantity);
        if (!params.allowNegativeStock && new Decimal(ing.current_stock).lt(requiredQty)) {
          throw new Error(
            `Estoque insuficiente de "${ing.name}": disponível ${ing.current_stock} ${ing.base_unit}, necessário ${requiredQty.toNumber()} ${ing.base_unit}.`,
          );
        }

        // Baixa FEFO nos lotes do insumo
        const batches = await localDb.inventoryBatches.where('item_id').equals(ing.id).toArray();
        batches.sort((a, b) => (a.expiration_date ?? '9999-12-31').localeCompare(b.expiration_date ?? '9999-12-31'));

        let remaining = requiredQty;
        let lineCost = new Decimal(0);

        for (const batch of batches) {
          if (remaining.lte(0)) break;
          if (batch.quantity <= 0) continue;
          const take = Decimal.min(new Decimal(batch.quantity), remaining);
          await localDb.inventoryBatches.update(batch.id, {
            quantity: toDb(new Decimal(batch.quantity).minus(take), SCALE.quantity),
          });
          lineCost = lineCost.plus(take.times(batch.unit_cost));
          remaining = remaining.minus(take);
        }

        if (remaining.gt(0)) {
          lineCost = lineCost.plus(remaining.times(ing.avg_cost));
        }

        await localDb.items.update(ing.id, {
          current_stock: toDb(new Decimal(ing.current_stock).minus(requiredQty), SCALE.quantity),
          updated_at: new Date().toISOString(),
        });

        ingredientsCost = ingredientsCost.plus(lineCost);
        consumed.push({
          ingredient_id: ing.id,
          name: ing.name,
          quantity: toDb(requiredQty, SCALE.quantity),
          unit: ing.base_unit,
          cost: toDb(lineCost, 4),
        });
      }

      const totalProductionCost = ingredientsCost
        .times(new Decimal(1).plus(new Decimal(sheet.operational_overhead_pct).dividedBy(100)))
        .toDecimalPlaces(SCALE.money);

      const stockAdded =
        product.base_unit === 'G'
          ? new Decimal(params.actualYieldQuantity).times(sheet.expected_unit_weight_baked_g ?? 50)
          : new Decimal(params.actualYieldQuantity);

      const prevStock = Decimal.max(new Decimal(product.current_stock), 0);
      const newAvgCost = prevStock
        .times(product.avg_cost)
        .plus(totalProductionCost)
        .dividedBy(prevStock.plus(stockAdded));

      const batchId = crypto.randomUUID();
      const batchCode = `OP-${String(op.order_number).padStart(6, '0')}`;
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + (product.shelf_life_days ?? 1));
      const expirationDate = expDate.toISOString().slice(0, 10);

      await localDb.inventoryBatches.put({
        id: batchId,
        item_id: product.id,
        batch_code: batchCode,
        expiration_date: expirationDate,
        quantity: toDb(stockAdded, SCALE.quantity),
        initial_quantity: toDb(stockAdded, SCALE.quantity),
        unit_cost: toDb(totalProductionCost.dividedBy(stockAdded), SCALE.unitCost),
        reference_id: op.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await localDb.items.update(product.id, {
        current_stock: toDb(new Decimal(product.current_stock).plus(stockAdded), SCALE.quantity),
        avg_cost: toDb(newAvgCost, SCALE.unitCost),
        updated_at: new Date().toISOString(),
      });

      const nowIso = new Date().toISOString();
      await localDb.productionOrders.update(op.id, {
        status: 'FINALIZADA',
        actual_yield_quantity: params.actualYieldQuantity,
        damaged_quantity: params.damagedQuantity,
        total_production_cost: toDb(totalProductionCost, SCALE.money),
        completed_at: nowIso,
        updated_at: nowIso,
      });

      const variancePct = new Decimal(params.actualYieldQuantity)
        .minus(op.planned_quantity)
        .dividedBy(op.planned_quantity)
        .times(100);

      return {
        order_id: op.id,
        order_number: op.order_number,
        product_id: product.id,
        product_name: product.name,
        ingredients_cost: toDb(ingredientsCost, 4),
        total_production_cost: toDb(totalProductionCost, SCALE.money),
        unit_cost: toDb(totalProductionCost.dividedBy(params.actualYieldQuantity), 4),
        stock_added: toDb(stockAdded, SCALE.quantity),
        stock_unit: product.base_unit,
        batch_id: batchId,
        batch_code: batchCode,
        expiration_date: expirationDate,
        planned_quantity: op.planned_quantity,
        yield_variance_pct: toDb(variancePct, SCALE.percentage),
        consumed,
      };
    },
  );
}

export async function executeTransformWasteProduct(params: {
  sourceItemId: string;
  sourceQuantity: number;
  type: WasteType;
  targetItemId?: string | null;
  targetQuantity?: number | null;
  reason?: string | null;
}): Promise<TransformWasteResult> {
  try {
    const { data, error } = await supabase.rpc('transform_waste_product', {
      p_source_item_id: params.sourceItemId,
      p_source_quantity: params.sourceQuantity,
      p_type: params.type,
      p_target_item_id: params.targetItemId ?? null,
      p_target_quantity: params.targetQuantity ?? null,
      p_reason: params.reason ?? null,
    });
    if (!error && data) {
      await pullSupabaseToLocalCache();
      return data;
    }
    if (error) {
      throw new Error(error.message);
    }
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine && err instanceof Error) {
      throw err;
    }
  }

  return localDb.transaction(
    'rw',
    [localDb.items, localDb.inventoryBatches, localDb.wasteRecords],
    async () => {
      const source = await localDb.items.get(params.sourceItemId);
      if (!source) throw new Error('Item de origem não encontrado.');

      const srcQty = new Decimal(params.sourceQuantity);
      if (srcQty.lte(0)) throw new Error('Quantidade de origem deve ser maior que zero.');
      if (new Decimal(source.current_stock).lt(srcQty)) {
        throw new Error(
          `Estoque insuficiente de "${source.name}" (${source.current_stock} ${source.base_unit} disponíveis).`,
        );
      }

      const sourceCost = srcQty.times(source.avg_cost);
      await localDb.items.update(source.id, {
        current_stock: toDb(new Decimal(source.current_stock).minus(srcQty), SCALE.quantity),
        updated_at: new Date().toISOString(),
      });

      const recordId = crypto.randomUUID();
      let targetBatchId: string | null = null;
      let targetUnitCost: number | null = null;
      let yieldRatioPct: number | null = null;

      if (params.type === 'TRANSFORMACAO') {
        if (!params.targetItemId || !params.targetQuantity || params.targetQuantity <= 0) {
          throw new Error('Selecione o subproduto de destino e informe a quantidade gerada.');
        }
        const target = await localDb.items.get(params.targetItemId);
        if (!target) throw new Error('Subproduto de destino não encontrado.');

        const tgtQty = new Decimal(params.targetQuantity);
        const prevStock = Decimal.max(new Decimal(target.current_stock), 0);
        const newTargetAvg = prevStock
          .times(target.avg_cost)
          .plus(sourceCost)
          .dividedBy(prevStock.plus(tgtQty));

        targetUnitCost = toDb(sourceCost.dividedBy(tgtQty), SCALE.unitCost);
        yieldRatioPct = toDb(tgtQty.dividedBy(srcQty).times(100), SCALE.percentage);
        targetBatchId = crypto.randomUUID();

        await localDb.inventoryBatches.put({
          id: targetBatchId,
          item_id: target.id,
          batch_code: `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
          expiration_date: null,
          quantity: toDb(tgtQty, SCALE.quantity),
          initial_quantity: toDb(tgtQty, SCALE.quantity),
          unit_cost: targetUnitCost,
          reference_id: recordId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        await localDb.items.update(target.id, {
          current_stock: toDb(new Decimal(target.current_stock).plus(tgtQty), SCALE.quantity),
          avg_cost: toDb(newTargetAvg, SCALE.unitCost),
          updated_at: new Date().toISOString(),
        });
      }

      await localDb.wasteRecords.put({
        id: recordId,
        source_item_id: source.id,
        source_quantity: toDb(srcQty, SCALE.quantity),
        type: params.type,
        target_item_id: params.targetItemId ?? null,
        target_quantity_generated: params.targetQuantity ?? null,
        transferred_cost: toDb(sourceCost, SCALE.money),
        reason: params.reason ?? null,
        user_id: null,
        created_at: new Date().toISOString(),
      });

      return {
        id: recordId,
        type: params.type,
        source_item_id: source.id,
        source_quantity: toDb(srcQty, SCALE.quantity),
        source_cost: toDb(sourceCost, 4),
        target_item_id: params.targetItemId ?? null,
        target_quantity: params.targetQuantity ?? null,
        target_unit_cost: targetUnitCost,
        target_batch_id: targetBatchId,
        yield_ratio_pct: yieldRatioPct,
      };
    },
  );
}

