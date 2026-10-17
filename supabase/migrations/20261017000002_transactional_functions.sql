-- =============================================================================
-- Flor do Trigo ERP — Migration 002: Funções Transacionais (PL/pgSQL)
-- -----------------------------------------------------------------------------
-- Toda alteração de estoque/custo passa por aqui. Cada RPC executa em uma única
-- transação: qualquer RAISE EXCEPTION provoca ROLLBACK total (ACID).
--
-- Ordem de locks (prevenção de deadlock):
--   production_orders → items (insumos ordenados por id) → inventory_batches → item produto
-- =============================================================================

-- =============================================================================
-- RBAC HELPERS
-- =============================================================================
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.has_role(p_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = any (p_roles), false);
$$;

create or replace function public._assert_role(p_roles public.user_role[])
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;
  if not public.has_role(p_roles) then
    raise exception 'Perfil sem permissão para esta operação. Requer: %.', array_to_string(p_roles, ', ')
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- =============================================================================
-- PRIMITIVA: BAIXA DE ESTOQUE FEFO
-- Retorna o custo total consumido (quantidade × custo do lote / custo médio).
-- =============================================================================
create or replace function public._consume_stock_fefo(
  p_item_id        uuid,
  p_quantity       numeric,
  p_movement_type  public.stock_movement_type,
  p_reference_id   uuid,
  p_user_id        uuid,
  p_allow_negative boolean default false,
  p_notes          text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item       record;
  v_batch      record;
  v_qty        numeric(12,4) := round(p_quantity, 4);
  v_remaining  numeric(12,4);
  v_take       numeric(12,4);
  v_total_cost numeric(18,6) := 0;
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Quantidade de baixa deve ser positiva (recebido: %).', p_quantity using errcode = '22023';
  end if;

  if p_movement_type not in ('SAIDA_OP', 'SAIDA_VENDA', 'PERDA', 'TRANSFORMACAO_SAIDA', 'AJUSTE_INVENTARIO') then
    raise exception 'Tipo de movimento % não é uma saída.', p_movement_type using errcode = '22023';
  end if;

  perform set_config('app.rpc_context', 'on', true);

  select id, name, base_unit, current_stock, avg_cost
    into v_item
    from public.items
   where id = p_item_id
     for update;

  if not found then
    raise exception 'Item % não encontrado.', p_item_id using errcode = 'P0002';
  end if;

  if not p_allow_negative and v_item.current_stock < v_qty then
    raise exception 'Estoque insuficiente de "%": disponível % %, necessário % %.',
      v_item.name, v_item.current_stock, v_item.base_unit, v_qty, v_item.base_unit
      using errcode = 'P0001',
            hint = 'Registre a entrada da NF-e ou um ajuste de inventário antes de continuar.';
  end if;

  v_remaining := v_qty;

  -- FEFO: vencimento mais próximo primeiro; lotes sem validade por último; desempate FIFO.
  for v_batch in
    select b.id, b.quantity, b.unit_cost
      from public.inventory_batches b
     where b.item_id = p_item_id
       and b.quantity > 0
     order by b.expiration_date asc nulls last, b.created_at asc, b.id asc
       for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_batch.quantity, v_remaining);

    update public.inventory_batches
       set quantity = quantity - v_take
     where id = v_batch.id;

    insert into public.stock_movements
      (item_id, batch_id, movement_type, quantity, unit_cost_at_moment, reference_id, notes, created_by)
    values
      (p_item_id, v_batch.id, p_movement_type, -v_take, v_batch.unit_cost, p_reference_id, p_notes, p_user_id);

    v_total_cost := v_total_cost + v_take * v_batch.unit_cost;
    v_remaining  := v_remaining - v_take;
  end loop;

  -- Saldo sem lote rastreado (estoque legado ou negativo autorizado): custo médio.
  if v_remaining > 0 then
    insert into public.stock_movements
      (item_id, batch_id, movement_type, quantity, unit_cost_at_moment, reference_id, notes, created_by)
    values
      (p_item_id, null, p_movement_type, -v_remaining, v_item.avg_cost, p_reference_id, p_notes, p_user_id);

    v_total_cost := v_total_cost + v_remaining * v_item.avg_cost;
  end if;

  update public.items
     set current_stock = current_stock - v_qty
   where id = p_item_id;

  return round(v_total_cost, 4);
end;
$$;

-- =============================================================================
-- PRIMITIVA: ENTRADA DE ESTOQUE + CUSTO MÉDIO PONDERADO
-- novo_custo = (saldo_atual × custo_atual + custo_entrada) / (saldo_atual + qtd_entrada)
-- Saldo negativo é tratado como zero para não distorcer o custo médio.
-- Retorna o id do lote criado/atualizado (null se p_batch_code for null).
-- =============================================================================
create or replace function public._receive_stock(
  p_item_id         uuid,
  p_quantity        numeric,
  p_total_cost      numeric,
  p_movement_type   public.stock_movement_type,
  p_reference_id    uuid,
  p_user_id         uuid,
  p_batch_code      text default null,
  p_expiration_date date default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item       record;
  v_qty        numeric(12,4) := round(p_quantity, 4);
  v_unit_cost  numeric(12,4);
  v_prev_stock numeric(12,4);
  v_new_avg    numeric(12,4);
  v_batch_id   uuid;
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Quantidade de entrada deve ser positiva (recebido: %).', p_quantity using errcode = '22023';
  end if;
  if p_total_cost is null or p_total_cost < 0 then
    raise exception 'Custo de entrada inválido (recebido: %).', p_total_cost using errcode = '22023';
  end if;
  if p_movement_type not in ('ENTRADA_NF', 'ENTRADA_OP', 'TRANSFORMACAO_ENTRADA', 'AJUSTE_INVENTARIO') then
    raise exception 'Tipo de movimento % não é uma entrada.', p_movement_type using errcode = '22023';
  end if;

  perform set_config('app.rpc_context', 'on', true);

  select id, name, current_stock, avg_cost
    into v_item
    from public.items
   where id = p_item_id
     for update;

  if not found then
    raise exception 'Item % não encontrado.', p_item_id using errcode = 'P0002';
  end if;

  v_unit_cost  := round(p_total_cost / v_qty, 4);
  v_prev_stock := greatest(v_item.current_stock, 0);
  v_new_avg    := round((v_prev_stock * v_item.avg_cost + p_total_cost) / (v_prev_stock + v_qty), 4);

  if p_batch_code is not null then
    insert into public.inventory_batches
      (item_id, batch_code, expiration_date, quantity, initial_quantity, unit_cost, reference_id)
    values
      (p_item_id, p_batch_code, p_expiration_date, v_qty, v_qty, v_unit_cost, p_reference_id)
    on conflict (item_id, batch_code) do update
      set unit_cost = round(
            (inventory_batches.quantity * inventory_batches.unit_cost + excluded.quantity * excluded.unit_cost)
            / (inventory_batches.quantity + excluded.quantity), 4),
          quantity         = inventory_batches.quantity + excluded.quantity,
          initial_quantity = inventory_batches.initial_quantity + excluded.initial_quantity,
          expiration_date  = least(inventory_batches.expiration_date, excluded.expiration_date)
    returning id into v_batch_id;
  end if;

  insert into public.stock_movements
    (item_id, batch_id, movement_type, quantity, unit_cost_at_moment, reference_id, notes, created_by)
  values
    (p_item_id, v_batch_id, p_movement_type, v_qty, v_unit_cost, p_reference_id, p_notes, p_user_id);

  update public.items
     set current_stock = current_stock + v_qty,
         avg_cost      = v_new_avg
   where id = p_item_id;

  return v_batch_id;
end;
$$;

-- =============================================================================
-- RPC: complete_production_order
-- 1. Baixa proporcional dos insumos (ficha × scaling_factor) via FEFO.
-- 2. Registra SAIDA_OP no Kardex (uma linha por lote consumido).
-- 3. Dá entrada do rendimento real no produto acabado (lote OP-000123).
-- 4. Recalcula custo médio ponderado do produto (insumos + rateio operacional).
-- =============================================================================
create or replace function public.complete_production_order(
  p_order_id              uuid,
  p_actual_yield_quantity numeric,
  p_damaged_quantity      numeric default 0,
  p_allow_negative_stock  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user             uuid;
  v_op               public.production_orders%rowtype;
  v_sheet            public.technical_sheets%rowtype;
  v_product          public.items%rowtype;
  v_ing              record;
  v_required         numeric(12,4);
  v_line_cost        numeric(18,4);
  v_ingredients_cost numeric(18,4) := 0;
  v_total_cost       numeric(10,2);
  v_stock_in         numeric(12,4);
  v_planned          numeric(12,2);
  v_batch_code       text;
  v_expiration       date;
  v_batch_id         uuid;
  v_consumed         jsonb := '[]'::jsonb;
begin
  v_user := public._assert_role(array['ADMIN', 'GERENTE', 'PADEIRO']::public.user_role[]);

  if p_actual_yield_quantity is null or p_actual_yield_quantity <= 0 then
    raise exception 'Rendimento real deve ser maior que zero.' using errcode = '22023';
  end if;
  if coalesce(p_damaged_quantity, 0) < 0 then
    raise exception 'Quantidade de quebra não pode ser negativa.' using errcode = '22023';
  end if;
  if p_allow_negative_stock and not public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]) then
    raise exception 'Somente ADMIN/GERENTE podem autorizar baixa com estoque negativo.' using errcode = '42501';
  end if;

  -- Autoriza a transição para FINALIZADA (validada pelo trigger de máquina de estados).
  perform set_config('app.rpc_context', 'on', true);

  select * into v_op from public.production_orders where id = p_order_id for update;
  if not found then
    raise exception 'Ordem de produção % não encontrada.', p_order_id using errcode = 'P0002';
  end if;
  if v_op.status not in ('PLANEJADA', 'EM_PRODUCAO', 'ASSANDO') then
    raise exception 'OP #% está com status % e não pode ser finalizada.', v_op.order_number, v_op.status
      using errcode = '55000';
  end if;

  select * into v_sheet from public.technical_sheets where id = v_op.sheet_id;
  select * into v_product from public.items where id = v_sheet.product_id;

  -- 1 + 2: consumo dos insumos (ordenado por id → ordem de lock determinística).
  for v_ing in
    select tsi.ingredient_id, tsi.quantity_g_ml, i.name, i.base_unit
      from public.technical_sheet_items tsi
      join public.items i on i.id = tsi.ingredient_id
     where tsi.sheet_id = v_sheet.id
     order by tsi.ingredient_id
  loop
    v_required := round(v_ing.quantity_g_ml * v_op.scaling_factor, 4);
    continue when v_required <= 0;

    v_line_cost := public._consume_stock_fefo(
      v_ing.ingredient_id,
      v_required,
      'SAIDA_OP',
      v_op.id,
      v_user,
      p_allow_negative_stock,
      format('OP #%s — %s', v_op.order_number, v_sheet.name)
    );

    v_ingredients_cost := v_ingredients_cost + v_line_cost;
    v_consumed := v_consumed || jsonb_build_object(
      'ingredient_id', v_ing.ingredient_id,
      'name',          v_ing.name,
      'quantity',      v_required,
      'unit',          v_ing.base_unit,
      'cost',          round(v_line_cost, 4)
    );
  end loop;

  if jsonb_array_length(v_consumed) = 0 then
    raise exception 'Ficha técnica "%" não possui ingredientes.', v_sheet.name using errcode = '55000';
  end if;

  -- 4: custo total = insumos + rateio operacional (gás, energia, mão de obra).
  v_total_cost := round(v_ingredients_cost * (1 + v_sheet.operational_overhead_pct / 100), 2);

  -- 3: rendimento (em unidades) convertido para a unidade base do produto.
  if v_product.base_unit = 'UN' then
    v_stock_in := p_actual_yield_quantity;
  elsif v_product.base_unit = 'G' then
    if v_sheet.expected_unit_weight_baked_g is null then
      raise exception 'Produto "%" é estocado em gramas: informe expected_unit_weight_baked_g na ficha "%".',
        v_product.name, v_sheet.name using errcode = '55000';
    end if;
    v_stock_in := round(p_actual_yield_quantity * v_sheet.expected_unit_weight_baked_g, 4);
  else
    raise exception 'Unidade base % não suportada para produto produzido.', v_product.base_unit
      using errcode = '55000';
  end if;

  v_batch_code := format('OP-%s', lpad(v_op.order_number::text, 6, '0'));
  v_expiration := case when v_product.shelf_life_days is not null
                       then (now() at time zone 'America/Sao_Paulo')::date + v_product.shelf_life_days
                  end;

  v_batch_id := public._receive_stock(
    v_product.id,
    v_stock_in,
    v_total_cost,
    'ENTRADA_OP',
    v_op.id,
    v_user,
    v_batch_code,
    v_expiration,
    format('OP #%s — rendimento %s un, quebra %s un', v_op.order_number, p_actual_yield_quantity, coalesce(p_damaged_quantity, 0))
  );

  update public.production_orders
     set status                = 'FINALIZADA',
         actual_yield_quantity = p_actual_yield_quantity,
         damaged_quantity      = coalesce(p_damaged_quantity, 0),
         total_production_cost = v_total_cost,
         completed_at          = now(),
         started_at            = coalesce(started_at, now()),
         baker_id              = coalesce(baker_id, v_user)
   where id = v_op.id;

  v_planned := coalesce(v_op.planned_quantity, v_sheet.expected_yield_units * v_op.scaling_factor);

  return jsonb_build_object(
    'order_id',              v_op.id,
    'order_number',          v_op.order_number,
    'product_id',            v_product.id,
    'product_name',          v_product.name,
    'ingredients_cost',      round(v_ingredients_cost, 4),
    'total_production_cost', v_total_cost,
    'unit_cost',             round(v_total_cost / p_actual_yield_quantity, 4),
    'stock_added',           v_stock_in,
    'stock_unit',            v_product.base_unit,
    'batch_id',              v_batch_id,
    'batch_code',            v_batch_code,
    'expiration_date',       v_expiration,
    'planned_quantity',      v_planned,
    'yield_variance_pct',    round((p_actual_yield_quantity - v_planned) / v_planned * 100, 2),
    'consumed',              v_consumed
  );
end;
$$;

-- Alias semântico (nomenclatura das Regras de Ouro).
create or replace function public.execute_production_order(
  p_order_id              uuid,
  p_actual_yield_quantity numeric,
  p_damaged_quantity      numeric default 0,
  p_allow_negative_stock  boolean default false
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.complete_production_order(p_order_id, p_actual_yield_quantity, p_damaged_quantity, p_allow_negative_stock);
$$;

-- =============================================================================
-- RPC: transform_waste_product (OP Reversa / Perdas)
-- DESCARTE_PERDA: baixa o item e registra o custo como perda (DRE).
-- TRANSFORMACAO : baixa o item origem e dá entrada no destino carregando
--                 integralmente o custo contábil da origem (custo médio do destino).
-- =============================================================================
create or replace function public.transform_waste_product(
  p_source_item_id       uuid,
  p_source_quantity      numeric,
  p_type                 public.waste_type,
  p_target_item_id       uuid default null,
  p_target_quantity      numeric default null,
  p_reason               text default null,
  p_allow_negative_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid;
  v_id          uuid := gen_random_uuid();
  v_source      public.items%rowtype;
  v_target      public.items%rowtype;
  v_source_cost numeric(18,4);
  v_batch_id    uuid;
  v_batch_code  text;
  v_expiration  date;
  v_reason      text := nullif(trim(p_reason), '');
begin
  v_user := public._assert_role(array['ADMIN', 'GERENTE', 'PADEIRO', 'CAIXA', 'ATENDENTE']::public.user_role[]);

  if p_source_quantity is null or p_source_quantity <= 0 then
    raise exception 'Quantidade de origem deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_allow_negative_stock and not public.has_role(array['ADMIN', 'GERENTE']::public.user_role[]) then
    raise exception 'Somente ADMIN/GERENTE podem autorizar baixa com estoque negativo.' using errcode = '42501';
  end if;

  select * into v_source from public.items where id = p_source_item_id;
  if not found then
    raise exception 'Item de origem % não encontrado.', p_source_item_id using errcode = 'P0002';
  end if;

  if p_type = 'DESCARTE_PERDA' then
    if p_target_item_id is not null or p_target_quantity is not null then
      raise exception 'Descarte não aceita item/quantidade de destino.' using errcode = '22023';
    end if;
    if v_reason is null then
      raise exception 'Informe o motivo do descarte (auditoria).' using errcode = '22023';
    end if;
  else
    if p_target_item_id is null or p_target_quantity is null or p_target_quantity <= 0 then
      raise exception 'Transformação exige item de destino e quantidade gerada > 0.' using errcode = '22023';
    end if;
    if p_target_item_id = p_source_item_id then
      raise exception 'Item de destino deve ser diferente do item de origem.' using errcode = '22023';
    end if;
    select * into v_target from public.items where id = p_target_item_id;
    if not found then
      raise exception 'Item de destino % não encontrado.', p_target_item_id using errcode = 'P0002';
    end if;
    if v_target.type = 'REVENDA' then
      raise exception 'Item de revenda não pode ser gerado por transformação.' using errcode = '22023';
    end if;
  end if;

  -- Baixa da origem (FEFO): o pão mais antigo é o primeiro a virar farinha de rosca.
  v_source_cost := public._consume_stock_fefo(
    p_source_item_id,
    p_source_quantity,
    case when p_type = 'DESCARTE_PERDA'
         then 'PERDA'::public.stock_movement_type
         else 'TRANSFORMACAO_SAIDA'::public.stock_movement_type
    end,
    v_id,
    v_user,
    p_allow_negative_stock,
    coalesce(v_reason, p_type::text)
  );

  if p_type = 'TRANSFORMACAO' then
    v_batch_code := format('TR-%s-%s',
      to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD'),
      upper(left(replace(v_id::text, '-', ''), 8)));
    v_expiration := case when v_target.shelf_life_days is not null
                         then (now() at time zone 'America/Sao_Paulo')::date + v_target.shelf_life_days
                    end;

    v_batch_id := public._receive_stock(
      p_target_item_id,
      p_target_quantity,
      v_source_cost,               -- custo integral transferido (DRE íntegro)
      'TRANSFORMACAO_ENTRADA',
      v_id,
      v_user,
      v_batch_code,
      v_expiration,
      format('Transformação de %s %s de "%s"', p_source_quantity, v_source.base_unit, v_source.name)
    );
  end if;

  insert into public.waste_and_transformations (
    id, source_item_id, source_quantity, type, target_item_id,
    target_quantity_generated, transferred_cost, reason, user_id
  ) values (
    v_id, p_source_item_id, p_source_quantity, p_type, p_target_item_id,
    p_target_quantity, round(v_source_cost, 2), v_reason, v_user
  );

  return jsonb_build_object(
    'id',                 v_id,
    'type',               p_type,
    'source_item_id',     p_source_item_id,
    'source_quantity',    p_source_quantity,
    'source_cost',        round(v_source_cost, 4),
    'target_item_id',     p_target_item_id,
    'target_quantity',    p_target_quantity,
    'target_unit_cost',   case when p_type = 'TRANSFORMACAO'
                               then round(v_source_cost / p_target_quantity, 4) end,
    'target_batch_id',    v_batch_id,
    'yield_ratio_pct',    case when p_type = 'TRANSFORMACAO'
                               then round(p_target_quantity / p_source_quantity * 100, 2) end
  );
end;
$$;

-- =============================================================================
-- RPC: adjust_inventory (inventário físico / carga inicial)
-- =============================================================================
create or replace function public.adjust_inventory(
  p_item_id          uuid,
  p_counted_quantity numeric,
  p_reason           text,
  p_unit_cost        numeric default null,
  p_batch_code       text default null,
  p_expiration_date  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_ref   uuid := gen_random_uuid();
  v_item  public.items%rowtype;
  v_delta numeric(12,4);
  v_cost  numeric(18,4) := 0;
begin
  v_user := public._assert_role(array['ADMIN', 'GERENTE']::public.user_role[]);

  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Quantidade contada inválida.' using errcode = '22023';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Informe o motivo do ajuste.' using errcode = '22023';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Custo unitário não pode ser negativo.' using errcode = '22023';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception 'Item % não encontrado.', p_item_id using errcode = 'P0002';
  end if;

  v_delta := round(p_counted_quantity, 4) - v_item.current_stock;

  if v_delta > 0 then
    v_cost := v_delta * coalesce(p_unit_cost, v_item.avg_cost);
    perform public._receive_stock(
      p_item_id, v_delta, v_cost, 'AJUSTE_INVENTARIO', v_ref, v_user,
      p_batch_code, p_expiration_date, p_reason
    );
  elsif v_delta < 0 then
    v_cost := public._consume_stock_fefo(
      p_item_id, -v_delta, 'AJUSTE_INVENTARIO', v_ref, v_user, true, p_reason
    );
  end if;

  return jsonb_build_object(
    'reference_id',   v_ref,
    'item_id',        p_item_id,
    'previous_stock', v_item.current_stock,
    'counted_stock',  round(p_counted_quantity, 4),
    'delta',          v_delta,
    'cost_impact',    round(case when v_delta < 0 then -v_cost else v_cost end, 4)
  );
end;
$$;

-- =============================================================================
-- PRIVILÉGIOS
-- Primitivas internas (prefixo "_") nunca são expostas via PostgREST.
-- =============================================================================
revoke all on function public._consume_stock_fefo(uuid, numeric, public.stock_movement_type, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public._receive_stock(uuid, numeric, numeric, public.stock_movement_type, uuid, uuid, text, date, text) from public, anon, authenticated;
revoke all on function public._assert_role(public.user_role[]) from public, anon, authenticated;

revoke all on function public.complete_production_order(uuid, numeric, numeric, boolean) from public, anon;
revoke all on function public.execute_production_order(uuid, numeric, numeric, boolean) from public, anon;
revoke all on function public.transform_waste_product(uuid, numeric, public.waste_type, uuid, numeric, text, boolean) from public, anon;
revoke all on function public.adjust_inventory(uuid, numeric, text, numeric, text, date) from public, anon;

grant execute on function public.complete_production_order(uuid, numeric, numeric, boolean) to authenticated;
grant execute on function public.execute_production_order(uuid, numeric, numeric, boolean) to authenticated;
grant execute on function public.transform_waste_product(uuid, numeric, public.waste_type, uuid, numeric, text, boolean) to authenticated;
grant execute on function public.adjust_inventory(uuid, numeric, text, numeric, text, date) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_role(public.user_role[]) to authenticated;
