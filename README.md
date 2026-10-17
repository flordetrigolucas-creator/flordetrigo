# Flor do Trigo — Sistema de Gestão Integrado (ERP + PCP + PDV + CRM B2B/B2C + Hub de IA)

Sistema industrial de missão crítica desenvolvido para padarias e indústrias de panificação, integrando **Engenharia de Cardápio (Baker's Percentage)**, **KDS/Calculadora de Masseira (PCP)**, **Frente de Caixa Offline-First (`/pos`) com leitura de balança (EAN-13 Prefixo 2 & Web Serial)**, **OP Reversa (Transformação de Sobras)**, **Importador XML NF-e** e **CRM B2B/B2C com Gateway para Agente de IA**.

## Stack Tecnológica

- **Frontend:** React 18 + Vite 6 + TypeScript (Strict Mode) + Tailwind CSS + Shadcn UI + Lucide Icons
- **Aritmética Financeira & Pesos (Zero Float):** `decimal.js` no frontend e `NUMERIC(12,4)` / `NUMERIC(10,2)` no PostgreSQL
- **Offline-First & Estado:** TanStack Query + Zustand + IndexedDB (`Dexie.js`) + Sincronizador Realtime
- **Backend & Database:** Supabase (PostgreSQL 15+, Row Level Security, Funções RPC Transacionais em PL/pgSQL, Supabase Realtime e Edge Functions)

## Estrutura de Migrations (`/supabase/migrations`)

1. `20261017000001_core_schema.sql`: 18 tabelas, 2 views (`b2b_accounts`, `v_technical_sheet_costs`), constraints de unidade base (`G`, `ML`, `UN`) e triggers de imutabilidade do Kardex (`stock_movements`).
2. `20261017000002_transactional_functions.sql`: Funções atômicas `complete_production_order`, `execute_production_order`, `transform_waste_product` e `adjust_inventory` com consumo **FEFO** (*First Expire, First Out*) e recálculo de Custo Médio Ponderado.
3. `20261017000003_rls_and_realtime.sql`: Políticas de Row Level Security por perfil (`ADMIN`, `GERENTE`, `PADEIRO`, `CAIXA`, `ATENDENTE`) e publicação `supabase_realtime`.
4. `20261017000004_pos_and_nfe_rpcs.sql`: Funções atômicas `record_pos_or_ai_sale` (vendas PDV/IA com idempotência offline) e `confirm_nfe_xml_entry` (conversão De/Para de NF-e).

## Execução Local

```bash
cp .env.example .env
npm install
npm run dev
```
