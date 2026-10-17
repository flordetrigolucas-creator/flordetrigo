# MANUAL OPERACIONAL E GUIA COMPLETO DE USO: SISTEMA FLOR DO TRIGO (ERP + PCP + PDV + CRM B2B/B2C + HUB DE IA)

> **Diretriz para o Gerador de Vídeo e Áudio do NotebookLM:**
> Este documento é a fonte oficial de treinamento e apresentação do **Sistema de Gestão Integrado Flor do Trigo**. Ao criar um **Resumo de Vídeo (Video Overview)** ou **Resumo de Áudio (Audio Overview)** a partir desta fonte, apresente o conteúdo em **Português do Brasil**, com tom **didático, dinâmico, prático e executivo**. Explique como a padaria funciona do início ao fim do dia usando cada uma das 6 telas do sistema, destacando os exemplos práticos com números reais, os botões que o usuário clica em cada tela e os benefícios financeiros e operacionais para o dono da padaria e sua equipe.

---

## 1. VISÃO GERAL: O QUE É O SISTEMA FLOR DO TRIGO?

O **Flor do Trigo ERP** é uma plataforma industrial completa desenvolvida sob medida para padarias, confeitarias e indústrias de panificação que operam tanto no varejo de balcão (B2C) quanto no fornecimento corporativo no atacado (B2B — como hamburguerias, restaurantes, hotéis e mercados).

Diferente de sistemas comuns que apenas emitem cupom fiscal e não conversam com a cozinha, o **Flor do Trigo** conecta **6 pilares em tempo real** no banco de dados em nuvem (Supabase PostgreSQL), funcionando inclusive no celular (Android e iOS), tablet de produção e computador de caixa:

1. **Painel Executivo (DRE Gerencial, Desvio de CMV e Curva ABC de Pareto):** Mostra para o dono onde está o lucro real e onde há desperdício ou roubo/desvio na cozinha.
2. **Engenharia de Cardápio e Ficha Técnica (Porcentagem de Padeiro / Baker's Percentage):** Calcula automaticamente o custo de cada grama da receita tendo a farinha como base 100%.
3. **Tela do Padeiro (KDS Industrial e Calculadora de Masseira):** Um painel estilo tablet/totem na área de produção que recalcula receitas na hora e dá baixa automática no estoque pelo lote que vence primeiro (FEFO).
4. **Gestão de Perdas e OP Reversa (Reaproveitamento Contábil):** Transforma sobras (como Pão Francês dormido) em novos produtos vendáveis (como Farinha de Rosca ou Torrada), transferindo o custo contábil sem distorcer o lucro.
5. **Entrada de Nota Fiscal Eletrônica (Importador XML NF-e com De/Para de Unidades):** Lê o XML da nota do fornecedor e converte automaticamente sacos e fardos para gramas, mililitros e unidades.
6. **CRM B2B/B2C, Inbox WhatsApp Realtime e Frente de Caixa (PDV Offline-First):** Atende clientes automaticamente com Inteligência Artificial no WhatsApp, controla limite de crédito de clientes corporativos (B2B) e opera o caixa rápido mesmo se a internet cair.

---

## 2. CONTROLE DE ACESSO POR PERFIL (RBAC) — QUEM VÊ O QUÊ?

No topo da barra lateral (no computador) ou no topo da tela (no celular Android/iOS), existe o seletor **"Perfil Ativo (RBAC)"**. Ele permite simular e controlar exatamente o que cada funcionário pode acessar:

- **ADMIN (Diretoria / Proprietário):** Acesso total a todas as 6 áreas, DRE, custos e configurações.
- **GERENTE (Gerência Operacional):** Acesso ao Painel Executivo, Entrada de NF-e, Fichas Técnicas, PCP, Perdas, CRM e PDV.
- **PADEIRO (Produção / Forno):** Vê apenas a **Tela do Padeiro (PCP)**, **Fichas Técnicas** e **Perdas/OP Reversa**. Não vê faturamento nem dados financeiros da empresa.
- **CAIXA (Operador de PDV):** Focado na **Frente de Caixa (`/pos`)** e registro de **Perdas de Balcão**.
- **ATENDENTE (Balcão & Encomendas WhatsApp):** Acessa o **CRM WhatsApp IA**, a **Frente de Caixa (PDV)**, o acompanhamento da **Tela do Padeiro** e **Perdas**.

---

## 3. PASSO A PASSO DE CADA TELA: COMO USAR NA PRÁTICA

### MÓDULO 1: ENTRADA DE NOTA FISCAL ELETRÔNICA (`/nfe` — Entrada de NF-e XML)
**Quando usar:** Sempre que chega mercadoria do fornecedor (ex.: caminhão do moinho trazendo sacaria de farinha, fermento e melhorador).

**O problema que resolve:**
O fornecedor vende na Nota Fiscal em **"Sacos de 50kg" (`SC`)** ou **"Caixas" (`CX`)**, mas o padeiro usa a receita em **gramas (`g`)** ou **mililitros (`ml`)**.

**Como usar passo a passo:**
1. Acesse o menu **"Entrada de NF-e (XML)"**.
2. Arraste o arquivo `.xml` da Nota Fiscal para a área pontilhada (ou clique no botão **"Carregar XML NF-e de Exemplo (Moinho 50kg)"** para testar).
3. O sistema lê instantaneamente os dados do fornecedor, CNPJ, chave de acesso e lista todos os produtos da nota.
4. Na tabela de **"De/Para de Unidades"**, confira a conversão automática:
   - Exemplo real: A nota traz **10 Sacos (`SC`) de Farinha de Trigo 50kg**. O sistema aplica o **Fator para Base = 50.000**, convertendo automaticamente para **+500.000 gramas (500 kg)** no estoque!
5. Informe a **Data de Validade do Lote (FEFO)** na última coluna para que o sistema saiba qual lote vence primeiro.
6. Clique no botão verde **"Confirmar Conversão e Dar Entrada"**.
7. **Resultado automático:** O estoque sobe em gramas, o lote é criado com validade rastreada e o **Custo Médio Ponderado (CMV)** de todas as receitas da padaria é atualizado na mesma hora.

---

### MÓDULO 2: ENGENHARIA DE CARDÁPIO E FICHA TÉCNICA (`/fichas-tecnicas`)
**Quando usar:** Para cadastrar ou ajustar receitas da padaria e descobrir exatamente quanto custa produzir cada pão, bolo ou salgado.

**O conceito-chave (Porcentagem de Padeiro / Baker's Percentage):**
Na panificação profissional, a **Farinha de Trigo é sempre 100%**. Todos os outros ingredientes são medidos em proporção à farinha:
- Exemplo da **Receita Base Pão Francês 50kg**:
  - **Farinha de Trigo Especial:** 50.000 g (**100%**)
  - **Água / Gelo Filtrado:** 27.500 ml (**55% de hidratação**)
  - **Sal Refinado:** 1.000 g (**2%**)
  - **Melhorador de Farinha:** 500 g (**1%**)
  - **Fermento Biológico Seco:** 250 g (**0,5%**)
  - **Óleo Vegetal:** 100 ml (**0,2%**)

**Como usar passo a passo:**
1. Acesse **"Engenharia de Cardápio"** no menu.
2. No topo, escolha uma receita existente (como Pão Francês 50kg ou Pão de Hambúrguer Brioche 25kg) ou clique em **"+ Nova Receita"**.
3. Nos 5 cartões superiores (KPIs), veja em tempo real:
   - **Farinha Base (100%)** e peso total da massa batida.
   - **Hidratação (%)** e percentual de perda de água no forno (quebra de assamento entre o peso cru de 65g e o peso assado de 50g).
   - **Custo Total da Batida:** Soma dos ingredientes mais o percentual de custos indiretos (gás, energia elétrica dos fornos e mão de obra).
   - **CMV Unitário Teórico:** Quanto custa exatamente 1 unidade de pão pronto.
   - **Margem de Contribuição (%):** Quanto sobra de lucro bruto em cada unidade vendida.
4. Para alterar quantidades ou adicionar ingredientes, edite a tabela à direita e clique em **"Salvar Ficha"**.

---

### MÓDULO 3: TELA DO PADEIRO — KDS E CALCULADORA DE MASSEIRA (`/pcp`)
**Quando usar:** Fica aberta o dia inteiro no tablet ou totem dentro da área de produção para o padeiro consultar gramaturas e dar andamento nas fornadas.

**Como usar a Calculadora de Masseira (Lado Esquerdo):**
1. O padeiro seleciona a receita (ex.: **Receita Base Pão Francês 50kg**, que rende 1.200 pães).
2. Mas imagine que agora à tarde ele não quer bater 50kg; ele quer bater apenas **15kg de farinha**.
3. Basta tocar no botão rápido **"15kg"** (ou digitar a quantidade).
4. **Mágica em tempo real:** O sistema calcula o **Fator de Escala = 0,3x** e mostra na hora a lista exata de pesagem para aquela batida de 15kg:
   - Farinha: **15 kg**
   - Água/Gelo: **8,25 L**
   - Sal: **300 g**
   - Melhorador: **150 g**
   - Fermento: **75 g**
   - Rendimento esperado: **360 pães**.
5. Se faltar algum ingrediente no estoque, um alerta vermelho **"Falta estoque"** aparece ao lado do insumo.
6. O padeiro toca no botão grande **"Gerar Ordem de Produção (OP)"**.

**Como usar o Quadro KDS de Fornadas (Lado Direito):**
1. Cada Ordem de Produção passa por 3 etapas com botões gigantes resistentes a toque de mão enfarinhada:
   - Toque em **"Iniciar Masseira"** → status muda para `EM_PRODUCAO`.
   - Toque em **"Entrar no Forno"** → status muda para `ASSANDO`.
   - Toque em **"Tirar Fornada"** → abre o painel verde de fechamento.
2. Ao tirar a fornada, o padeiro informa quantos pães bons saíram do forno (**Rendimento Real Bom**, ex.: 352 pães) e quantos queimaram ou amassaram (**Quebra/Avaria**, ex.: 8 pães) e toca em **"Confirmar Baixa"**.
3. **O que acontece no banco de dados em 1 segundo (Transação Atômica ACID):**
   - O sistema desconta automaticamente a farinha, o sal, o fermento e o melhorador do estoque (sempre tirando primeiro do lote que vence mais cedo — regra **FEFO**).
   - Soma os **352 pães** prontos no estoque de venda do PDV.
   - Registra tudo no razão contábil imutável (**Kardex**).

---

### MÓDULO 4: GESTÃO DE PERDAS E REAPROVEITAMENTO — OP REVERSA (`/perdas`)
**Quando usar:** No final do dia ou na manhã seguinte, quando sobrou pão dormido na vitrine ou quando houve uma fornada queimada.

**A grande sacada contábil (OP Reversa):**
Em vez de jogar o pão dormido fora como prejuízo puro e criar "Farinha de Rosca" do zero sem custo, a **OP Reversa** transfere o custo contábil do pão dormido para o subproduto!

**Como usar passo a passo:**
1. Acesse **"Perdas & OP Reversa"**.
2. Para testar o fluxo clássico, toque no botão **"Preset: 10kg Pão Dormido → 8,5kg Farinha de Rosca"**.
3. Escolha entre duas opções:
   - **Transformar (OP Reversa):** Dá baixa em **10.000g (10kg) de Pão Francês** e dá entrada em **8.500g (8,5kg) de Farinha de Rosca** (aproveitamento técnico de 85%, já descontando a perda de umidade na torra). O quadro **"Espelho Contábil"** mostra exatamente quantos reais de custo estão sendo transferidos para o novo lote de Farinha de Rosca.
   - **Descarte / Quebra:** Quando o produto realmente foi para o lixo (caiu no chão ou queimou). O valor vai direto para a linha de **Desvio/Perda da Cozinha no DRE**.
4. Clique no botão de confirmação e veja o registro aparecer na tabela de **Histórico de Reaproveitamento & Quebras** ao lado.

---

### MÓDULO 5: FRENTE DE CAIXA — PDV OFFLINE-FIRST & BALANÇA (`/pos`)
**Quando usar:** Operação contínua de balcão para venda rápida ao consumidor final ou faturamento para clientes corporativos B2B.

**Diferenciais de Missão Crítica:**
- **Tela Cheia de Alto Contraste:** Fundo escuro com letras amarelas e brancas gigantes para leitura instantânea e zero fadiga visual.
- **Funciona no Computador (com atalhos F2 a F12) e no Celular/Tablet (com abas Catálogo e Cupom).**
- **Contingência Offline (IndexedDB):** Se a internet da padaria cair no horário de pico das 07h da manhã, o caixa **não para**! O badge muda para **"OFFLINE"**, as vendas são gravadas na memória do navegador e, assim que a internet volta, sincronizam com o banco central.

**Como operar uma venda passo a passo:**
1. Acesse **"Frente de Caixa (PDV)"**.
2. **Para produtos pesados na hora (Balança Serial):**
   - Clique em **"Simular Peso"** (ou tecla `F4`) no topo para simular um peso no prato da balança (ou conecte a balança física via USB/Serial).
   - Toque no card do produto pesado (ex.: **Pão Francês** ou **Queijo Prato Fatiado**). O sistema multiplica o peso da balança pelo preço do quilo automaticamente.
3. **Para etiquetas de balança com código de barras (EAN-13 Prefixo 2):**
   - Clique em **"Simular Etiqueta Pão 380g"** (ou tecla `F6`) e depois em **"Lançar"** (`Enter`).
   - O sistema decodifica o código `2010100038009` (prefixo `2` + código PLU `0101` do Pão Francês + `00380` gramas) e lança 0,380 kg no cupom!
4. **Para fechar e receber o pagamento:**
   - No celular, toque na barra inferior amarela **"Ver Cupom"** para ir à tela de pagamento.
   - Escolha a forma de pagamento com 1 toque ou tecla de atalho:
     - **PIX (`F7`)**
     - **DÉBITO (`F8`)**
     - **CRÉDITO (`F9`)**
     - **DINHEIRO (`F10`)**
     - **FATURADO B2B (`F11`):** Exclusivo para clientes empresariais cadastrados (ex.: Hamburgueria Artesanal Burger Lab). O sistema verifica na hora se o cliente tem **Limite de Crédito disponível** antes de aprovar a venda faturada!

---

### MÓDULO 6: CRM B2B/B2C, INBOX WHATSAPP REALTIME & GATEWAY DE IA (`/crm`)
**Quando usar:** Para acompanhar os atendimentos automáticos feitos pela Inteligência Artificial no WhatsApp da padaria, assumir conversas quando necessário e gerenciar as contas corporativas (B2B).

**Como funciona na prática:**
1. **Janela Estilo WhatsApp Web (Topo):**
   - Mostra todas as conversas de clientes em tempo real.
   - Quando a conversa está com o selo verde **"IA ATIVA"**, o Agente de Inteligência Artificial está respondendo o cliente sozinho, tirando dúvidas de preço e anotando encomendas.
   - **Botão de Transbordo Humano:** Se o cliente tiver um pedido especial (como um bolo personalizado) ou uma reclamação, o atendente clica no botão amarelo **"Assumir Atendimento (Transbordo Humano)"**. Na mesma hora, a IA é pausada naquela conversa e o campo de texto é liberado para o atendente humano responder. Quando terminar, basta clicar em **"Devolver Conversa ao Agente de IA"**.
2. **Simulador de Webhooks de IA (Parte Inferior Esquerda):**
   - Demonstra como o **n8n / Evolution API** conversa com o ERP:
   - Clique no **Botão 1 (`Testar GET /api/ai/customer-context`)**: A IA consulta pelo número de WhatsApp quem é o cliente, qual é o limite de crédito B2B dele e quais foram os últimos pedidos.
   - Clique no **Botão 2 (`Simular POST /api/ai/create-order — 150 Pães 07h`)**: Simula a IA fechando uma encomenda de **150 pães de hambúrguer para amanhã às 07h da manhã**.
   - **Integração imediata:** Assim que esse botão é clicado, o pedido é gravado no banco de dados e **um alerta sonoro/visual pisca imediatamente lá na Tela do Padeiro (`/pcp`)** avisando a produção sobre a nova encomenda!
3. **Carteira Corporativa B2B (Parte Inferior Direita):**
   - Tabela com todas as empresas clientes (Razão Social, CNPJ, Limite de Crédito Total, Valor em Aberto, Saldo Disponível e Dia de Fechamento da Fatura).

---

### MÓDULO 7: PAINEL EXECUTIVO — DRE GERENCIAL E CURVA ABC (`/dashboard`)
**Quando usar:** Tela principal do proprietário e do gerente para tomada de decisão diária e fechamento mensal.

**O que analisar nesta tela:**
1. **Os 4 Cartões de Topo (Indicadores-Chave):**
   - **Faturamento Bruto Acumulado:** Soma de todas as vendas do balcão, B2B e WhatsApp IA.
   - **CMV Teórico (Fichas Técnicas):** Quanto você *deveria* ter gasto de matéria-prima se cada pão tivesse saído exatamente com a gramatura da receita.
   - **CMV Real vs. Desvio de Cozinha (Cartão de Alerta Amarelo):** Cruzamento do estoque real consumido com as fichas técnicas. Ele revela em Reais (`R$`) quanto dinheiro foi perdido com **sobrepeso na divisão da massa, quebras de forno ou desperdícios**.
   - **Resultado Operacional (EBITDA):** Quanto sobrou de lucro operacional líquido no bolso da padaria e qual é a margem percentual líquida.
2. **Tabela da Curva ABC de Lucro Líquido (Regra de Pareto 80/15/5):**
   - Ordena os produtos não apenas pelo que vende mais em quantidade, mas pelo que coloca **mais dinheiro líquido no caixa**:
   - **Classe A (Verde):** Os produtos estrelas que geram **80% do lucro** da padaria (nunca podem faltar no balcão).
   - **Classe B:** Produtos intermediários (15% do lucro).
   - **Classe C:** Produtos de conveniência ou baixa margem (5% do lucro).
3. **Demonstrativo DRE Vertical e Alertas de Validade FEFO (Coluna Direita):**
   - Mostra o DRE linha a linha (Receita Bruta → Impostos Simples Nacional → Receita Líquida → CMV Teórico → Desvio de Cozinha → Lucro Bruto Real → Despesas Fixas → EBITDA).
   - Logo abaixo, o quadro **"Alertas de Validade FEFO (≤ 15 dias)"** avisa quais lotes de matéria-prima estão próximos de vencer para que a gerência promova receitas que consumam esses insumos antes de qualquer perda.

---

## 4. ROTEIRO SUGERIDO PARA O VÍDEO EXPLICATIVO (ESTRUTURA EM 6 CENAS)

1. **Cena 1 — Abertura (O Fim do "Achismo" na Padaria):** Apresente o Flor do Trigo como o sistema que une Chão de Fábrica (Masseira/Forno), Frente de Caixa Offline, Financeiro DRE e Atendimento com Inteligência Artificial no WhatsApp.
2. **Cena 2 — Da Chegada do Caminhão à Receita (`NF-e` + `Fichas Técnicas`):** Mostre como a compra de sacos de 50kg de farinha entra via XML convertida em gramas e alimenta automaticamente o cálculo da Porcentagem de Padeiro (100% farinha, 55% água/gelo).
3. **Cena 3 — Na Cozinha com o Padeiro (`Tela do Padeiro KDS` + `OP Reversa`):** Destaque a Calculadora de Masseira (transformando uma receita de 50kg em uma batida de 15kg com 1 toque), a baixa automática por validade (FEFO) e a transformação contábil de 10kg de pão dormido em 8,5kg de farinha de rosca.
4. **Cena 4 — No Balcão sem Medo de Cair a Internet (`PDV /pos`):** Mostre o caixa de alto contraste lendo o peso da balança e o código de barras EAN-13 (prefixo 2), funcionando tanto no computador quanto no celular Android/iOS, mesmo sem internet.
5. **Cena 5 — Vendas no Piloto Automático (`CRM WhatsApp IA` & `B2B`):** Explique como o Agente de IA recebe uma encomenda de 150 pães de hambúrguer pelo WhatsApp, checa o limite de crédito da hamburgueria e já avisa o padeiro lá na cozinha, além do botão de Transbordo Humano com 1 clique.
6. **Cena 6 — O Painel do Dono (`DRE` & `Curva ABC`):** Feche mostrando como todas as operações do dia deságuam no DRE Gerencial, revelando o Desvio de Cozinha (CMV Teórico vs. Real) e os produtos Classe A que geram 80% do lucro.

