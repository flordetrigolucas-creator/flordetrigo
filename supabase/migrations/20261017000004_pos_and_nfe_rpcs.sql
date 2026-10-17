-- =============================================================================
-- Flor do Trigo ERP — Migration 004: RPCs de Venda PDV/IA, NF-e XML e Seed Completo
-- -----------------------------------------------------------------------------
-- Completa o ciclo 100% no Supabase:
--   * record_pos_or_ai_sale(): Grava venda PDV/IA, dá baixa FEFO no estoque,
--     atualiza saldo B2B (se FATURADO_B2B) e gera alerta na Tela do Padeiro.
--   * confirm_nfe_xml_entry(): Grava NF-e XML, salva De/Para de unidades,
--     dá entrada nos lotes FEFO na unidade base e recalcula o Custo Médio.
-- =============================================================================

-- =============================================================================
-- RPC: record_pos_or_ai_sale
-- Idempotente por p_offline_client_id.
-- =============================================================================
create or replace function public.record_pos_or_ai_sale(
  p_origin            public.order_origin,
  p_payment_method    public.payment_method,
  p_items             jsonb,
  p_discount          numeric default 0,
  p_customer_id       uuid default null,
  p_delivery_date     timestamptz default null,
  p_offline_client_id uuid default null,
  p_notes             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user          uuid := auth.uid();
  v_order         public.orders_and_pos_sales%rowtype;
  v_customer      public.crm_customers%rowtype;
  v_line          jsonb;
  v_item          public.items%rowtype;
  v_qty           numeric(12,4);
  v_unit_price    numeric(10,2);
  v_line_total    numeric(10,2);
  v_subtotal      numeric(10,2) := 0;
  v_discount      numeric(10,2) := greatest(coalesce(round(p_discount, 2), 0), 0);
  v_total         numeric(10,2);
  v_line_cost     numeric(18,4);
  v_status        public.order_status;
  v_summary_parts text[] := array[]::text[];
begin
  perform set_config('app.rpc_context', 'on', true);

  -- Idempotência: se já foi sincronizada pelo PDV offline, retorna a existente.
  if p_offline_client_id is not null then
    select * into v_order
      from public.orders_and_pos_sales
     where offline_client_id = p_offline_client_id;
    if found then
      return jsonb_build_object(
        'order_id',     v_order.id,
        'order_number', v_order.order_number,
        'total',        v_order.total,
        'idempotent',   true
      );
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda deve conter ao menos 1 item.' using errcode = '22023';
  end if;

  -- Calcula subtotal e valida itens
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    select * into v_item from public.items where id = (v_line ->> 'item_id')::uuid;
    if not found then
      raise exception 'Item % não encontrado.', v_line ->> 'item_id' using errcode = 'P0002';
    end if;

    v_qty        := round((v_line ->> 'quantity')::numeric, 4);
    v_unit_price := round(coalesce((v_line ->> 'unit_price')::numeric, v_item.sale_price, 0), 2);
    v_line_total := case
      when v_item.is_weighed then round((v_qty / 1000.0) * v_unit_price, 2)
      else round(v_qty * v_unit_price, 2)
    end;

    v_subtotal := v_subtotal + v_line_total;
    v_summary_parts := array_append(
      v_summary_parts,
      format('%s %s %s', v_qty, lower(v_item.base_unit::text), v_item.name)
    );
  end loop;

  v_discount := least(v_discount, v_subtotal);
  v_total    := v_subtotal - v_discount;

  -- Se for FATURADO_B2B, valida limite de crédito e incrementa saldo devedor
  if p_payment_method = 'FATURADO_B2B' then
    if p_customer_id is null then
      raise exception 'Faturamento B2B requer cliente corporativo selecionado.' using errcode = '22023';
    end if;

    select * into v_customer from public.crm_customers where id = p_customer_id for update;
    if not found then
      raise exception 'Cliente B2B % não encontrado.', p_customer_id using errcode = 'P0002';
    end if;

    if (v_customer.credit_limit - v_customer.current_balance_due) < v_total then
      raise exception 'Limite de crédito B2B insuficiente para "%": disponível R$ %, pedido R$ %.',
        v_customer.name,
        round(v_customer.credit_limit - v_customer.current_balance_due, 2),
        v_total
        using errcode = 'P0001';
    end if;

    update public.crm_customers
       set current_balance_due = current_balance_due + v_total
     where id = v_customer.id;
  end if;

  v_status := case
    when p_origin in ('WHATSAPP_IA', 'B2B_RECORRENTE') then 'PENDENTE_PRODUCAO'::public.order_status
    else 'CONCLUIDA'::public.order_status
  end;

  insert into public.orders_and_pos_sales (
    origin, customer_id, cashier_or_attendant_id, status,
    subtotal, discount, total, payment_method, fiscal_status,
    delivery_date, offline_client_id, notes
  ) values (
    p_origin, p_customer_id, v_user, v_status,
    v_subtotal, v_discount, v_total, p_payment_method,
    case when p_origin = 'PDV_BALCAO' then 'EMITIDA'::public.fiscal_status else 'PENDENTE'::public.fiscal_status end,
    p_delivery_date, p_offline_client_id, p_notes
  ) returning * into v_order;

  -- Insere itens e faz baixa FEFO no estoque para vendas imediatas de balcão
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    select * into v_item from public.items where id = (v_line ->> 'item_id')::uuid;
    v_qty        := round((v_line ->> 'quantity')::numeric, 4);
    v_unit_price := round(coalesce((v_line ->> 'unit_price')::numeric, v_item.sale_price, 0), 2);
    v_line_total := case
      when v_item.is_weighed then round((v_qty / 1000.0) * v_unit_price, 2)
      else round(v_qty * v_unit_price, 2)
    end;

    if v_status = 'CONCLUIDA' then
      v_line_cost := public._consume_stock_fefo(
        v_item.id,
        v_qty,
        'SAIDA_VENDA',
        v_order.id,
        v_user,
        true, -- PDV de balcão nunca trava fila do cliente por divergência de estoque
        format('Venda PDV #%s', v_order.order_number)
      );
    else
      v_line_cost := v_qty * v_item.avg_cost;
    end if;

    insert into public.order_items (
      order_id, item_id, quantity, unit_price, total_price, unit_cost_at_sale
    ) values (
      v_order.id, v_item.id, v_qty, v_unit_price, v_line_total, round(v_line_cost / v_qty, 4)
    );
  end loop;

  -- Se veio do Agente de IA ou B2B recorrente, injeta alerta na Tela do Padeiro
  if p_origin in ('WHATSAPP_IA', 'B2B_RECORRENTE') then
    insert into public.production_alerts (
      alert_type, title, message, sales_order_id, payload
    ) values (
      'NOVA_ENCOMENDA',
      format('Nova Encomenda #%s (%s)', v_order.order_number, p_origin),
      array_to_string(v_summary_parts, ', '),
      v_order.id,
      jsonb_build_object('order_id', v_order.id, 'total', v_total, 'delivery_date', p_delivery_date)
    );
  end if;

  return jsonb_build_object(
    'order_id',     v_order.id,
    'order_number', v_order.order_number,
    'total',        v_order.total,
    'status',       v_order.status,
    'idempotent',   false
  );
end;
$$;

-- =============================================================================
-- RPC: confirm_nfe_xml_entry
-- Recebe o cabeçalho + linhas mapeadas da NF-e, grava nfe_imports,
-- salva unit_conversions (De/Para) e dá entrada nos lotes (ENTRADA_NF)
-- recalculando o Custo Médio Ponderado na unidade base.
-- =============================================================================
create or replace function public.confirm_nfe_xml_entry(
  p_access_key     text,
  p_supplier_cnpj  text,
  p_supplier_name  text,
  p_invoice_number text,
  p_series         text,
  p_issued_at      timestamptz,
  p_total_amount   numeric,
  p_raw_xml        text,
  p_lines          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := public._assert_role(array['ADMIN', 'GERENTE']::public.user_role[]);
  v_import_id  uuid;
  v_line       jsonb;
  v_item_id    uuid;
  v_factor     numeric(12,4);
  v_comm_qty   numeric(12,4);
  v_base_qty   numeric(12,4);
  v_total_val  numeric(10,2);
  v_batch_code text;
  v_exp_date   date;
  v_count      integer := 0;
begin
  perform set_config('app.rpc_context', 'on', true);

  insert into public.nfe_imports (
    access_key, supplier_cnpj, supplier_name, invoice_number, series,
    issued_at, total_amount, status, raw_xml, imported_by, confirmed_at
  ) values (
    p_access_key, p_supplier_cnpj, p_supplier_name, p_invoice_number, p_series,
    p_issued_at, round(p_total_amount, 2), 'CONFIRMADA', p_raw_xml, v_user, now()
  )
  on conflict (access_key) do update
    set status       = 'CONFIRMADA',
        confirmed_at = now()
  returning id into v_import_id;

  delete from public.nfe_import_items where import_id = v_import_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id   := (v_line ->> 'linked_item_id')::uuid;
    v_factor    := round((v_line ->> 'conversion_factor')::numeric, 4);
    v_comm_qty  := round((v_line ->> 'commercial_quantity')::numeric, 4);
    v_base_qty  := round(v_comm_qty * v_factor, 4);
    v_total_val := round((v_line ->> 'total_value')::numeric, 2);
    v_exp_date  := nullif(v_line ->> 'expiration_date', '')::date;
    v_batch_code := coalesce(
      nullif(v_line ->> 'batch_code', ''),
      format('NFE-%s-L%s', p_invoice_number, v_line ->> 'line_number')
    );

    insert into public.nfe_import_items (
      import_id, line_number, supplier_product_code, description, ncm,
      commercial_unit, commercial_quantity, commercial_unit_value, total_value,
      linked_item_id, conversion_factor, batch_code, expiration_date
    ) values (
      v_import_id,
      (v_line ->> 'line_number')::smallint,
      v_line ->> 'supplier_product_code',
      v_line ->> 'description',
      nullif(v_line ->> 'ncm', ''),
      v_line ->> 'commercial_unit',
      v_comm_qty,
      round((v_line ->> 'commercial_unit_value')::numeric, 4),
      v_total_val,
      v_item_id,
      v_factor,
      v_batch_code,
      v_exp_date
    );

    -- Salva memória de conversão De/Para para próximas notas do mesmo fornecedor
    insert into public.unit_conversions (
      supplier_cnpj, supplier_product_code, commercial_unit, item_id, factor_to_base
    ) values (
      p_supplier_cnpj, v_line ->> 'supplier_product_code', v_line ->> 'commercial_unit', v_item_id, v_factor
    )
    on conflict (supplier_cnpj, supplier_product_code, commercial_unit) do update
      set item_id        = excluded.item_id,
          factor_to_base = excluded.factor_to_base;

    -- Entrada atômica no estoque + recálculo do Custo Médio Ponderado
    perform public._receive_stock(
      v_item_id,
      v_base_qty,
      v_total_val,
      'ENTRADA_NF',
      v_import_id,
      v_user,
      v_batch_code,
      v_exp_date,
      format('NF-e #%s — %s', p_invoice_number, v_line ->> 'description')
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'import_id',      v_import_id,
    'invoice_number', p_invoice_number,
    'lines_imported', v_count
  );
end;
$$;

grant execute on function public.record_pos_or_ai_sale(
  public.order_origin, public.payment_method, jsonb, numeric, uuid, timestamptz, uuid, text
) to authenticated;

grant execute on function public.confirm_nfe_xml_entry(
  text, text, text, text, text, timestamptz, numeric, text, jsonb
) to authenticated;

