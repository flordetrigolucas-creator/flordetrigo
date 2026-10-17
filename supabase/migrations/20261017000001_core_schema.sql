-- =============================================================================
-- Flor do Trigo ERP — Migration 001: Core Schema
-- -----------------------------------------------------------------------------
-- Convenções:
--   * Quantidades/pesos de estoque: NUMERIC(12,4) — SEMPRE na unidade base (G, ML, UN).
--   * Valores monetários:            NUMERIC(10,2).
--   * Custos unitários (CMV):        NUMERIC(12,4) (precisão sub-centavo p/ gramas).
--   * Nenhuma coluna FLOAT/REAL/DOUBLE é permitida neste schema.
--   * current_stock / avg_cost só mudam via funções RPC (ver migration 002).
-- =============================================================================

-- gen_random_uuid() é nativo desde o PostgreSQL 13 (não requer pgcrypto).
create extension if not exists pg_trgm;

-- =============================================================================
-- ENUMS
-- =============================================================================
create type public.user_role as enum ('ADMIN', 'GERENTE', 'CAIXA', 'PADEIRO', 'ATENDENTE');

create type public.item_type as enum ('INSUMO', 'PRODUTO_ACABADO', 'SUBPRODUTO', 'REVENDA');

-- KG e L existem apenas como unidades de compra/exibição; o estoque é
-- armazenado exclusivamente em G, ML ou UN (constraint items_base_unit_storage).
create type public.unit_of_measure as enum ('G', 'KG', 'ML', 'L', 'UN');

create type public.production_status as enum ('PLANEJADA', 'EM_PRODUCAO', 'ASSANDO', 'FINALIZADA', 'CANCELADA');

create type public.waste_type as enum ('DESCARTE_PERDA', 'TRANSFORMACAO');

create type public.stock_movement_type as enum (
  'ENTRADA_NF',
  'SAIDA_OP',
  'ENTRADA_OP',
  'SAIDA_VENDA',
  'PERDA',
  'TRANSFORMACAO_SAIDA',
  'TRANSFORMACAO_ENTRADA',
  'AJUSTE_INVENTARIO'
);

create type public.customer_type as enum ('B2C', 'B2B');

create type public.order_origin as enum ('PDV_BALCAO', 'WHATSAPP_IA', 'B2B_RECORRENTE', 'IFOOD');

create type public.order_status as enum ('PENDENTE_PRODUCAO', 'PRONTO_RETIRADA', 'CONCLUIDA', 'CANCELADA');

create type public.payment_method as enum ('PIX', 'CREDITO', 'DEBITO', 'DINHEIRO', 'FATURADO_B2B');

create type public.fiscal_status as enum ('PENDENTE', 'EMITIDA', 'CONTINGENCIA_OFFLINE', 'ERRO');

create type public.conversation_status as enum ('IA_ATIVA', 'HUMANO', 'ENCERRADA');

create type public.message_sender as enum ('CLIENTE', 'IA', 'HUMANO', 'SISTEMA');

create type public.production_alert_type as enum ('NOVA_ENCOMENDA', 'ESTOQUE_MINIMO', 'LOTE_VENCENDO', 'ALTERACAO_ENCOMENDA');

create type public.nfe_import_status as enum ('RASCUNHO', 'CONFIRMADA', 'CANCELADA');

-- =============================================================================
-- FUNÇÕES UTILITÁRIAS DE TRIGGER
-- =============================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Indica se a transação corrente está dentro de uma função RPC transacional
-- autorizada (a flag é setada com set_config(..., is_local => true)).
create or replace function public.in_rpc_context()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.rpc_context', true), '') = 'on';
$$;

-- =============================================================================
-- 1. PROFILES (RBAC)
-- =============================================================================
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) > 0),
  role            public.user_role not null default 'ATENDENTE',
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Cria o profile automaticamente no signup. A role NUNCA é lida do metadata
-- enviado pelo cliente; o primeiro usuário do sistema vira ADMIN (bootstrap).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    case when v_is_first then 'ADMIN'::public.user_role else 'ATENDENTE'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- REGRAS FISCAIS (referenciada por items.tax_rule_id)
-- =============================================================================
create table public.tax_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  regime       text not null default 'SIMPLES_NACIONAL'
               check (regime in ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
  csosn_cst    text not null check (csosn_cst ~ '^[0-9]{2,3}$'),
  icms_rate    numeric(5,2) not null default 0 check (icms_rate between 0 and 100),
  pis_rate     numeric(5,2) not null default 0 check (pis_rate between 0 and 100),
  cofins_rate  numeric(5,2) not null default 0 check (cofins_rate between 0 and 100),
  has_icms_st  boolean not null default false,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger tax_rules_set_updated_at
  before update on public.tax_rules
  for each row execute function public.tg_set_updated_at();

-- =============================================================================
-- 2. ITEMS (Insumos, Produtos Acabados, Subprodutos, Revenda)
-- =============================================================================
create table public.items (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique check (length(trim(sku)) > 0),
  barcode         text check (barcode ~ '^[0-9]{8,14}$'),
  -- Código PLU de 4–5 dígitos usado nas etiquetas de balança (EAN-13 prefixo 2).
  scale_plu       text check (scale_plu ~ '^[0-9]{4,5}$'),
  name            text not null check (length(trim(name)) > 0),
  type            public.item_type not null,
  base_unit       public.unit_of_measure not null,
  current_stock   numeric(12,4) not null default 0,
  min_stock       numeric(12,4) not null default 0 check (min_stock >= 0),
  avg_cost        numeric(12,4) not null default 0 check (avg_cost >= 0),
  -- Para itens is_weighed = true, sale_price é o preço por KG (padrão balança).
  -- Para os demais, é o preço por unidade base (UN).
  sale_price      numeric(10,2) check (sale_price >= 0),
  is_weighed      boolean not null default false,
  shelf_life_days integer check (shelf_life_days > 0),
  ncm             text check (ncm ~ '^[0-9]{8}$'),
  cest            text check (cest ~ '^[0-9]{7}$'),
  cfop_interno    text check (cfop_interno ~ '^[0-9]{4}$'),
  tax_rule_id     uuid references public.tax_rules (id) on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint items_base_unit_storage check (base_unit in ('G', 'ML', 'UN')),
  constraint items_weighed_unit      check (not is_weighed or base_unit = 'G'),
  constraint items_sellable_price    check (type = 'INSUMO' or sale_price is not null)
);

create unique index items_barcode_uidx   on public.items (barcode)   where barcode is not null;
create unique index items_scale_plu_uidx on public.items (scale_plu) where scale_plu is not null;
create index items_type_idx              on public.items (type) where active;
create index items_name_trgm_idx         on public.items using gin (name gin_trgm_ops);
create index items_low_stock_idx         on public.items (id) where active and current_stock <= min_stock;

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.tg_set_updated_at();

-- Garante a Regra de Ouro #2: estoque e custo médio só mudam via RPC.
create or replace function public.tg_items_guard_stock()
returns trigger
language plpgsql
as $$
begin
  if public.in_rpc_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.current_stock <> 0 then
      raise exception 'Estoque inicial deve ser lançado via adjust_inventory() para gerar Kardex.'
        using errcode = '42501';
    end if;
  elsif new.current_stock is distinct from old.current_stock
     or new.avg_cost is distinct from old.avg_cost then
    raise exception 'current_stock/avg_cost do item "%" só podem ser alterados por funções transacionais.', old.name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger items_guard_stock
  before insert or update on public.items
  for each row execute function public.tg_items_guard_stock();

-- =============================================================================
-- 3. INVENTORY BATCHES (FEFO)
-- =============================================================================
create table public.inventory_batches (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.items (id) on delete restrict,
  batch_code       text not null check (length(trim(batch_code)) > 0),
  expiration_date  date,
  quantity         numeric(12,4) not null default 0 check (quantity >= 0),
  initial_quantity numeric(12,4) not null check (initial_quantity > 0),
  unit_cost        numeric(12,4) not null default 0 check (unit_cost >= 0),
  reference_id     uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint inventory_batches_item_code_key unique (item_id, batch_code)
);

-- Índice que serve exatamente a ordenação FEFO das funções de baixa.
create index inventory_batches_fefo_idx
  on public.inventory_batches (item_id, expiration_date asc nulls last, created_at asc)
  where quantity > 0;

create index inventory_batches_expiring_idx
  on public.inventory_batches (expiration_date)
  where quantity > 0 and expiration_date is not null;

create trigger inventory_batches_set_updated_at
  before update on public.inventory_batches
  for each row execute function public.tg_set_updated_at();

-- =============================================================================
-- 4. TECHNICAL SHEETS (Ficha Técnica)
-- =============================================================================
create table public.technical_sheets (
  id                           uuid primary key default gen_random_uuid(),
  product_id                   uuid not null references public.items (id) on delete restrict,
  name                         text not null check (length(trim(name)) > 0),
  base_flour_weight_g          numeric(12,4) not null check (base_flour_weight_g > 0),
  expected_yield_units         numeric(12,2) not null check (expected_yield_units > 0),
  expected_unit_weight_raw_g   numeric(10,2) check (expected_unit_weight_raw_g > 0),
  expected_unit_weight_baked_g numeric(10,2) check (expected_unit_weight_baked_g > 0),
  operational_overhead_pct     numeric(5,2) not null default 0 check (operational_overhead_pct >= 0),
  notes                        text,
  active                       boolean not null default true,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint technical_sheets_bake_loss check (
    expected_unit_weight_raw_g is null
    or expected_unit_weight_baked_g is null
    or expected_unit_weight_baked_g <= expected_unit_weight_raw_g
  )
);

create index technical_sheets_product_idx on public.technical_sheets (product_id) where active;

create trigger technical_sheets_set_updated_at
  before update on public.technical_sheets
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_technical_sheets_validate_product()
returns trigger
language plpgsql
as $$
declare
  v_type public.item_type;
begin
  select type into v_type from public.items where id = new.product_id;
  if v_type not in ('PRODUTO_ACABADO', 'SUBPRODUTO') then
    raise exception 'Ficha técnica só pode ser vinculada a PRODUTO_ACABADO ou SUBPRODUTO (recebido: %).', v_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger technical_sheets_validate_product
  before insert or update of product_id on public.technical_sheets
  for each row execute function public.tg_technical_sheets_validate_product();

-- =============================================================================
-- 5. TECHNICAL SHEET ITEMS (Ingredientes)
-- =============================================================================
create table public.technical_sheet_items (
  id                uuid primary key default gen_random_uuid(),
  sheet_id          uuid not null references public.technical_sheets (id) on delete cascade,
  ingredient_id     uuid not null references public.items (id) on delete restrict,
  quantity_g_ml     numeric(12,4) not null check (quantity_g_ml > 0),
  -- Calculado por trigger: quantity_g_ml / base_flour_weight_g * 100.
  bakers_percentage numeric(6,2) not null default 0,
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint technical_sheet_items_unique_ingredient unique (sheet_id, ingredient_id)
);

create index technical_sheet_items_ingredient_idx on public.technical_sheet_items (ingredient_id);

create trigger technical_sheet_items_set_updated_at
  before update on public.technical_sheet_items
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_technical_sheet_items_compute()
returns trigger
language plpgsql
as $$
declare
  v_flour      numeric(12,4);
  v_product_id uuid;
begin
  select base_flour_weight_g, product_id
    into v_flour, v_product_id
    from public.technical_sheets
   where id = new.sheet_id;

  if new.ingredient_id = v_product_id then
    raise exception 'Um produto não pode ser ingrediente da própria ficha técnica.'
      using errcode = '23514';
  end if;

  new.bakers_percentage := round(new.quantity_g_ml / v_flour * 100, 2);
  return new;
end;
$$;

create trigger technical_sheet_items_compute
  before insert or update of quantity_g_ml, sheet_id, ingredient_id on public.technical_sheet_items
  for each row execute function public.tg_technical_sheet_items_compute();

-- Ao alterar a farinha base da ficha, recalcula as porcentagens de padeiro.
create or replace function public.tg_technical_sheets_recompute_percentages()
returns trigger
language plpgsql
as $$
begin
  update public.technical_sheet_items
     set bakers_percentage = round(quantity_g_ml / new.base_flour_weight_g * 100, 2)
   where sheet_id = new.id;
  return new;
end;
$$;

create trigger technical_sheets_recompute_percentages
  after update of base_flour_weight_g on public.technical_sheets
  for each row
  when (old.base_flour_weight_g is distinct from new.base_flour_weight_g)
  execute function public.tg_technical_sheets_recompute_percentages();

-- =============================================================================
-- 9. CRM CUSTOMERS (B2C + B2B)  — criada antes de pedidos/OPs por dependência
-- =============================================================================
create table public.crm_customers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  document             text check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  whatsapp_phone       text check (whatsapp_phone ~ '^[0-9]{12,13}$'),
  email                text,
  customer_type        public.customer_type not null default 'B2C',
  credit_limit         numeric(10,2) not null default 0 check (credit_limit >= 0),
  current_balance_due  numeric(10,2) not null default 0,
  billing_cycle_day    smallint check (billing_cycle_day between 1 and 28),
  recurring_order_json jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(recurring_order_json) = 'array'),
  notes                text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint crm_customers_b2b_requires_cnpj check (
    customer_type = 'B2C' or (document is not null and length(document) = 14)
  ),
  constraint crm_customers_b2b_billing check (
    customer_type = 'B2C' or billing_cycle_day is not null
  )
);

comment on column public.crm_customers.whatsapp_phone is
  'Formato E.164 sem "+": 55 + DDD + número (ex: 5511987654321). Chave de lookup do Agente de IA.';
comment on column public.crm_customers.recurring_order_json is
  'Array de {item_id: uuid, quantity: number, weekdays: int[0-6], delivery_time: "HH:MM"}.';

create unique index crm_customers_whatsapp_uidx on public.crm_customers (whatsapp_phone) where whatsapp_phone is not null;
create unique index crm_customers_document_uidx on public.crm_customers (document) where document is not null;
create index crm_customers_type_idx on public.crm_customers (customer_type) where active;
create index crm_customers_name_trgm_idx on public.crm_customers using gin (name gin_trgm_ops);

create trigger crm_customers_set_updated_at
  before update on public.crm_customers
  for each row execute function public.tg_set_updated_at();

-- Saldo devedor é contábil: só muda via RPC (vendas faturadas / baixas de títulos).
create or replace function public.tg_crm_customers_guard_balance()
returns trigger
language plpgsql
as $$
begin
  if public.in_rpc_context() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.current_balance_due <> 0 then
    raise exception 'Saldo devedor inicial deve ser zero.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.current_balance_due is distinct from old.current_balance_due then
    raise exception 'Saldo devedor só pode ser alterado por funções transacionais.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger crm_customers_guard_balance
  before insert or update on public.crm_customers
  for each row execute function public.tg_crm_customers_guard_balance();

-- "b2b_accounts": visão da carteira atacado com crédito disponível.
create view public.b2b_accounts
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.document,
  c.whatsapp_phone,
  c.email,
  c.credit_limit,
  c.current_balance_due,
  (c.credit_limit - c.current_balance_due)::numeric(10,2) as available_credit,
  c.billing_cycle_day,
  c.recurring_order_json,
  c.active,
  c.created_at
from public.crm_customers c
where c.customer_type = 'B2B';

-- =============================================================================
-- 10. ORDERS & POS SALES
-- =============================================================================
create table public.orders_and_pos_sales (
  id                      uuid primary key default gen_random_uuid(),
  order_number            bigint generated always as identity unique,
  origin                  public.order_origin not null,
  customer_id             uuid references public.crm_customers (id) on delete restrict,
  -- Nullable: pedidos criados pelo Agente de IA não têm operador humano.
  cashier_or_attendant_id uuid references public.profiles (id) on delete set null,
  status                  public.order_status not null,
  subtotal                numeric(10,2) not null default 0 check (subtotal >= 0),
  discount                numeric(10,2) not null default 0 check (discount >= 0),
  total                   numeric(10,2) not null default 0 check (total >= 0),
  payment_method          public.payment_method,
  fiscal_status           public.fiscal_status not null default 'PENDENTE',
  fiscal_key              text check (fiscal_key ~ '^[0-9]{44}$'),
  delivery_date           timestamptz,
  -- UUID gerado no PDV offline: garante idempotência na sincronização.
  offline_client_id       uuid unique,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint orders_total_consistency check (total = subtotal - discount),
  constraint orders_discount_le_subtotal check (discount <= subtotal),
  constraint orders_b2b_billing_requires_customer check (
    payment_method is distinct from 'FATURADO_B2B' or customer_id is not null
  ),
  constraint orders_completed_requires_payment check (
    status <> 'CONCLUIDA' or payment_method is not null
  )
);

create index orders_created_at_idx      on public.orders_and_pos_sales (created_at desc);
create index orders_customer_idx        on public.orders_and_pos_sales (customer_id, created_at desc) where customer_id is not null;
create index orders_pending_delivery_idx on public.orders_and_pos_sales (delivery_date)
  where status in ('PENDENTE_PRODUCAO', 'PRONTO_RETIRADA');
create index orders_fiscal_pending_idx  on public.orders_and_pos_sales (fiscal_status)
  where fiscal_status in ('PENDENTE', 'CONTINGENCIA_OFFLINE', 'ERRO');

create trigger orders_set_updated_at
  before update on public.orders_and_pos_sales
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders_and_pos_sales (id) on delete cascade,
  item_id            uuid not null references public.items (id) on delete restrict,
  -- Quantidade na unidade base do item (gramas para itens de balança).
  quantity           numeric(12,4) not null check (quantity > 0),
  -- Preço praticado (por KG se o item for pesado; por UN caso contrário).
  unit_price         numeric(10,2) not null check (unit_price >= 0),
  total_price        numeric(10,2) not null check (total_price >= 0),
  -- Preenchido na baixa de estoque (CMV real da venda).
  unit_cost_at_sale  numeric(12,4),
  created_at         timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_item_idx  on public.order_items (item_id, created_at desc);

-- =============================================================================
-- 6. PRODUCTION ORDERS (PCP)
-- =============================================================================
create table public.production_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           serial unique,
  sheet_id               uuid not null references public.technical_sheets (id) on delete restrict,
  baker_id               uuid references public.profiles (id) on delete set null,
  sales_order_id         uuid references public.orders_and_pos_sales (id) on delete set null,
  status                 public.production_status not null default 'PLANEJADA',
  scaling_factor         numeric(8,4) not null default 1 check (scaling_factor > 0),
  planned_quantity       numeric(12,2) not null check (planned_quantity > 0),
  actual_yield_quantity  numeric(12,2) check (actual_yield_quantity >= 0),
  damaged_quantity       numeric(12,2) not null default 0 check (damaged_quantity >= 0),
  total_production_cost  numeric(10,2) check (total_production_cost >= 0),
  scheduled_for          timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  notes                  text,
  created_by             uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint production_orders_finalized_fields check (
    status <> 'FINALIZADA'
    or (actual_yield_quantity is not null and total_production_cost is not null and completed_at is not null)
  )
);

create index production_orders_board_idx on public.production_orders (scheduled_for, status)
  where status in ('PLANEJADA', 'EM_PRODUCAO', 'ASSANDO');
create index production_orders_sheet_idx on public.production_orders (sheet_id, completed_at desc);
create index production_orders_baker_idx on public.production_orders (baker_id, scheduled_for desc);

create trigger production_orders_set_updated_at
  before update on public.production_orders
  for each row execute function public.tg_set_updated_at();

-- Máquina de estados da OP. FINALIZADA só é alcançável via complete_production_order().
create or replace function public.tg_production_orders_state_machine()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PLANEJADA' then
      raise exception 'Uma OP deve ser criada com status PLANEJADA.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status in ('FINALIZADA', 'CANCELADA') then
    raise exception 'OP #% está % e não pode ser alterada.', old.order_number, old.status
      using errcode = '42501';
  end if;

  if new.status = old.status then
    -- Campos de fechamento só podem ser gravados pela RPC.
    if not public.in_rpc_context() and (
         new.actual_yield_quantity is distinct from old.actual_yield_quantity
      or new.total_production_cost is distinct from old.total_production_cost
      or new.completed_at is distinct from old.completed_at) then
      raise exception 'Campos de fechamento da OP só podem ser gravados por complete_production_order().'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status = 'FINALIZADA' then
    if not public.in_rpc_context() then
      raise exception 'Use complete_production_order() para finalizar a OP.' using errcode = '42501';
    end if;
    return new;
  end if;

  if not (
       (old.status = 'PLANEJADA'   and new.status in ('EM_PRODUCAO', 'CANCELADA'))
    or (old.status = 'EM_PRODUCAO' and new.status in ('ASSANDO', 'CANCELADA'))
    or (old.status = 'ASSANDO'     and new.status = 'CANCELADA')
  ) then
    raise exception 'Transição inválida de OP: % → %.', old.status, new.status using errcode = '23514';
  end if;

  if new.status = 'EM_PRODUCAO' and new.started_at is null then
    new.started_at := now();
    new.baker_id := coalesce(new.baker_id, auth.uid());
  end if;

  return new;
end;
$$;

create trigger production_orders_state_machine
  before insert or update on public.production_orders
  for each row execute function public.tg_production_orders_state_machine();

-- =============================================================================
-- 7. WASTE & TRANSFORMATIONS
-- =============================================================================
create table public.waste_and_transformations (
  id                        uuid primary key default gen_random_uuid(),
  source_item_id            uuid not null references public.items (id) on delete restrict,
  source_quantity           numeric(12,4) not null check (source_quantity > 0),
  type                      public.waste_type not null,
  target_item_id            uuid references public.items (id) on delete restrict,
  target_quantity_generated numeric(12,4),
  -- TRANSFORMACAO: custo contábil transferido ao item destino.
  -- DESCARTE_PERDA: custo baixado como perda (vai para o DRE).
  transferred_cost          numeric(10,2) not null default 0 check (transferred_cost >= 0),
  reason                    text,
  user_id                   uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),

  constraint waste_type_consistency check (
    (type = 'DESCARTE_PERDA' and target_item_id is null and target_quantity_generated is null
       and reason is not null and length(trim(reason)) > 0)
    or
    (type = 'TRANSFORMACAO' and target_item_id is not null and target_item_id <> source_item_id
       and target_quantity_generated > 0)
  )
);

create index waste_created_at_idx on public.waste_and_transformations (created_at desc);
create index waste_source_idx     on public.waste_and_transformations (source_item_id, created_at desc);

-- =============================================================================
-- 8. STOCK MOVEMENTS (Kardex imutável)
-- =============================================================================
create table public.stock_movements (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.items (id) on delete restrict,
  batch_id            uuid references public.inventory_batches (id) on delete restrict,
  movement_type       public.stock_movement_type not null,
  -- Quantidade ASSINADA na unidade base: entradas > 0, saídas < 0.
  quantity            numeric(12,4) not null,
  unit_cost_at_moment numeric(12,4) not null check (unit_cost_at_moment >= 0),
  reference_id        uuid,
  notes               text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint stock_movements_signed_quantity check (
    (movement_type in ('ENTRADA_NF', 'ENTRADA_OP', 'TRANSFORMACAO_ENTRADA') and quantity > 0)
    or (movement_type in ('SAIDA_OP', 'SAIDA_VENDA', 'PERDA', 'TRANSFORMACAO_SAIDA') and quantity < 0)
    or (movement_type = 'AJUSTE_INVENTARIO' and quantity <> 0)
  )
);

create index stock_movements_item_idx      on public.stock_movements (item_id, created_at desc);
create index stock_movements_reference_idx on public.stock_movements (reference_id) where reference_id is not null;
create index stock_movements_type_date_idx on public.stock_movements (movement_type, created_at desc);

create or replace function public.tg_stock_movements_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements é um razão imutável. Lance um movimento de AJUSTE_INVENTARIO para corrigir.'
    using errcode = '42501';
end;
$$;

create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.tg_stock_movements_immutable();

create trigger stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement execute function public.tg_stock_movements_immutable();

-- =============================================================================
-- CRM INBOX (Conversas do Agente de IA + Transbordo Humano)
-- =============================================================================
create table public.crm_conversations (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid references public.crm_customers (id) on delete set null,
  whatsapp_phone       text not null check (whatsapp_phone ~ '^[0-9]{12,13}$'),
  contact_name         text,
  status               public.conversation_status not null default 'IA_ATIVA',
  assigned_to          uuid references public.profiles (id) on delete set null,
  ai_paused_at         timestamptz,
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  unread_count         integer not null default 0 check (unread_count >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint crm_conversations_human_assignment check (
    status <> 'HUMANO' or (assigned_to is not null and ai_paused_at is not null)
  )
);

-- Uma única conversa aberta por telefone.
create unique index crm_conversations_open_phone_uidx
  on public.crm_conversations (whatsapp_phone) where status <> 'ENCERRADA';
create index crm_conversations_inbox_idx
  on public.crm_conversations (last_message_at desc) where status <> 'ENCERRADA';

create trigger crm_conversations_set_updated_at
  before update on public.crm_conversations
  for each row execute function public.tg_set_updated_at();

create table public.crm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_conversations (id) on delete cascade,
  sender          public.message_sender not null,
  sender_user_id  uuid references public.profiles (id) on delete set null,
  content         text not null,
  media_url       text,
  -- ID da mensagem na Evolution API (idempotência de webhooks).
  external_id     text unique,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index crm_messages_conversation_idx on public.crm_messages (conversation_id, created_at);

create or replace function public.tg_crm_messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.content, 140),
         unread_count         = case when new.sender = 'CLIENTE' then unread_count + 1 else unread_count end
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger crm_messages_touch_conversation
  after insert on public.crm_messages
  for each row execute function public.tg_crm_messages_touch_conversation();

-- =============================================================================
-- ALERTAS EM TEMPO REAL PARA A TELA DO PADEIRO (PCP / KDS)
-- =============================================================================
create table public.production_alerts (
  id               uuid primary key default gen_random_uuid(),
  alert_type       public.production_alert_type not null,
  title            text not null,
  message          text not null,
  sales_order_id   uuid references public.orders_and_pos_sales (id) on delete cascade,
  payload          jsonb not null default '{}'::jsonb,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index production_alerts_open_idx on public.production_alerts (created_at desc) where acknowledged_at is null;

-- =============================================================================
-- NF-e: IMPORTAÇÃO DE XML + MEMÓRIA DE DE/PARA DE UNIDADES
-- =============================================================================
create table public.nfe_imports (
  id             uuid primary key default gen_random_uuid(),
  access_key     text not null unique check (access_key ~ '^[0-9]{44}$'),
  supplier_cnpj  text not null check (supplier_cnpj ~ '^[0-9]{14}$'),
  supplier_name  text not null,
  invoice_number text not null,
  series         text not null,
  issued_at      timestamptz not null,
  total_amount   numeric(10,2) not null check (total_amount >= 0),
  status         public.nfe_import_status not null default 'RASCUNHO',
  raw_xml        text not null,
  imported_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index nfe_imports_supplier_idx on public.nfe_imports (supplier_cnpj, issued_at desc);

create trigger nfe_imports_set_updated_at
  before update on public.nfe_imports
  for each row execute function public.tg_set_updated_at();

create table public.nfe_import_items (
  id                    uuid primary key default gen_random_uuid(),
  import_id             uuid not null references public.nfe_imports (id) on delete cascade,
  line_number           smallint not null check (line_number > 0),
  supplier_product_code text not null,              -- <cProd>
  description           text not null,              -- <xProd>
  ncm                   text,                       -- <NCM>
  commercial_unit       text not null,              -- <uCom>
  commercial_quantity   numeric(12,4) not null check (commercial_quantity > 0), -- <qCom>
  commercial_unit_value numeric(12,4) not null check (commercial_unit_value >= 0), -- <vUnCom>
  total_value           numeric(10,2) not null check (total_value >= 0),         -- <vProd>
  linked_item_id        uuid references public.items (id) on delete restrict,
  -- Quantas unidades base (g/ml/un) existem em 1 uCom. Ex.: saco 50KG → 50000.
  conversion_factor     numeric(12,4) check (conversion_factor > 0),
  base_quantity         numeric(12,4) generated always as (commercial_quantity * conversion_factor) stored,
  batch_code            text,
  expiration_date       date,

  constraint nfe_import_items_line_key unique (import_id, line_number)
);

create table public.unit_conversions (
  id                    uuid primary key default gen_random_uuid(),
  supplier_cnpj         text not null check (supplier_cnpj ~ '^[0-9]{14}$'),
  supplier_product_code text not null,
  commercial_unit       text not null,
  item_id               uuid not null references public.items (id) on delete cascade,
  factor_to_base        numeric(12,4) not null check (factor_to_base > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint unit_conversions_key unique (supplier_cnpj, supplier_product_code, commercial_unit)
);

create trigger unit_conversions_set_updated_at
  before update on public.unit_conversions
  for each row execute function public.tg_set_updated_at();

-- =============================================================================
-- VIEW: CUSTO DA FICHA TÉCNICA (CMV teórico, margem)
-- =============================================================================
create view public.v_technical_sheet_costs
with (security_invoker = true)
as
with ingredient_costs as (
  select
    tsi.sheet_id,
    coalesce(sum(tsi.quantity_g_ml * i.avg_cost), 0) as ingredients_cost,
    count(*) as ingredient_count
  from public.technical_sheet_items tsi
  join public.items i on i.id = tsi.ingredient_id
  group by tsi.sheet_id
),
base as (
  select
    s.id as sheet_id,
    s.name as sheet_name,
    s.product_id,
    p.name as product_name,
    p.is_weighed,
    p.sale_price,
    s.base_flour_weight_g,
    s.expected_yield_units,
    s.expected_unit_weight_raw_g,
    s.expected_unit_weight_baked_g,
    s.operational_overhead_pct,
    coalesce(ic.ingredient_count, 0) as ingredient_count,
    round(coalesce(ic.ingredients_cost, 0), 4) as ingredients_cost,
    round(coalesce(ic.ingredients_cost, 0) * (1 + s.operational_overhead_pct / 100), 4) as total_batch_cost,
    -- Preço efetivo por unidade produzida (itens de balança: R$/kg × peso assado).
    case
      when p.is_weighed and s.expected_unit_weight_baked_g is not null
        then round(p.sale_price * s.expected_unit_weight_baked_g / 1000, 4)
      else p.sale_price
    end as unit_sale_price
  from public.technical_sheets s
  join public.items p on p.id = s.product_id
  left join ingredient_costs ic on ic.sheet_id = s.id
  where s.active
)
select
  b.*,
  round(b.total_batch_cost / b.expected_yield_units, 4) as unit_cmv,
  case
    when b.unit_sale_price > 0
      then round((b.unit_sale_price - b.total_batch_cost / b.expected_yield_units) / b.unit_sale_price * 100, 2)
  end as contribution_margin_pct
from base b;
