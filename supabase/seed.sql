-- =============================================================================
-- Flor do Trigo ERP — Seed de desenvolvimento (supabase db reset)
-- Receita base: Pão Francês 50kg de farinha → 1.200 pães (65g cru / 50g assado)
-- =============================================================================

insert into public.tax_rules (id, name, regime, csosn_cst, icms_rate, has_icms_st, description) values
  ('00000000-0000-4000-a000-000000000001', 'Fabricação Própria — Simples', 'SIMPLES_NACIONAL', '102', 0, false,
   'Produtos fabricados no estabelecimento. CFOP 5101.'),
  ('00000000-0000-4000-a000-000000000002', 'Revenda com ST — Simples', 'SIMPLES_NACIONAL', '500', 0, true,
   'Mercadoria adquirida com ICMS retido por substituição tributária. CFOP 5405.');

insert into public.items
  (id, sku, barcode, scale_plu, name, type, base_unit, min_stock, avg_cost, sale_price, is_weighed, shelf_life_days, ncm, cest, cfop_interno, tax_rule_id)
values
  -- Insumos (avg_cost por grama/ml)
  ('10000000-0000-4000-a000-000000000001', 'INS-FARINHA-T1', null, null, 'Farinha de Trigo Tipo 1', 'INSUMO', 'G',  100000, 0.0030, null, false, 120, '11010010', null, null, null),
  ('10000000-0000-4000-a000-000000000002', 'INS-AGUA-GELO',  null, null, 'Água / Gelo',             'INSUMO', 'ML', 0,      0.0001, null, false, null, null, null, null, null),
  ('10000000-0000-4000-a000-000000000003', 'INS-SAL',        null, null, 'Sal Refinado',            'INSUMO', 'G',  5000,   0.0020, null, false, 365, '25010020', null, null, null),
  ('10000000-0000-4000-a000-000000000004', 'INS-MELHORADOR', null, null, 'Melhorador de Farinha',   'INSUMO', 'G',  2000,   0.0300, null, false, 180, '21069090', null, null, null),
  ('10000000-0000-4000-a000-000000000005', 'INS-FERMENTO',   null, null, 'Fermento Biológico Seco', 'INSUMO', 'G',  1000,   0.0400, null, false, 90,  '21021090', null, null, null),
  ('10000000-0000-4000-a000-000000000006', 'INS-OLEO-SOJA',  null, null, 'Óleo de Soja',            'INSUMO', 'ML', 2000,   0.0080, null, false, 180, '15079011', null, null, null),
  -- Produtos acabados / subprodutos
  ('20000000-0000-4000-a000-000000000001', 'PA-PAO-FRANCES',   null, '0001', 'Pão Francês',          'PRODUTO_ACABADO', 'G',  0, 0, 16.90, true,  1,  '19059090', '1706500', '5101', '00000000-0000-4000-a000-000000000001'),
  ('20000000-0000-4000-a000-000000000002', 'PA-PAO-HAMBURGUER', '7890000000017', null, 'Pão de Hambúrguer', 'PRODUTO_ACABADO', 'UN', 0, 0, 1.20, false, 3, '19059090', '1706500', '5101', '00000000-0000-4000-a000-000000000001'),
  ('20000000-0000-4000-a000-000000000003', 'SP-FARINHA-ROSCA', null, '0002', 'Farinha de Rosca',     'SUBPRODUTO',      'G',  0, 0, 18.00, true,  30, '19059090', null, '5101', '00000000-0000-4000-a000-000000000001'),
  -- Revenda
  ('30000000-0000-4000-a000-000000000001', 'RV-REFRI-COLA-350', '7894900011517', null, 'Refrigerante Cola Lata 350ml', 'REVENDA', 'UN', 24, 0, 6.50, false, null, '22021000', '0300700', '5405', '00000000-0000-4000-a000-000000000002');

insert into public.technical_sheets
  (id, product_id, name, base_flour_weight_g, expected_yield_units, expected_unit_weight_raw_g, expected_unit_weight_baked_g, operational_overhead_pct)
values
  ('40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   'Receita Base Pão Francês 50kg', 50000, 1200, 65, 50, 18.00);

insert into public.technical_sheet_items (sheet_id, ingredient_id, quantity_g_ml, sort_order) values
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 50000, 1),
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000002', 27500, 2),
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000003', 1000,  3),
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000004', 500,   4),
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000005', 250,   5),
  ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000006', 100,   6);

-- Carga inicial de estoque com lotes (gera Kardex AJUSTE_INVENTARIO).
select public._receive_stock('10000000-0000-4000-a000-000000000001', 250000, 750.00, 'AJUSTE_INVENTARIO', null, null, 'SEED-FAR-01', current_date + 60,  'Carga inicial (5 sacos 50kg)');
select public._receive_stock('10000000-0000-4000-a000-000000000001', 100000, 310.00, 'AJUSTE_INVENTARIO', null, null, 'SEED-FAR-02', current_date + 20,  'Carga inicial (2 sacos 50kg) — vence antes');
select public._receive_stock('10000000-0000-4000-a000-000000000002', 500000, 50.00,  'AJUSTE_INVENTARIO', null, null, null, null, 'Carga inicial');
select public._receive_stock('10000000-0000-4000-a000-000000000003', 25000,  50.00,  'AJUSTE_INVENTARIO', null, null, 'SEED-SAL-01', current_date + 300, 'Carga inicial');
select public._receive_stock('10000000-0000-4000-a000-000000000004', 10000,  300.00, 'AJUSTE_INVENTARIO', null, null, 'SEED-MEL-01', current_date + 150, 'Carga inicial');
select public._receive_stock('10000000-0000-4000-a000-000000000005', 5000,   200.00, 'AJUSTE_INVENTARIO', null, null, 'SEED-FER-01', current_date + 45,  'Carga inicial');
select public._receive_stock('10000000-0000-4000-a000-000000000006', 9000,   72.00,  'AJUSTE_INVENTARIO', null, null, 'SEED-OLE-01', current_date + 120, 'Carga inicial');
select public._receive_stock('30000000-0000-4000-a000-000000000001', 48,     158.40, 'AJUSTE_INVENTARIO', null, null, 'SEED-REF-01', current_date + 200, 'Carga inicial');

insert into public.crm_customers
  (id, name, document, whatsapp_phone, customer_type, credit_limit, billing_cycle_day, recurring_order_json)
values
  ('50000000-0000-4000-a000-000000000001', 'Hamburgueria Brasa Viva LTDA', '12345678000195', '5511987650001', 'B2B', 3000.00, 10,
   '[{"item_id":"20000000-0000-4000-a000-000000000002","quantity":150,"weekdays":[1,2,3,4,5,6],"delivery_time":"07:00"}]'::jsonb),
  ('50000000-0000-4000-a000-000000000002', 'Maria Souza', '12345678909', '5511987650002', 'B2C', 0, null, '[]'::jsonb);

