import Dexie, { type Table } from 'dexie';
import type {
  ItemRow,
  TechnicalSheetRow,
  TechnicalSheetItemRow,
  ProductionOrderRow,
  CrmCustomerRow,
  CrmConversationRow,
  CrmMessageRow,
  ProductionAlertRow,
  WasteAndTransformationRow,
  InventoryBatchRow,
  PaymentMethod,
  OrderOrigin,
  FiscalStatus,
} from '@/types/database.types';

export interface OfflinePendingSaleItem {
  item_id: string;
  sku: string;
  name: string;
  is_weighed: boolean;
  /** Em gramas se is_weighed = true, ou UN caso contrário */
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface OfflinePendingSale {
  offline_client_id: string;
  origin: OrderOrigin;
  customer_id: string | null;
  cashier_id: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  fiscal_status: FiscalStatus;
  items: OfflinePendingSaleItem[];
  created_at: string;
  synced: 0 | 1;
  sync_error?: string | null;
}

export class FlorDoTrigoLocalDB extends Dexie {
  items!: Table<ItemRow, string>;
  inventoryBatches!: Table<InventoryBatchRow, string>;
  technicalSheets!: Table<TechnicalSheetRow, string>;
  technicalSheetItems!: Table<TechnicalSheetItemRow, string>;
  productionOrders!: Table<ProductionOrderRow, string>;
  productionAlerts!: Table<ProductionAlertRow, string>;
  wasteRecords!: Table<WasteAndTransformationRow, string>;
  customers!: Table<CrmCustomerRow, string>;
  conversations!: Table<CrmConversationRow, string>;
  messages!: Table<CrmMessageRow, string>;
  pendingSales!: Table<OfflinePendingSale, string>;

  constructor() {
    super('FlorDoTrigoOfflineDB');
    this.version(1).stores({
      items: 'id, sku, barcode, scale_plu, type, active',
      inventoryBatches: 'id, item_id, batch_code, expiration_date',
      technicalSheets: 'id, product_id, active',
      technicalSheetItems: 'id, sheet_id, ingredient_id, sort_order',
      productionOrders: 'id, order_number, sheet_id, status, scheduled_for',
      productionAlerts: 'id, alert_type, created_at',
      wasteRecords: 'id, source_item_id, type, created_at',
      customers: 'id, whatsapp_phone, document, customer_type',
      conversations: 'id, whatsapp_phone, status, last_message_at',
      messages: 'id, conversation_id, created_at',
      pendingSales: 'offline_client_id, synced, created_at',
    });
  }
}

export const localDb = new FlorDoTrigoLocalDB();

/**
 * Popula o banco local (IndexedDB) com os dados iniciais realistas da padaria
 * caso ainda esteja vazio, permitindo operação 100% funcional Offline-First.
 */
export async function ensureInitialLocalCatalog(): Promise<void> {
  const count = await localDb.items.count();
  if (count > 0) return;

  const now = new Date().toISOString();
  const inDays = (d: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().slice(0, 10);
  };

  const initialItems: ItemRow[] = [
    {
      id: '10000000-0000-4000-a000-000000000001',
      sku: 'INS-FARINHA-T1',
      barcode: '7891000100103',
      scale_plu: null,
      name: 'Farinha de Trigo Especial Tipo 1',
      type: 'INSUMO',
      base_unit: 'G',
      current_stock: 350000, // 350 kg (7 sacos de 50kg)
      min_stock: 100000,
      avg_cost: 0.003, // R$ 3,00/kg = R$ 150,00 / saco 50kg
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 120,
      ncm: '11010010',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000002',
      sku: 'INS-AGUA-GELO',
      barcode: null,
      scale_plu: null,
      name: 'Água Filtrada / Escama de Gelo',
      type: 'INSUMO',
      base_unit: 'ML',
      current_stock: 500000,
      min_stock: 50000,
      avg_cost: 0.0001,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: null,
      ncm: '22019000',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000003',
      sku: 'INS-SAL',
      barcode: '7891000100202',
      scale_plu: null,
      name: 'Sal Marinho Refinado',
      type: 'INSUMO',
      base_unit: 'G',
      current_stock: 25000,
      min_stock: 5000,
      avg_cost: 0.002,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 365,
      ncm: '25010020',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000004',
      sku: 'INS-MELHORADOR',
      barcode: '7891000100301',
      scale_plu: null,
      name: 'Melhorador Enzimático de Farinha',
      type: 'INSUMO',
      base_unit: 'G',
      current_stock: 10000,
      min_stock: 2000,
      avg_cost: 0.03,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 180,
      ncm: '21069090',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000005',
      sku: 'INS-FERMENTO',
      barcode: '7891000100400',
      scale_plu: null,
      name: 'Fermento Biológico Seco Instantâneo',
      type: 'INSUMO',
      base_unit: 'G',
      current_stock: 5000,
      min_stock: 1500,
      avg_cost: 0.04,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 90,
      ncm: '21021090',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000006',
      sku: 'INS-OLEO-SOJA',
      barcode: '7891000100509',
      scale_plu: null,
      name: 'Óleo Vegetal / Emulsificante',
      type: 'INSUMO',
      base_unit: 'ML',
      current_stock: 9000,
      min_stock: 2000,
      avg_cost: 0.008,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 180,
      ncm: '15079011',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '10000000-0000-4000-a000-000000000007',
      sku: 'INS-MANTEIGA-EXTRA',
      barcode: '7891000100608',
      scale_plu: null,
      name: 'Manteiga Extra Sem Sal (Bloco 5kg)',
      type: 'INSUMO',
      base_unit: 'G',
      current_stock: 15000,
      min_stock: 5000,
      avg_cost: 0.038,
      sale_price: null,
      is_weighed: false,
      shelf_life_days: 45,
      ncm: '04051000',
      cest: null,
      cfop_interno: null,
      tax_rule_id: null,
      active: true,
      created_at: now,
      updated_at: now,
    },
    // Produtos Acabados
    {
      id: '20000000-0000-4000-a000-000000000001',
      sku: 'PA-PAO-FRANCES',
      barcode: null,
      scale_plu: '0101',
      name: 'Pão Francês Tradicional',
      type: 'PRODUTO_ACABADO',
      base_unit: 'G',
      current_stock: 42000, // 42 kg na gaveta/cesto
      min_stock: 10000,
      avg_cost: 0.0036, // R$ 3,60 / kg de custo médio
      sale_price: 16.9, // R$ 16,90 / kg
      is_weighed: true,
      shelf_life_days: 1,
      ncm: '19059090',
      cest: '1706500',
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '20000000-0000-4000-a000-000000000002',
      sku: 'PA-PAO-HAMBURGUER',
      barcode: '7890000000017',
      scale_plu: null,
      name: 'Pão de Hambúrguer Brioche Artesanal',
      type: 'PRODUTO_ACABADO',
      base_unit: 'UN',
      current_stock: 280,
      min_stock: 100,
      avg_cost: 0.48,
      sale_price: 1.85,
      is_weighed: false,
      shelf_life_days: 3,
      ncm: '19059090',
      cest: '1706500',
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '20000000-0000-4000-a000-000000000004',
      sku: 'PA-QUEIJO-PRATO-FAT',
      barcode: null,
      scale_plu: '0205',
      name: 'Queijo Prato Fatiado na Hora',
      type: 'REVENDA',
      base_unit: 'G',
      current_stock: 18500,
      min_stock: 4000,
      avg_cost: 0.036,
      sale_price: 59.9,
      is_weighed: true,
      shelf_life_days: 7,
      ncm: '04069020',
      cest: '1702700',
      cfop_interno: '5405',
      tax_rule_id: '00000000-0000-4000-a000-000000000002',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '20000000-0000-4000-a000-000000000005',
      sku: 'PA-CROISSANT-MANTEIGA',
      barcode: '7890000000024',
      scale_plu: null,
      name: 'Croissant Francês Puro Manteiga',
      type: 'PRODUTO_ACABADO',
      base_unit: 'UN',
      current_stock: 45,
      min_stock: 15,
      avg_cost: 2.15,
      sale_price: 8.9,
      is_weighed: false,
      shelf_life_days: 1,
      ncm: '19059090',
      cest: '1706500',
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
    // Subprodutos (OP Reversa)
    {
      id: '20000000-0000-4000-a000-000000000003',
      sku: 'SP-FARINHA-ROSCA',
      barcode: '7890000000031',
      scale_plu: '0002',
      name: 'Farinha de Rosca Torrada (Reaproveitamento)',
      type: 'SUBPRODUTO',
      base_unit: 'G',
      current_stock: 12500,
      min_stock: 3000,
      avg_cost: 0.0042, // Herdado do pão francês dormido
      sale_price: 18.0, // R$ 18,00 / kg
      is_weighed: true,
      shelf_life_days: 30,
      ncm: '19059090',
      cest: null,
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '20000000-0000-4000-a000-000000000006',
      sku: 'SP-TORRADA-ALHO',
      barcode: '7890000000048',
      scale_plu: '0003',
      name: 'Torrada Temperada na Manteiga e Alho',
      type: 'SUBPRODUTO',
      base_unit: 'G',
      current_stock: 6000,
      min_stock: 2000,
      avg_cost: 0.0055,
      sale_price: 29.9,
      is_weighed: true,
      shelf_life_days: 15,
      ncm: '19054000',
      cest: null,
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
    // Revenda
    {
      id: '30000000-0000-4000-a000-000000000001',
      sku: 'RV-REFRI-COLA-350',
      barcode: '7894900011517',
      scale_plu: null,
      name: 'Refrigerante Cola Lata 350ml',
      type: 'REVENDA',
      base_unit: 'UN',
      current_stock: 72,
      min_stock: 24,
      avg_cost: 3.3,
      sale_price: 6.5,
      is_weighed: false,
      shelf_life_days: 180,
      ncm: '22021000',
      cest: '0300700',
      cfop_interno: '5405',
      tax_rule_id: '00000000-0000-4000-a000-000000000002',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '30000000-0000-4000-a000-000000000002',
      sku: 'RV-CAFE-EXPRESSO',
      barcode: '7890000000093',
      scale_plu: null,
      name: 'Café Expresso Duplo 100% Arábica',
      type: 'PRODUTO_ACABADO',
      base_unit: 'UN',
      current_stock: 500,
      min_stock: 50,
      avg_cost: 1.1,
      sale_price: 6.0,
      is_weighed: false,
      shelf_life_days: 1,
      ncm: '09012100',
      cest: null,
      cfop_interno: '5101',
      tax_rule_id: '00000000-0000-4000-a000-000000000001',
      active: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const batches: InventoryBatchRow[] = [
    {
      id: 'b0000000-0000-4000-a000-000000000001',
      item_id: '10000000-0000-4000-a000-000000000001',
      batch_code: 'LOTE-FAR-02-URGENTE',
      expiration_date: inDays(5), // Vence em 5 dias (Alerta FEFO)
      quantity: 100000,
      initial_quantity: 100000,
      unit_cost: 0.0031,
      reference_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'b0000000-0000-4000-a000-000000000002',
      item_id: '10000000-0000-4000-a000-000000000001',
      batch_code: 'LOTE-FAR-01-NOVO',
      expiration_date: inDays(60),
      quantity: 250000,
      initial_quantity: 250000,
      unit_cost: 0.003,
      reference_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'b0000000-0000-4000-a000-000000000003',
      item_id: '10000000-0000-4000-a000-000000000007',
      batch_code: 'LOTE-MANT-88',
      expiration_date: inDays(3), // Vence em 3 dias (Alerta FEFO crítico)
      quantity: 15000,
      initial_quantity: 15000,
      unit_cost: 0.038,
      reference_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'b0000000-0000-4000-a000-000000000004',
      item_id: '10000000-0000-4000-a000-000000000005',
      batch_code: 'LOTE-FERM-19',
      expiration_date: inDays(9),
      quantity: 5000,
      initial_quantity: 5000,
      unit_cost: 0.04,
      reference_id: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const sheets: TechnicalSheetRow[] = [
    {
      id: '40000000-0000-4000-a000-000000000001',
      product_id: '20000000-0000-4000-a000-000000000001',
      name: 'Receita Base Pão Francês 50kg (Masseira Espiral)',
      base_flour_weight_g: 50000,
      expected_yield_units: 1200,
      expected_unit_weight_raw_g: 65,
      expected_unit_weight_baked_g: 50,
      operational_overhead_pct: 18,
      notes: 'Bater 4 min em 1ª velocidade + 6 min em 2ª velocidade. Ponto de véu. Temperatura final da massa: 26°C.',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '40000000-0000-4000-a000-000000000002',
      product_id: '20000000-0000-4000-a000-000000000002',
      name: 'Pão de Hambúrguer Brioche (Base 25kg Farinha)',
      base_flour_weight_g: 25000,
      expected_yield_units: 480,
      expected_unit_weight_raw_g: 95,
      expected_unit_weight_baked_g: 80,
      operational_overhead_pct: 22,
      notes: 'Adicionar manteiga apenas após desenvolvimento do glúten. Fermentação 90 min a 30°C.',
      active: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const sheetItems: TechnicalSheetItemRow[] = [
    {
      id: '41000000-0000-4000-a000-000000000001',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000001',
      quantity_g_ml: 50000,
      bakers_percentage: 100,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000002',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000002',
      quantity_g_ml: 27500,
      bakers_percentage: 55,
      sort_order: 2,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000003',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000003',
      quantity_g_ml: 1000,
      bakers_percentage: 2,
      sort_order: 3,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000004',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000004',
      quantity_g_ml: 500,
      bakers_percentage: 1,
      sort_order: 4,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000005',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000005',
      quantity_g_ml: 250,
      bakers_percentage: 0.5,
      sort_order: 5,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000006',
      sheet_id: '40000000-0000-4000-a000-000000000001',
      ingredient_id: '10000000-0000-4000-a000-000000000006',
      quantity_g_ml: 100,
      bakers_percentage: 0.2,
      sort_order: 6,
      created_at: now,
      updated_at: now,
    },
    // Brioche
    {
      id: '41000000-0000-4000-a000-000000000007',
      sheet_id: '40000000-0000-4000-a000-000000000002',
      ingredient_id: '10000000-0000-4000-a000-000000000001',
      quantity_g_ml: 25000,
      bakers_percentage: 100,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000008',
      sheet_id: '40000000-0000-4000-a000-000000000002',
      ingredient_id: '10000000-0000-4000-a000-000000000002',
      quantity_g_ml: 11250,
      bakers_percentage: 45,
      sort_order: 2,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000009',
      sheet_id: '40000000-0000-4000-a000-000000000002',
      ingredient_id: '10000000-0000-4000-a000-000000000007',
      quantity_g_ml: 3750,
      bakers_percentage: 15,
      sort_order: 3,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000010',
      sheet_id: '40000000-0000-4000-a000-000000000002',
      ingredient_id: '10000000-0000-4000-a000-000000000003',
      quantity_g_ml: 500,
      bakers_percentage: 2,
      sort_order: 4,
      created_at: now,
      updated_at: now,
    },
    {
      id: '41000000-0000-4000-a000-000000000011',
      sheet_id: '40000000-0000-4000-a000-000000000002',
      ingredient_id: '10000000-0000-4000-a000-000000000005',
      quantity_g_ml: 375,
      bakers_percentage: 1.5,
      sort_order: 5,
      created_at: now,
      updated_at: now,
    },
  ];

  const productionOrders: ProductionOrderRow[] = [
    {
      id: '60000000-0000-4000-a000-000000000001',
      order_number: 101,
      sheet_id: '40000000-0000-4000-a000-000000000001',
      baker_id: 'aaaaaaaa-0000-4000-a000-000000000003',
      sales_order_id: null,
      status: 'ASSANDO',
      scaling_factor: 0.3, // 15kg de farinha = 360 pães
      planned_quantity: 360,
      actual_yield_quantity: null,
      damaged_quantity: 0,
      total_production_cost: null,
      scheduled_for: now,
      started_at: now,
      completed_at: null,
      notes: 'Fornada das 17h30 — Forno Turbo 01 (Vapor 4s)',
      created_by: 'aaaaaaaa-0000-4000-a000-000000000002',
      created_at: now,
      updated_at: now,
    },
    {
      id: '60000000-0000-4000-a000-000000000002',
      order_number: 102,
      sheet_id: '40000000-0000-4000-a000-000000000002',
      baker_id: null,
      sales_order_id: null,
      status: 'PLANEJADA',
      scaling_factor: 0.5, // 12,5kg de farinha = 240 pães de hambúrguer
      planned_quantity: 240,
      actual_yield_quantity: null,
      damaged_quantity: 0,
      total_production_cost: null,
      scheduled_for: now,
      started_at: null,
      completed_at: null,
      notes: 'Encomenda B2B Hamburgueria Brasa Viva (Entrega 07h)',
      created_by: 'aaaaaaaa-0000-4000-a000-000000000002',
      created_at: now,
      updated_at: now,
    },
  ];

  const customers: CrmCustomerRow[] = [
    {
      id: '50000000-0000-4000-a000-000000000001',
      name: 'Hamburgueria Brasa Viva LTDA',
      document: '12345678000195',
      whatsapp_phone: '5511987650001',
      email: 'compras@brasaviva.com.br',
      customer_type: 'B2B',
      credit_limit: 4500,
      current_balance_due: 1280.5,
      billing_cycle_day: 10,
      recurring_order_json: [
        {
          item_id: '20000000-0000-4000-a000-000000000002',
          quantity: 150,
          weekdays: [1, 2, 3, 4, 5, 6],
          delivery_time: '07:00',
        },
      ],
      notes: 'Entregar na doca lateral até 07:15h. Pão selado em pacotes de 15 un.',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '50000000-0000-4000-a000-000000000002',
      name: 'Empório & Padaria São Bento B2B',
      document: '98765432000110',
      whatsapp_phone: '5511987650009',
      email: 'financeiro@emporiosaobento.com.br',
      customer_type: 'B2B',
      credit_limit: 8000,
      current_balance_due: 3420,
      billing_cycle_day: 15,
      recurring_order_json: [
        {
          item_id: '20000000-0000-4000-a000-000000000001',
          quantity: 25000,
          weekdays: [1, 2, 3, 4, 5],
          delivery_time: '06:00',
        },
      ],
      notes: 'Pão Francês pré-assado ultracongelado.',
      active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: '50000000-0000-4000-a000-000000000003',
      name: 'Maria Clara Souza',
      document: '12345678909',
      whatsapp_phone: '5511987650002',
      email: 'mariaclara@email.com',
      customer_type: 'B2C',
      credit_limit: 0,
      current_balance_due: 0,
      billing_cycle_day: null,
      recurring_order_json: [],
      notes: 'Cliente recorrente de coffee break e croissants aos sábados.',
      active: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const conversations: CrmConversationRow[] = [
    {
      id: '70000000-0000-4000-a000-000000000001',
      customer_id: '50000000-0000-4000-a000-000000000001',
      whatsapp_phone: '5511987650001',
      contact_name: 'Rodrigo — Hamburgueria Brasa Viva',
      status: 'IA_ATIVA',
      assigned_to: null,
      ai_paused_at: null,
      last_message_at: now,
      last_message_preview: 'Para amanhã às 07h preciso aumentar para 180 pães de hambúrguer brioche!',
      unread_count: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: '70000000-0000-4000-a000-000000000002',
      customer_id: '50000000-0000-4000-a000-000000000003',
      whatsapp_phone: '5511987650002',
      contact_name: 'Maria Clara Souza',
      status: 'HUMANO',
      assigned_to: 'aaaaaaaa-0000-4000-a000-000000000005',
      ai_paused_at: now,
      last_message_at: now,
      last_message_preview: 'Gostaria de personalizar uma cesta com croissants e suco natural.',
      unread_count: 0,
      created_at: now,
      updated_at: now,
    },
  ];

  const messages: CrmMessageRow[] = [
    {
      id: '71000000-0000-4000-a000-000000000001',
      conversation_id: '70000000-0000-4000-a000-000000000001',
      sender: 'CLIENTE',
      sender_user_id: null,
      content: 'Bom dia! Aqui é o Rodrigo da Brasa Viva.',
      media_url: null,
      external_id: 'EVO-001',
      metadata: {},
      created_at: new Date(Date.now() - 360000).toISOString(),
    },
    {
      id: '71000000-0000-4000-a000-000000000002',
      conversation_id: '70000000-0000-4000-a000-000000000001',
      sender: 'IA',
      sender_user_id: null,
      content:
        'Olá Rodrigo! Reconheci o cadastro B2B da Hamburgueria Brasa Viva LTDA. Seu limite disponível para faturamento no dia 10 é de R$ 3.219,50. Deseja manter o pedido recorrente de 150 pães de hambúrguer para amanhã às 07:00?',
      media_url: null,
      external_id: 'EVO-002',
      metadata: { model: 'n8n-agent-bakery', confidence: 0.98 },
      created_at: new Date(Date.now() - 300000).toISOString(),
    },
    {
      id: '71000000-0000-4000-a000-000000000003',
      conversation_id: '70000000-0000-4000-a000-000000000001',
      sender: 'CLIENTE',
      sender_user_id: null,
      content: 'Para amanhã às 07h preciso aumentar para 180 pães de hambúrguer brioche!',
      media_url: null,
      external_id: 'EVO-003',
      metadata: {},
      created_at: now,
    },
    {
      id: '71000000-0000-4000-a000-000000000004',
      conversation_id: '70000000-0000-4000-a000-000000000002',
      sender: 'CLIENTE',
      sender_user_id: null,
      content: 'Gostaria de personalizar uma cesta com croissants e suco natural.',
      media_url: null,
      external_id: 'EVO-004',
      metadata: {},
      created_at: now,
    },
  ];

  const alerts: ProductionAlertRow[] = [
    {
      id: '80000000-0000-4000-a000-000000000001',
      alert_type: 'NOVA_ENCOMENDA',
      title: 'Encomenda B2B via Agente IA — Amanhã 07:00',
      message: 'Hamburgueria Brasa Viva: 150 un Pão de Hambúrguer Brioche (Pedido fixo diário)',
      sales_order_id: null,
      payload: { customer: 'Hamburgueria Brasa Viva LTDA', quantity: 150 },
      acknowledged_at: null,
      acknowledged_by: null,
      created_at: now,
    },
  ];

  await localDb.transaction(
    'rw',
    [
      localDb.items,
      localDb.inventoryBatches,
      localDb.technicalSheets,
      localDb.technicalSheetItems,
      localDb.productionOrders,
      localDb.customers,
      localDb.conversations,
      localDb.messages,
      localDb.productionAlerts,
    ],
    async () => {
      await localDb.items.bulkPut(initialItems);
      await localDb.inventoryBatches.bulkPut(batches);
      await localDb.technicalSheets.bulkPut(sheets);
      await localDb.technicalSheetItems.bulkPut(sheetItems);
      await localDb.productionOrders.bulkPut(productionOrders);
      await localDb.customers.bulkPut(customers);
      await localDb.conversations.bulkPut(conversations);
      await localDb.messages.bulkPut(messages);
      await localDb.productionAlerts.bulkPut(alerts);
    },
  );
}

