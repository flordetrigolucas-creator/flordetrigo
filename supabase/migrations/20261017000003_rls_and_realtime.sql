-- =============================================================================
-- Flor do Trigo ERP — Migration 003: Row Level Security + Realtime
-- -----------------------------------------------------------------------------
-- Princípios:
--   * Toda tabela tem RLS habilitado; sem policy = sem acesso.
--   * Tabelas contábeis (stock_movements, inventory_batches, waste) NÃO têm
--     policies de escrita: só as RPCs SECURITY DEFINER escrevem nelas.
--   * O Agente de IA (n8n/Edge Functions) usa a service_role, que ignora RLS,
--     e deve sempre passar pelas RPCs/endpoints documentados.
-- =============================================================================

alter table public.profiles                  enable row level security;
alter table public.tax_rules                 enable row level security;
alter table public.items                     enable row level security;
alter table public.inventory_batches         enable row level security;
alter table public.technical_sheets          enable row level security;
alter table public.technical_sheet_items     enable row level security;
alter table public.production_orders         enable row level security;
alter table public.waste_and_transformations enable row level security;
alter table public.stock_movements           enable row level security;
alter table public.crm_customers             enable row level security;
alter table public.orders_and_pos_sales      enable row level security;
alter table public.order_items               enable row level security;
alter table public.crm_conversations         enable row level security;
alter table public.crm_messages              enable row level security;
alter table public.production_alerts         enable row level security;
alter table public.nfe_imports               enable row level security;
alter table public.nfe_import_items          enable row level security;
alter table public.unit_conversions          enable row level security;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() is not null);

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.has_role(array['ADMIN']::public.user_role[]))
  with check (public.has_role(array['ADMIN']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- CADASTROS (leitura para toda equipe ativa; escrita gestão)
-- -----------------------------------------------------------------------------
create policy tax_rules_select on public.tax_rules
  for select to authenticated using (public.current_user_role() is not null);
create policy tax_rules_write on public.tax_rules
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));

create policy items_select on public.items
  for select to authenticated using (public.current_user_role() is not null);
create policy items_insert on public.items
  for insert to authenticated
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));
create policy items_update on public.items
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));
create policy items_delete on public.items
  for delete to authenticated
  using (public.has_role(array['ADMIN']::public.user_role[]));

create policy inventory_batches_select on public.inventory_batches
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));

create policy technical_sheets_select on public.technical_sheets
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));
create policy technical_sheets_write on public.technical_sheets
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));

create policy technical_sheet_items_select on public.technical_sheet_items
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));
create policy technical_sheet_items_write on public.technical_sheet_items
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- PCP
-- -----------------------------------------------------------------------------
create policy production_orders_select on public.production_orders
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO', 'ATENDENTE']::public.user_role[]));
create policy production_orders_insert on public.production_orders
  for insert to authenticated
  with check (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));
-- Transições de status são validadas pelo trigger de máquina de estados.
create policy production_orders_update on public.production_orders
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));

create policy production_alerts_select on public.production_alerts
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));
create policy production_alerts_ack on public.production_alerts
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]));

create policy waste_select on public.waste_and_transformations
  for select to authenticated
  using (
    public.has_role(array['ADMIN', 'GERENTE']::public.user_role[])
    or user_id = auth.uid()
  );

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- CRM & VENDAS
-- -----------------------------------------------------------------------------
create policy crm_customers_select on public.crm_customers
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[]));
create policy crm_customers_insert on public.crm_customers
  for insert to authenticated
  with check (
    public.has_role(array['ADMIN', 'GERENTE']::public.user_role[])
    or (public.has_role(array['CAIXA', 'ATENDENTE']::public.user_role[]) and credit_limit = 0)
  );
create policy crm_customers_update on public.crm_customers
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]));

-- Atendentes não alteram limite de crédito nem tipo de conta.
create or replace function public.tg_crm_customers_guard_credit()
returns trigger
language plpgsql
as $$
begin
  if public.in_rpc_context() or auth.uid() is null then
    return new;
  end if;
  if (new.credit_limit is distinct from old.credit_limit
      or new.customer_type is distinct from old.customer_type
      or new.billing_cycle_day is distinct from old.billing_cycle_day)
     and not public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]) then
    raise exception 'Apenas ADMIN/GERENTE podem alterar condições comerciais do cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger crm_customers_guard_credit
  before update on public.crm_customers
  for each row execute function public.tg_crm_customers_guard_credit();

create policy orders_select on public.orders_and_pos_sales
  for select to authenticated
  using (public.current_user_role() is not null);
create policy orders_insert on public.orders_and_pos_sales
  for insert to authenticated
  with check (public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[]));
create policy orders_update on public.orders_and_pos_sales
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[]));

create policy order_items_select on public.order_items
  for select to authenticated
  using (public.current_user_role() is not null);
create policy order_items_write on public.order_items
  for all to authenticated
  using (
    public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[])
    and exists (
      select 1 from public.orders_and_pos_sales o
       where o.id = order_items.order_id
         and o.status in ('PENDENTE_PRODUCAO', 'PRONTO_RETIRADA')
    )
  )
  with check (
    public.has_role(array['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']::public.user_role[])
    and exists (
      select 1 from public.orders_and_pos_sales o
       where o.id = order_items.order_id
         and o.status in ('PENDENTE_PRODUCAO', 'PRONTO_RETIRADA')
    )
  );

create policy crm_conversations_select on public.crm_conversations
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]));
create policy crm_conversations_update on public.crm_conversations
  for update to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]));

create policy crm_messages_select on public.crm_messages
  for select to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[]));
-- Humanos só enviam como HUMANO e em conversas sob transbordo.
create policy crm_messages_insert_human on public.crm_messages
  for insert to authenticated
  with check (
    public.has_role(array['ADMIN', 'GERENTE', 'ATENDENTE']::public.user_role[])
    and sender = 'HUMANO'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from public.crm_conversations c
       where c.id = crm_messages.conversation_id and c.status = 'HUMANO'
    )
  );

-- -----------------------------------------------------------------------------
-- NF-e
-- -----------------------------------------------------------------------------
create policy nfe_imports_rw on public.nfe_imports
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));
create policy nfe_import_items_rw on public.nfe_import_items
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));
create policy unit_conversions_rw on public.unit_conversions
  for all to authenticated
  using (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]))
  with check (public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- REALTIME (Tela do Padeiro + Inbox CRM)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.production_orders,
      public.production_alerts,
      public.crm_conversations,
      public.crm_messages,
      public.orders_and_pos_sales;
  end if;
end;
$$;

