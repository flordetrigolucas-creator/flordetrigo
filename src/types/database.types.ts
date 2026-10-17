/**
 * Tipos do banco Supabase — espelho fiel das migrations em /supabase/migrations.
 *
 * Mantido manualmente no formato do `supabase gen types` para que o client
 * (`createClient<Database>`) infira tipos em selects, inserts e RPCs.
 * Para regenerar a partir do banco local: `npm run db:types` e compare.
 *
 * IMPORTANTE: colunas NUMERIC chegam como `number` via PostgREST. Toda
 * aritmética financeira/peso no frontend DEVE passar por `@/lib/decimal`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/* ============================================================================
 * ENUMS
 * ========================================================================== */
export type UserRole = 'ADMIN' | 'GERENTE' | 'CAIXA' | 'PADEIRO' | 'ATENDENTE';
export type ItemType = 'INSUMO' | 'PRODUTO_ACABADO' | 'SUBPRODUTO' | 'REVENDA';
export type UnitOfMeasure = 'G' | 'KG' | 'ML' | 'L' | 'UN';
/** Unidades efetivamente aceitas em `items.base_unit` (constraint items_base_unit_storage). */
export type StorageUnit = Extract<UnitOfMeasure, 'G' | 'ML' | 'UN'>;
export type ProductionStatus = 'PLANEJADA' | 'EM_PRODUCAO' | 'ASSANDO' | 'FINALIZADA' | 'CANCELADA';
export type WasteType = 'DESCARTE_PERDA' | 'TRANSFORMACAO';
export type StockMovementType =
  | 'ENTRADA_NF'
  | 'SAIDA_OP'
  | 'ENTRADA_OP'
  | 'SAIDA_VENDA'
  | 'PERDA'
  | 'TRANSFORMACAO_SAIDA'
  | 'TRANSFORMACAO_ENTRADA'
  | 'AJUSTE_INVENTARIO';
export type CustomerType = 'B2C' | 'B2B';
export type OrderOrigin = 'PDV_BALCAO' | 'WHATSAPP_IA' | 'B2B_RECORRENTE' | 'IFOOD';
export type OrderStatus = 'PENDENTE_PRODUCAO' | 'PRONTO_RETIRADA' | 'CONCLUIDA' | 'CANCELADA';
export type PaymentMethod = 'PIX' | 'CREDITO' | 'DEBITO' | 'DINHEIRO' | 'FATURADO_B2B';
export type FiscalStatus = 'PENDENTE' | 'EMITIDA' | 'CONTINGENCIA_OFFLINE' | 'ERRO';
export type ConversationStatus = 'IA_ATIVA' | 'HUMANO' | 'ENCERRADA';
export type MessageSender = 'CLIENTE' | 'IA' | 'HUMANO' | 'SISTEMA';
export type ProductionAlertType = 'NOVA_ENCOMENDA' | 'ESTOQUE_MINIMO' | 'LOTE_VENCENDO' | 'ALTERACAO_ENCOMENDA';
export type NfeImportStatus = 'RASCUNHO' | 'CONFIRMADA' | 'CANCELADA';

/** ISO-8601 (timestamptz) */
type Timestamp = string;
/** YYYY-MM-DD (date) */
type DateString = string;
type Uuid = string;

/* ============================================================================
 * HELPERS DE DEFINIÇÃO DE TABELA
 * ========================================================================== */
type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

/**
 * Insert: colunas em `Optional` (defaults/nullable/gerados) tornam-se opcionais;
 * colunas em `Generated` (identity/generated always) são proibidas.
 */
type TableDef<
  Row extends Record<string, unknown>,
  Optional extends keyof Row,
  Generated extends keyof Row = never,
  Rels extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Omit<Row, Optional | Generated> & Partial<Pick<Row, Exclude<Optional, Generated>>> & {
    [K in Generated]?: never;
  };
  Update: Partial<Omit<Row, Generated>> & { [K in Generated]?: never };
  Relationships: Rels;
};

type Fk<Name extends string, Col extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ['id'];
};

/* ============================================================================
 * ROWS
 * ========================================================================== */
export type ProfileRow = {
  id: Uuid;
  full_name: string;
  role: UserRole;
  commission_rate: number;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type TaxRuleRow = {
  id: Uuid;
  name: string;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
  csosn_cst: string;
  icms_rate: number;
  pis_rate: number;
  cofins_rate: number;
  has_icms_st: boolean;
  description: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ItemRow = {
  id: Uuid;
  sku: string;
  barcode: string | null;
  scale_plu: string | null;
  name: string;
  type: ItemType;
  base_unit: StorageUnit;
  /** Unidade base (g/ml/un). Somente leitura no client — alterado via RPC. */
  current_stock: number;
  min_stock: number;
  /** CMV unitário por unidade base (R$/g, R$/ml ou R$/un). */
  avg_cost: number;
  /** R$/kg se `is_weighed`; R$/un caso contrário. */
  sale_price: number | null;
  is_weighed: boolean;
  shelf_life_days: number | null;
  ncm: string | null;
  cest: string | null;
  cfop_interno: string | null;
  tax_rule_id: Uuid | null;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type InventoryBatchRow = {
  id: Uuid;
  item_id: Uuid;
  batch_code: string;
  expiration_date: DateString | null;
  quantity: number;
  initial_quantity: number;
  unit_cost: number;
  reference_id: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type TechnicalSheetRow = {
  id: Uuid;
  product_id: Uuid;
  name: string;
  base_flour_weight_g: number;
  expected_yield_units: number;
  expected_unit_weight_raw_g: number | null;
  expected_unit_weight_baked_g: number | null;
  operational_overhead_pct: number;
  notes: string | null;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type TechnicalSheetItemRow = {
  id: Uuid;
  sheet_id: Uuid;
  ingredient_id: Uuid;
  quantity_g_ml: number;
  /** Calculado pelo banco (trigger) — enviado em inserts é ignorado. */
  bakers_percentage: number;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ProductionOrderRow = {
  id: Uuid;
  order_number: number;
  sheet_id: Uuid;
  baker_id: Uuid | null;
  sales_order_id: Uuid | null;
  status: ProductionStatus;
  scaling_factor: number;
  planned_quantity: number;
  actual_yield_quantity: number | null;
  damaged_quantity: number;
  total_production_cost: number | null;
  scheduled_for: Timestamp;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  notes: string | null;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type WasteAndTransformationRow = {
  id: Uuid;
  source_item_id: Uuid;
  source_quantity: number;
  type: WasteType;
  target_item_id: Uuid | null;
  target_quantity_generated: number | null;
  transferred_cost: number;
  reason: string | null;
  user_id: Uuid | null;
  created_at: Timestamp;
};

export type StockMovementRow = {
  id: Uuid;
  item_id: Uuid;
  batch_id: Uuid | null;
  movement_type: StockMovementType;
  /** Assinada: entradas > 0, saídas < 0. */
  quantity: number;
  unit_cost_at_moment: number;
  reference_id: Uuid | null;
  notes: string | null;
  created_by: Uuid | null;
  created_at: Timestamp;
};

export type RecurringOrderLine = {
  item_id: Uuid;
  quantity: number;
  /** 0 = domingo … 6 = sábado */
  weekdays: number[];
  /** HH:MM */
  delivery_time: string;
};

export type CrmCustomerRow = {
  id: Uuid;
  name: string;
  document: string | null;
  /** 55 + DDD + número, somente dígitos. */
  whatsapp_phone: string | null;
  email: string | null;
  customer_type: CustomerType;
  credit_limit: number;
  current_balance_due: number;
  billing_cycle_day: number | null;
  recurring_order_json: RecurringOrderLine[];
  notes: string | null;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type OrderRow = {
  id: Uuid;
  order_number: number;
  origin: OrderOrigin;
  customer_id: Uuid | null;
  cashier_or_attendant_id: Uuid | null;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  fiscal_status: FiscalStatus;
  fiscal_key: string | null;
  delivery_date: Timestamp | null;
  offline_client_id: Uuid | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type OrderItemRow = {
  id: Uuid;
  order_id: Uuid;
  item_id: Uuid;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_cost_at_sale: number | null;
  created_at: Timestamp;
};

export type CrmConversationRow = {
  id: Uuid;
  customer_id: Uuid | null;
  whatsapp_phone: string;
  contact_name: string | null;
  status: ConversationStatus;
  assigned_to: Uuid | null;
  ai_paused_at: Timestamp | null;
  last_message_at: Timestamp;
  last_message_preview: string | null;
  unread_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type CrmMessageRow = {
  id: Uuid;
  conversation_id: Uuid;
  sender: MessageSender;
  sender_user_id: Uuid | null;
  content: string;
  media_url: string | null;
  external_id: string | null;
  metadata: Json;
  created_at: Timestamp;
};

export type ProductionAlertRow = {
  id: Uuid;
  alert_type: ProductionAlertType;
  title: string;
  message: string;
  sales_order_id: Uuid | null;
  payload: Json;
  acknowledged_at: Timestamp | null;
  acknowledged_by: Uuid | null;
  created_at: Timestamp;
};

export type NfeImportRow = {
  id: Uuid;
  access_key: string;
  supplier_cnpj: string;
  supplier_name: string;
  invoice_number: string;
  series: string;
  issued_at: Timestamp;
  total_amount: number;
  status: NfeImportStatus;
  raw_xml: string;
  imported_by: Uuid | null;
  confirmed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type NfeImportItemRow = {
  id: Uuid;
  import_id: Uuid;
  line_number: number;
  supplier_product_code: string;
  description: string;
  ncm: string | null;
  commercial_unit: string;
  commercial_quantity: number;
  commercial_unit_value: number;
  total_value: number;
  linked_item_id: Uuid | null;
  conversion_factor: number | null;
  /** Gerada: commercial_quantity × conversion_factor. */
  base_quantity: number | null;
  batch_code: string | null;
  expiration_date: DateString | null;
};

export type UnitConversionRow = {
  id: Uuid;
  supplier_cnpj: string;
  supplier_product_code: string;
  commercial_unit: string;
  item_id: Uuid;
  factor_to_base: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/* ============================================================================
 * VIEWS
 * ========================================================================== */
export type B2bAccountView = {
  id: Uuid;
  name: string;
  document: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  credit_limit: number;
  current_balance_due: number;
  available_credit: number;
  billing_cycle_day: number | null;
  recurring_order_json: RecurringOrderLine[];
  active: boolean;
  created_at: Timestamp;
};

export type TechnicalSheetCostView = {
  sheet_id: Uuid;
  sheet_name: string;
  product_id: Uuid;
  product_name: string;
  is_weighed: boolean;
  sale_price: number | null;
  base_flour_weight_g: number;
  expected_yield_units: number;
  expected_unit_weight_raw_g: number | null;
  expected_unit_weight_baked_g: number | null;
  operational_overhead_pct: number;
  ingredient_count: number;
  ingredients_cost: number;
  total_batch_cost: number;
  unit_sale_price: number | null;
  unit_cmv: number;
  contribution_margin_pct: number | null;
};

/* ============================================================================
 * RETORNOS DAS RPCs
 * ========================================================================== */
export type ConsumedIngredient = {
  ingredient_id: Uuid;
  name: string;
  quantity: number;
  unit: StorageUnit;
  cost: number;
};

export type CompleteProductionOrderResult = {
  order_id: Uuid;
  order_number: number;
  product_id: Uuid;
  product_name: string;
  ingredients_cost: number;
  total_production_cost: number;
  unit_cost: number;
  stock_added: number;
  stock_unit: StorageUnit;
  batch_id: Uuid;
  batch_code: string;
  expiration_date: DateString | null;
  planned_quantity: number;
  yield_variance_pct: number;
  consumed: ConsumedIngredient[];
};

export type TransformWasteResult = {
  id: Uuid;
  type: WasteType;
  source_item_id: Uuid;
  source_quantity: number;
  source_cost: number;
  target_item_id: Uuid | null;
  target_quantity: number | null;
  target_unit_cost: number | null;
  target_batch_id: Uuid | null;
  yield_ratio_pct: number | null;
};

export type AdjustInventoryResult = {
  reference_id: Uuid;
  item_id: Uuid;
  previous_stock: number;
  counted_stock: number;
  delta: number;
  cost_impact: number;
};

type CompleteProductionOrderArgs = {
  p_order_id: Uuid;
  p_actual_yield_quantity: number;
  p_damaged_quantity?: number;
  p_allow_negative_stock?: boolean;
};

/* ============================================================================
 * DATABASE
 * ========================================================================== */
export type Database = {
  public: {
    Tables: {
      profiles: TableDef<ProfileRow, 'role' | 'commission_rate' | 'active' | 'created_at' | 'updated_at'>;
      tax_rules: TableDef<
        TaxRuleRow,
        'id' | 'regime' | 'icms_rate' | 'pis_rate' | 'cofins_rate' | 'has_icms_st' | 'description' | 'created_at' | 'updated_at'
      >;
      items: TableDef<
        ItemRow,
        | 'id'
        | 'barcode'
        | 'scale_plu'
        | 'current_stock'
        | 'min_stock'
        | 'avg_cost'
        | 'sale_price'
        | 'is_weighed'
        | 'shelf_life_days'
        | 'ncm'
        | 'cest'
        | 'cfop_interno'
        | 'tax_rule_id'
        | 'active'
        | 'created_at'
        | 'updated_at',
        never,
        [Fk<'items_tax_rule_id_fkey', 'tax_rule_id', 'tax_rules'>]
      >;
      inventory_batches: TableDef<
        InventoryBatchRow,
        'id' | 'expiration_date' | 'quantity' | 'unit_cost' | 'reference_id' | 'created_at' | 'updated_at',
        never,
        [Fk<'inventory_batches_item_id_fkey', 'item_id', 'items'>]
      >;
      technical_sheets: TableDef<
        TechnicalSheetRow,
        | 'id'
        | 'expected_unit_weight_raw_g'
        | 'expected_unit_weight_baked_g'
        | 'operational_overhead_pct'
        | 'notes'
        | 'active'
        | 'created_at'
        | 'updated_at',
        never,
        [Fk<'technical_sheets_product_id_fkey', 'product_id', 'items'>]
      >;
      technical_sheet_items: TableDef<
        TechnicalSheetItemRow,
        'id' | 'bakers_percentage' | 'sort_order' | 'created_at' | 'updated_at',
        never,
        [
          Fk<'technical_sheet_items_sheet_id_fkey', 'sheet_id', 'technical_sheets'>,
          Fk<'technical_sheet_items_ingredient_id_fkey', 'ingredient_id', 'items'>,
        ]
      >;
      production_orders: TableDef<
        ProductionOrderRow,
        | 'id'
        | 'baker_id'
        | 'sales_order_id'
        | 'status'
        | 'scaling_factor'
        | 'actual_yield_quantity'
        | 'damaged_quantity'
        | 'total_production_cost'
        | 'scheduled_for'
        | 'started_at'
        | 'completed_at'
        | 'notes'
        | 'created_by'
        | 'created_at'
        | 'updated_at',
        'order_number',
        [
          Fk<'production_orders_sheet_id_fkey', 'sheet_id', 'technical_sheets'>,
          Fk<'production_orders_baker_id_fkey', 'baker_id', 'profiles'>,
          Fk<'production_orders_sales_order_id_fkey', 'sales_order_id', 'orders_and_pos_sales'>,
        ]
      >;
      waste_and_transformations: TableDef<
        WasteAndTransformationRow,
        'id' | 'target_item_id' | 'target_quantity_generated' | 'transferred_cost' | 'reason' | 'user_id' | 'created_at',
        never,
        [
          Fk<'waste_and_transformations_source_item_id_fkey', 'source_item_id', 'items'>,
          Fk<'waste_and_transformations_target_item_id_fkey', 'target_item_id', 'items'>,
        ]
      >;
      stock_movements: TableDef<
        StockMovementRow,
        'id' | 'batch_id' | 'reference_id' | 'notes' | 'created_by' | 'created_at',
        never,
        [
          Fk<'stock_movements_item_id_fkey', 'item_id', 'items'>,
          Fk<'stock_movements_batch_id_fkey', 'batch_id', 'inventory_batches'>,
        ]
      >;
      crm_customers: TableDef<
        CrmCustomerRow,
        | 'id'
        | 'document'
        | 'whatsapp_phone'
        | 'email'
        | 'customer_type'
        | 'credit_limit'
        | 'current_balance_due'
        | 'billing_cycle_day'
        | 'recurring_order_json'
        | 'notes'
        | 'active'
        | 'created_at'
        | 'updated_at'
      >;
      orders_and_pos_sales: TableDef<
        OrderRow,
        | 'id'
        | 'customer_id'
        | 'cashier_or_attendant_id'
        | 'subtotal'
        | 'discount'
        | 'total'
        | 'payment_method'
        | 'fiscal_status'
        | 'fiscal_key'
        | 'delivery_date'
        | 'offline_client_id'
        | 'notes'
        | 'created_at'
        | 'updated_at',
        'order_number',
        [
          Fk<'orders_and_pos_sales_customer_id_fkey', 'customer_id', 'crm_customers'>,
          Fk<'orders_and_pos_sales_cashier_or_attendant_id_fkey', 'cashier_or_attendant_id', 'profiles'>,
        ]
      >;
      order_items: TableDef<
        OrderItemRow,
        'id' | 'unit_cost_at_sale' | 'created_at',
        never,
        [
          Fk<'order_items_order_id_fkey', 'order_id', 'orders_and_pos_sales'>,
          Fk<'order_items_item_id_fkey', 'item_id', 'items'>,
        ]
      >;
      crm_conversations: TableDef<
        CrmConversationRow,
        | 'id'
        | 'customer_id'
        | 'contact_name'
        | 'status'
        | 'assigned_to'
        | 'ai_paused_at'
        | 'last_message_at'
        | 'last_message_preview'
        | 'unread_count'
        | 'created_at'
        | 'updated_at',
        never,
        [
          Fk<'crm_conversations_customer_id_fkey', 'customer_id', 'crm_customers'>,
          Fk<'crm_conversations_assigned_to_fkey', 'assigned_to', 'profiles'>,
        ]
      >;
      crm_messages: TableDef<
        CrmMessageRow,
        'id' | 'sender_user_id' | 'media_url' | 'external_id' | 'metadata' | 'created_at',
        never,
        [Fk<'crm_messages_conversation_id_fkey', 'conversation_id', 'crm_conversations'>]
      >;
      production_alerts: TableDef<
        ProductionAlertRow,
        'id' | 'sales_order_id' | 'payload' | 'acknowledged_at' | 'acknowledged_by' | 'created_at',
        never,
        [Fk<'production_alerts_sales_order_id_fkey', 'sales_order_id', 'orders_and_pos_sales'>]
      >;
      nfe_imports: TableDef<NfeImportRow, 'id' | 'status' | 'imported_by' | 'confirmed_at' | 'created_at' | 'updated_at'>;
      nfe_import_items: TableDef<
        NfeImportItemRow,
        'id' | 'ncm' | 'linked_item_id' | 'conversion_factor' | 'batch_code' | 'expiration_date',
        'base_quantity',
        [
          Fk<'nfe_import_items_import_id_fkey', 'import_id', 'nfe_imports'>,
          Fk<'nfe_import_items_linked_item_id_fkey', 'linked_item_id', 'items'>,
        ]
      >;
      unit_conversions: TableDef<
        UnitConversionRow,
        'id' | 'created_at' | 'updated_at',
        never,
        [Fk<'unit_conversions_item_id_fkey', 'item_id', 'items'>]
      >;
    };
    Views: {
      b2b_accounts: { Row: B2bAccountView; Relationships: [] };
      v_technical_sheet_costs: {
        Row: TechnicalSheetCostView;
        Relationships: [Fk<'technical_sheets_product_id_fkey', 'product_id', 'items'>];
      };
    };
    Functions: {
      complete_production_order: { Args: CompleteProductionOrderArgs; Returns: CompleteProductionOrderResult };
      execute_production_order: { Args: CompleteProductionOrderArgs; Returns: CompleteProductionOrderResult };
      transform_waste_product: {
        Args: {
          p_source_item_id: Uuid;
          p_source_quantity: number;
          p_type: WasteType;
          p_target_item_id?: Uuid | null;
          p_target_quantity?: number | null;
          p_reason?: string | null;
          p_allow_negative_stock?: boolean;
        };
        Returns: TransformWasteResult;
      };
      adjust_inventory: {
        Args: {
          p_item_id: Uuid;
          p_counted_quantity: number;
          p_reason: string;
          p_unit_cost?: number | null;
          p_batch_code?: string | null;
          p_expiration_date?: DateString | null;
        };
        Returns: AdjustInventoryResult;
      };
      record_pos_or_ai_sale: {
        Args: {
          p_origin: OrderOrigin;
          p_payment_method: PaymentMethod;
          p_items: Json;
          p_discount?: number;
          p_customer_id?: Uuid | null;
          p_delivery_date?: Timestamp | null;
          p_offline_client_id?: Uuid | null;
          p_notes?: string | null;
        };
        Returns: {
          order_id: Uuid;
          order_number: number;
          total: number;
          status?: OrderStatus;
          idempotent: boolean;
        };
      };
      confirm_nfe_xml_entry: {
        Args: {
          p_access_key: string;
          p_supplier_cnpj: string;
          p_supplier_name: string;
          p_invoice_number: string;
          p_series: string;
          p_issued_at: Timestamp;
          p_total_amount: number;
          p_raw_xml: string;
          p_lines: Json;
        };
        Returns: {
          import_id: Uuid;
          invoice_number: string;
          lines_imported: number;
        };
      };
      current_user_role: { Args: Record<string, never>; Returns: UserRole | null };
      has_role: { Args: { p_roles: UserRole[] }; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      item_type: ItemType;
      unit_of_measure: UnitOfMeasure;
      production_status: ProductionStatus;
      waste_type: WasteType;
      stock_movement_type: StockMovementType;
      customer_type: CustomerType;
      order_origin: OrderOrigin;
      order_status: OrderStatus;
      payment_method: PaymentMethod;
      fiscal_status: FiscalStatus;
      conversation_status: ConversationStatus;
      message_sender: MessageSender;
      production_alert_type: ProductionAlertType;
      nfe_import_status: NfeImportStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

/* ============================================================================
 * ATALHOS DE USO
 * ========================================================================== */
type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
export type RpcArgs<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Args'];
export type RpcReturns<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Returns'];

