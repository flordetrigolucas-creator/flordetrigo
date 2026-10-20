# Memória do Projeto — Flor do Trigo (ERP + PCP + PDV + CRM B2B/B2C + Hub de IA)

**Última atualização:** 20/10/2026  
**Diretório Raiz:** `c:\Flor do Trigo`  
**Status Atual:** **100% Funcional em Produção (Frontend + Banco Supabase + Responsividade Android/iOS + Deploy GitHub/Vercel)**

---

## 1. Resumo Executivo do que foi Construído

Sistema de Gestão Integrado de missão crítica para indústria de panificação e varejo de padaria (**Flor do Trigo**), cobrindo ponta a ponta desde a entrada do caminhão de insumos (XML NF-e) até a masseira/forno (PCP/KDS), reaproveitamento de sobras (OP Reversa), venda no balcão (PDV Offline-First com Balança Serial), atendimento automatizado via IA no WhatsApp (CRM B2B/B2C) e apuração contábil em tempo real (DRE Gerencial e Curva ABC de Pareto).

### Regras de Ouro de Engenharia Implementadas
1. **Zero Float para Finanças e Pesos:**
   - Banco de Dados PostgreSQL: `NUMERIC(12,4)` para quantidades/pesos e `avg_cost` unitário; `NUMERIC(10,2)` para valores monetários.
   - Frontend TypeScript: todos os cálculos financeiros, rateios e conversões utilizam [`Decimal.js`](file:///c:/Flor%20do%20Trigo/src/lib/decimal.ts).
2. **Transações Atômicas no Banco (ACID via PL/pgSQL RPCs):**
   - Nenhuma operação crítica de estoque depende de múltiplos `UPDATE` soltos no cliente. Tudo roda dentro de funções transacionais no PostgreSQL (`complete_production_order`, `execute_production_order`, `transform_waste_product`, `record_pos_or_ai_sale`, `confirm_nfe_xml_entry`, `adjust_inventory`).
3. **Unidades Base Padronizadas (`G`, `ML`, `UN`):**
   - O estoque é armazenado exclusivamente em Gramas (`G`), Mililitros (`ML`) ou Unidades (`UN`), convertendo sacos (`SC`), fardos (`FD`) e caixas (`CX`) na entrada da NF-e.
4. **Responsividade Total (Android, iOS, Tablet Totem e Desktop):**
   - Safe Area Insets (`pb-safe`, `pt-safe`), Dynamic Viewport (`100dvh`), prevenção de auto-zoom no iOS Safari (`font-size: 16px` em inputs mobile), barra de navegação inferior nativa (Bottom Tab Bar), Drawer deslizante e abas dedicadas no PDV e CRM mobile.

---

## 2. Infraestrutura, Repositório e Ambientes Conectados

| Recurso | Endereço / Identificador | Observações |
| :--- | :--- | :--- |
| **Repositório GitHub** | `https://github.com/flordetrigolucas-creator/flordetrigo` | Branch principal: `main` • Branch estática: `gh-pages` |
| **Deploy GitHub Pages** | `https://flordetrigolucas-creator.github.io/flordetrigo/` | Ativo com HTTPS e fallback `404.html` para rotas SPA |
| **Deploy Vercel** | Conectado ao repositório `flordetrigo` (`main`) | Configurado via [`vercel.json`](file:///c:/Flor%20do%20Trigo/vercel.json) |
| **Supabase Project Ref** | `yitylnghamfsgkdqdzen` | URL: `https://yitylnghamfsgkdqdzen.supabase.co` |
| **Credenciais Locais** | Arquivo `.env` na raiz (ignorado pelo Git via `.gitignore`) | Modelo documentado em [`.env.example`](file:///c:/Flor%20do%20Trigo/.env.example) |

### Variáveis de Ambiente (Vercel / `.env`)
```env
VITE_SUPABASE_URL=https://yitylnghamfsgkdqdzen.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdHlsbmdoYW1mc2drZHFkemVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNjc2NzgsImV4cCI6MjEwNzg0MzY3OH0.-9OrDE1_mgibN-uJ1YFY8c48IHSuHEHbI3E43a1BaCs
VITE_POS_TERMINAL_ID=CAIXA-01
```

### Usuários RBAC Provisionados no Supabase Auth (`auth.users` + `public.profiles`)
Senha padrão de homologação para todos os perfis: `FlorDoTrigo@2026`
- **ADMIN:** `admin@flordotrigo.com.br` (`aaaaaaaa-0000-4000-a000-000000000001`) — Lucas (Admin / Diretor)
- **GERENTE:** `gerente@flordotrigo.com.br` (`aaaaaaaa-0000-4000-a000-000000000002`) — Helena (Gerente Industrial)
- **PADEIRO:** `padeiro@flordotrigo.com.br` (`aaaaaaaa-0000-4000-a000-000000000003`) — Mestre Zé (Chefe de Fornada)
- **CAIXA:** `caixa@flordotrigo.com.br` (`aaaaaaaa-0000-4000-a000-000000000004`) — Carla (Operadora PDV 01)
- **ATENDENTE:** `atendente@flordotrigo.com.br` (`aaaaaaaa-0000-4000-a000-000000000005`) — Rafael (Balcão & WhatsApp)

---

## 3. Mapa da Arquitetura e Arquivos Construídos

### 3.1. Banco de Dados & Backend (`supabase/`)
- [`supabase/migrations/20261017000001_core_schema.sql`](file:///c:/Flor%20do%20Trigo/supabase/migrations/20261017000001_core_schema.sql):
  - Tabelas: `profiles`, `tax_rules`, `items`, `unit_conversions`, `inventory_batches`, `technical_sheets`, `technical_sheet_items`, `production_orders`, `waste_and_transformations`, `stock_movements` (imutável com trigger anti-UPDATE/DELETE), `crm_customers`, `orders_and_pos_sales`, `order_items`, `crm_conversations`, `crm_messages`, `nfe_imports`, `nfe_import_items`, `production_alerts`.
  - Views: `b2b_accounts` e `v_technical_sheet_costs`.
- [`supabase/migrations/20261017000002_transactional_functions.sql`](file:///c:/Flor%20do%20Trigo/supabase/migrations/20261017000002_transactional_functions.sql):
  - Funções PL/pgSQL: `_consume_stock_fefo`, `_receive_stock`, `complete_production_order`, `execute_production_order`, `transform_waste_product`, `adjust_inventory`.
- [`supabase/migrations/20261017000003_rls_and_realtime.sql`](file:///c:/Flor%20do%20Trigo/supabase/migrations/20261017000003_rls_and_realtime.sql):
  - Políticas RLS por perfil RBAC e publicação `supabase_realtime` (`production_orders`, `production_alerts`, `crm_conversations`, `crm_messages`, `orders_and_pos_sales`, `items`).
- [`supabase/migrations/20261017000004_pos_and_nfe_rpcs.sql`](file:///c:/Flor%20do%20Trigo/supabase/migrations/20261017000004_pos_and_nfe_rpcs.sql):
  - Funções PL/pgSQL: `record_pos_or_ai_sale` (idempotente via `p_offline_client_id`, valida limite B2B, baixa FEFO e gera alerta no KDS) e `confirm_nfe_xml_entry` (importa NF-e, grava De/Para e gera lotes FEFO).
- [`supabase/seed.sql`](file:///c:/Flor%20do%20Trigo/supabase/seed.sql):
  - Dados iniciais completos (insumos, produtos acabados, subprodutos, fichas técnicas 50kg e 25kg, lotes FEFO, clientes B2B, conversas WhatsApp e alertas).
- [`supabase/functions/ai-gateway/index.ts`](file:///c:/Flor%20do%20Trigo/supabase/functions/ai-gateway/index.ts):
  - Edge Function Deno para integração com n8n / Evolution API (`GET /customer-context` e `POST /create-order`).

### 3.2. Núcleo Frontend, Sincronização e Estado (`src/lib/`, `src/stores/`)
- [`src/lib/decimal.ts`](file:///c:/Flor%20do%20Trigo/src/lib/decimal.ts): Aritmética exata `Decimal.js` e formatadores (`formatBRL`, `formatQuantity`, `formatUnitCost`, `formatPercent`).
- [`src/lib/units.ts`](file:///c:/Flor%20do%20Trigo/src/lib/units.ts): Conversor de unidades comerciais de NF-e (`SC 50KG`, `FD`, `CX`) para base (`G`, `ML`, `UN`).
- [`src/lib/offlineDb.ts`](file:///c:/Flor%20do%20Trigo/src/lib/offlineDb.ts): Banco local IndexedDB (`Dexie.js`) para operação Offline-First e fila de contingência do PDV.
- [`src/lib/supabaseSync.ts`](file:///c:/Flor%20do%20Trigo/src/lib/supabaseSync.ts): Sincronização bidirecional Supabase ↔ IndexedDB e assinatura de canais Realtime.
- [`src/stores/authStore.ts`](file:///c:/Flor%20do%20Trigo/src/stores/authStore.ts): Gerenciamento de sessão RBAC com login automático nos usuários reais do Supabase Auth ao alternar perfil.

### 3.3. Módulos Funcionais (`src/features/`)
1. **Módulo 1 — Engenharia de Cardápio & PCP (`src/features/pcp/`):**
   - [`bakersMath.ts`](file:///c:/Flor%20do%20Trigo/src/features/pcp/bakersMath.ts): Cálculo puro de Porcentagem de Padeiro (Farinha = 100%), hidratação, quebra de cocção, escalonamento dinâmico de batida e CMV unitário.
   - [`TechnicalSheetsPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/pcp/TechnicalSheetsPage.tsx): Editor de Fichas Técnicas em tempo real (`/fichas-tecnicas`).
   - [`BakerKdsPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/pcp/BakerKdsPage.tsx): Tela do Padeiro / Totem KDS e Calculadora de Masseira (`/pcp`).
   - [`pcpService.ts`](file:///c:/Flor%20do%20Trigo/src/features/pcp/pcpService.ts): Integração com as RPCs `complete_production_order` e `transform_waste_product` + fallback transacional offline.
2. **Módulo 2 — Gestão de Perdas e OP Reversa (`src/features/waste/`):**
   - [`WasteManagementPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/waste/WasteManagementPage.tsx): Transformação de Pão Francês Dormido em Farinha de Rosca com transferência de custo contábil (`/perdas`).
3. **Módulo 3 — Frente de Caixa Offline-First & Hardware Bridge (`src/features/pos/`):**
   - [`scaleBarcodeParser.ts`](file:///c:/Flor%20do%20Trigo/src/features/pos/scaleBarcodeParser.ts): Decodificador e gerador de etiquetas EAN-13 in-store (prefixo `2`, PLU + 5 dígitos de peso ou preço + dígito verificador módulo 10).
   - [`scaleSerialService.ts`](file:///c:/Flor%20do%20Trigo/src/features/pos/scaleSerialService.ts): Integração Web Serial API (`navigator.serial`) para balanças Toledo/Filizola/Urano + simulador de peso (`F4`).
   - [`PosPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/pos/PosPage.tsx): Tela cheia `/pos` de alto contraste, atalhos `F2`–`F12`, faturamento B2B com trava de limite de crédito e modo mobile com abas (`Catálogo & Scanner` / `Cupom & Pagamento`).
4. **Módulo 4 — Entrada de Notas Fiscais XML (`src/features/nfe/`):**
   - [`nfeXmlParser.ts`](file:///c:/Flor%20do%20Trigo/src/features/nfe/nfeXmlParser.ts): Parser DOM nativo para XML de NF-e brasileira (`<det>`, `<prod>`, `xProd`, `qCom`, `uCom`, `vUnCom`, `NCM`).
   - [`NfeImporterPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/nfe/NfeImporterPage.tsx): Importador drag-and-drop com tabela De/Para de unidades e validade FEFO (`/nfe`).
5. **Módulo 5 — CRM B2B/B2C, Inbox WhatsApp & Gateway IA (`src/features/crm/`):**
   - [`aiGatewayService.ts`](file:///c:/Flor%20do%20Trigo/src/features/crm/aiGatewayService.ts): Serviço para os webhooks `GET /api/ai/customer-context` e `POST /api/ai/create-order`.
   - [`CrmInboxPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/crm/CrmInboxPage.tsx): Inbox estilo WhatsApp Web com botão **"Assumir Atendimento (Transbordo Humano)"**, console de teste de webhooks IA e carteira corporativa B2B (`/crm`).
6. **Módulo 6 — Painel Executivo DRE & Curva ABC (`src/features/dashboard/`):**
   - [`ExecutiveDashboardPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/dashboard/ExecutiveDashboardPage.tsx): DRE Gerencial (CMV Teórico vs. CMV Real e Desvio de Cozinha), Curva ABC de Lucro Líquido (Pareto 80/15/5) e Alertas de Validade FEFO (`/dashboard`).

### 3.4. Materiais de Treinamento e Documentação
- [`FONTE_NOTEBOOKLM_GUIA_COMPLETO_FLOR_DO_TRIGO.md`](file:///c:/Flor%20do%20Trigo/FONTE_NOTEBOOKLM_GUIA_COMPLETO_FLOR_DO_TRIGO.md) e `.txt`: Fonte estruturada para geração de vídeo/áudio explicativo no Google NotebookLM.

---

## 4. Onde Paramos (Últimas Ações Concluídas)

1. **Banco Supabase populado e validado:** Todas as 4 migrations e o seed foram aplicados no projeto `yitylnghamfsgkdqdzen`, com 5 usuários RBAC reais e testes E2E validando que `SUM(stock_movements.quantity) == items.current_stock`.
2. **Responsividade Android & iOS finalizada:** Menu mobile (Topbar + Drawer + Bottom Tab Bar), PDV mobile com abas e barra flutuante de cupom, Inbox WhatsApp master-detail no celular e tabelas com scroll horizontal fluido.
3. **Correção do botão `← Retaguarda ERP` no PDV (`/pos`):** Ajustado em [`PosPage.tsx`](file:///c:/Flor%20do%20Trigo/src/features/pos/PosPage.tsx) e [`authStore.ts`](file:///c:/Flor%20do%20Trigo/src/stores/authStore.ts) para que o operador no perfil `CAIXA` não fique preso em loop ao clicar para voltar à Retaguarda ERP.
4. **Fonte para vídeo no NotebookLM criada:** Arquivos `.md` e `.txt` gerados na raiz do projeto.

---

## 5. Próximos Passos Sugeridos (Para Quando Retornar ao Projeto)

Quando retomar o desenvolvimento, os próximos passos naturais de evolução são:
1. **Conexão Real com n8n + Evolution API (WhatsApp em Produção):**
   - Configurar o workflow no n8n apontando para a Edge Function `ai-gateway` do Supabase (`https://yitylnghamfsgkdqdzen.supabase.co/functions/v1/ai-gateway`) para receber mensagens reais do WhatsApp.
2. **Emissão Fiscal NFC-e / NF-e (Integração SEFAZ via API Fiscal):**
   - Conectar o status `fiscal_status` da tabela `orders_and_pos_sales` a um provedor de mensageria fiscal (Focus NFe / PlugNotas / WebmaniaBR) para emissão automática do DANFE NFC-e no fechamento do PDV.
3. **Tela de Cadastro/Edição Completa de Catálogo de Itens (`items`) e Clientes (`crm_customers`):**
   - Criar modais CRUD dedicados para cadastrar novos insumos/produtos de revenda e novos clientes B2B diretamente pela interface administrativa.
4. **Relatório de Fechamento de Caixa (Sangria, Suprimento e Conferência Cega por Turno):**
   - Adicionar abertura/fechamento de turno do operador de caixa no módulo `/pos`.
