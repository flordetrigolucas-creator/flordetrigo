import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  Bot,
  UserCheck,
  Send,
  Building2,
  Webhook,
  Play,
  Phone,
  Sparkles,
} from 'lucide-react';
import { localDb } from '@/lib/offlineDb';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import {
  getAiCustomerContextByPhone,
  postAiCreateOrder,
} from '@/features/crm/aiGatewayService';
import { formatBRL } from '@/lib/decimal';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import type { CrmMessageRow } from '@/types/database.types';

export function CrmInboxPage() {
  const profile = useAuthStore((s) => s.profile);
  const conversations = useLiveQuery(
    () => localDb.conversations.orderBy('last_message_at').reverse().toArray(),
    [],
    [],
  );
  const customers = useLiveQuery(() => localDb.customers.toArray(), [], []);

  const [activeConvId, setActiveConvId] = useState<string>('70000000-0000-4000-a000-000000000001');
  const [messageInput, setMessageInput] = useState<string>('');
  const [webhookOutputJson, setWebhookOutputJson] = useState<string>('');

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) ?? conversations[0],
    [conversations, activeConvId],
  );

  const messages = useLiveQuery<CrmMessageRow[], CrmMessageRow[]>(
    async () =>
      activeConv
        ? localDb.messages.where('conversation_id').equals(activeConv.id).sortBy('created_at')
        : [],
    [activeConv?.id],
    [],
  );

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === activeConv?.customer_id),
    [customers, activeConv?.customer_id],
  );

  // Botão "Assumir Atendimento (Transbordo Humano)" / "Reativar Agente IA"
  const handleToggleHumanTakeover = async () => {
    if (!activeConv) return;
    const now = new Date().toISOString();

    if (activeConv.status === 'IA_ATIVA') {
      const uid = profile?.id ?? null;
      await supabase
        .from('crm_conversations')
        .update({ status: 'HUMANO', assigned_to: uid, ai_paused_at: now })
        .eq('id', activeConv.id);

      await localDb.conversations.update(activeConv.id, {
        status: 'HUMANO',
        assigned_to: uid,
        ai_paused_at: now,
        updated_at: now,
      });
      await localDb.messages.put({
        id: crypto.randomUUID(),
        conversation_id: activeConv.id,
        sender: 'SISTEMA',
        sender_user_id: null,
        content: `Transbordo Humano ativado por ${profile?.full_name}. O Agente de IA foi pausado nesta conversa.`,
        media_url: null,
        external_id: null,
        metadata: {},
        created_at: now,
      });
      toast.warning('Transbordo Humano ativado: Agente de IA pausado nesta conversa.');
    } else {
      await supabase
        .from('crm_conversations')
        .update({ status: 'IA_ATIVA', assigned_to: null, ai_paused_at: null })
        .eq('id', activeConv.id);

      await localDb.conversations.update(activeConv.id, {
        status: 'IA_ATIVA',
        assigned_to: null,
        ai_paused_at: null,
        updated_at: now,
      });
      toast.success('Agente de IA reativado para responder automaticamente.');
    }
  };

  const handleSendHumanMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !messageInput.trim()) return;

    if (activeConv.status !== 'HUMANO') {
      toast.error('Clique em "Assumir Atendimento (Transbordo Humano)" antes de enviar mensagens manuais.');
      return;
    }

    const now = new Date().toISOString();
    const text = messageInput.trim();

    const { error } = await supabase.from('crm_messages').insert({
      conversation_id: activeConv.id,
      sender: 'HUMANO',
      sender_user_id: profile?.id ?? null,
      content: text,
    });

    if (!error) {
      await pullSupabaseToLocalCache();
    } else {
      await localDb.messages.put({
        id: crypto.randomUUID(),
        conversation_id: activeConv.id,
        sender: 'HUMANO',
        sender_user_id: profile?.id ?? null,
        content: text,
        media_url: null,
        external_id: null,
        metadata: {},
        created_at: now,
      });
      await localDb.conversations.update(activeConv.id, {
        last_message_at: now,
        last_message_preview: text,
        unread_count: 0,
        updated_at: now,
      });
    }
    setMessageInput('');
  };

  // Testa Endpoint 1: GET /api/ai/customer-context
  const handleTestContextWebhook = async () => {
    const phone = activeConv?.whatsapp_phone ?? '5511987650001';
    const res = await getAiCustomerContextByPhone(phone);
    setWebhookOutputJson(JSON.stringify(res, null, 2));
    toast.success(`GET /api/ai/customer-context?phone=${phone} executado!`);
  };

  // Testa Endpoint 2: POST /api/ai/create-order (150 pães de hambúrguer para amanhã às 07h)
  const handleSimulateAiOrderWebhook = async () => {
    try {
      const tomorrow7am = new Date();
      tomorrow7am.setDate(tomorrow7am.getDate() + 1);
      tomorrow7am.setHours(7, 0, 0, 0);

      const res = await postAiCreateOrder({
        whatsapp_phone: '5511987650001',
        delivery_date: tomorrow7am.toISOString(),
        payment_method: 'FATURADO_B2B',
        notes: '150 pães de hambúrguer para amanhã às 07h (via LLM Webhook)',
        items: [{ sku: 'PA-PAO-HAMBURGUER', quantity: 150 }],
      });

      setWebhookOutputJson(JSON.stringify(res, null, 2));
      toast.success(
        'POST /api/ai/create-order executado! Alerta injetado em tempo real na Tela do Padeiro (PCP).',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro no webhook IA');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            CRM B2B/B2C, Inbox WhatsApp Realtime & Gateway de IA (n8n / Evolution API)
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitore o Agente de IA ao vivo, faça transbordo humano com 1 clique e audite os limites de crédito corporativos B2B.
          </p>
        </div>
      </div>

      {/* Inbox Estilo WhatsApp Web */}
      <div className="grid h-[560px] grid-cols-12 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {/* Lista de Conversas */}
        <div className="col-span-4 flex flex-col border-r">
          <div className="border-b bg-muted/40 px-4 py-3">
            <p className="text-sm font-bold">Conversas Ativas (Evolution API)</p>
            <p className="text-xs text-muted-foreground">Sincronizado via Supabase Realtime</p>
          </div>
          <div className="flex-1 divide-y overflow-y-auto">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => setActiveConvId(conv.id)}
                className={`w-full px-4 py-3.5 text-left transition hover:bg-muted/60 ${
                  activeConv?.id === conv.id ? 'bg-amber-500/10' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{conv.contact_name ?? conv.whatsapp_phone}</span>
                  <Badge variant={conv.status === 'IA_ATIVA' ? 'success' : 'warning'} className="text-[10px]">
                    {conv.status === 'IA_ATIVA' ? 'IA ATIVA' : 'HUMANO'}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{conv.last_message_preview}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Janela de Mensagens + Transbordo Humano */}
        <div className="col-span-8 flex flex-col justify-between bg-stone-50">
          {activeConv && (
            <>
              <div className="flex items-center justify-between border-b bg-card px-5 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{activeConv.contact_name}</span>
                    {activeCustomer && (
                      <Badge variant="outline">{activeCustomer.customer_type}</Badge>
                    )}
                  </div>
                  <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> +{activeConv.whatsapp_phone}
                    {activeCustomer?.customer_type === 'B2B' && (
                      <span className="text-emerald-700 font-semibold">
                        • Crédito Disp: {formatBRL(activeCustomer.credit_limit - activeCustomer.current_balance_due)}
                      </span>
                    )}
                  </p>
                </div>

                <Button
                  variant={activeConv.status === 'IA_ATIVA' ? 'warning' : 'default'}
                  onClick={handleToggleHumanTakeover}
                >
                  {activeConv.status === 'IA_ATIVA' ? (
                    <>
                      <UserCheck className="h-4 w-4" /> Assumir Atendimento (Transbordo Humano)
                    </>
                  ) : (
                    <>
                      <Bot className="h-4 w-4" /> Devolver Conversa ao Agente de IA
                    </>
                  )}
                </Button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.sender === 'CLIENTE'
                        ? 'justify-start'
                        : msg.sender === 'SISTEMA'
                          ? 'justify-center'
                          : 'justify-end'
                    }`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        msg.sender === 'CLIENTE'
                          ? 'bg-white text-stone-900'
                          : msg.sender === 'IA'
                            ? 'bg-emerald-700 text-white'
                            : msg.sender === 'SISTEMA'
                              ? 'bg-amber-200/80 text-xs font-semibold text-amber-950'
                              : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-4 text-[10px] font-bold uppercase opacity-75">
                        <span>{msg.sender}</span>
                        <span>{new Date(msg.created_at).toLocaleTimeString('pt-BR')}</span>
                      </div>
                      <p>{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendHumanMessage} className="flex gap-2 border-t bg-card p-3">
                <Input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  disabled={activeConv.status !== 'HUMANO'}
                  placeholder={
                    activeConv.status === 'HUMANO'
                      ? 'Digite a resposta como atendente humano...'
                      : 'Agente de IA está ativo. Clique em "Assumir Atendimento" acima para digitar.'
                  }
                  className="h-11"
                />
                <Button type="submit" size="lg" disabled={activeConv.status !== 'HUMANO'}>
                  <Send className="h-4 w-4" /> Enviar
                </Button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Console de Orquestração IA + Contas B2B */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary" /> Endpoints para Orquestração de IA (n8n / Evolution API)
            </CardTitle>
            <CardDescription>
              Teste ao vivo os dois webhooks estruturados consumidos pelo Agente de IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleTestContextWebhook}>
                <Play className="h-4 w-4 text-emerald-600" /> 1. Testar GET /api/ai/customer-context
              </Button>
              <Button variant="default" onClick={handleSimulateAiOrderWebhook}>
                <Sparkles className="h-4 w-4" /> 2. Simular POST /api/ai/create-order (150 Pães Hambúrguer 07h)
              </Button>
            </div>

            <pre className="max-h-64 overflow-auto rounded-xl bg-stone-950 p-4 font-mono text-xs text-emerald-400">
              {webhookOutputJson ||
                `// Clique em um dos botões acima para inspecionar o payload real\n// 1. GET  /api/ai/customer-context?phone=5511987650001\n// 2. POST /api/ai/create-order -> cria pedido B2B e dispara alerta no KDS do Padeiro`}
            </pre>
          </CardContent>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Carteira Corporativa B2B (`b2b_accounts`)
            </CardTitle>
            <CardDescription>
              Controle de limite de crédito, saldo devedor, dia de faturamento e pedidos recorrentes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Razão Social / CNPJ</TableHead>
                  <TableHead className="text-right">Limite</TableHead>
                  <TableHead className="text-right">Em Aberto</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-center">Dia Fat.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers
                  .filter((c) => c.customer_type === 'B2B')
                  .map((c) => {
                    const available = c.credit_limit - c.current_balance_due;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-semibold">{c.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{c.document}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatBRL(c.credit_limit)}</TableCell>
                        <TableCell className="text-right font-mono text-amber-700">
                          {formatBRL(c.current_balance_due)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-emerald-700">
                          {formatBRL(available)}
                        </TableCell>
                        <TableCell className="text-center font-mono">Dia {c.billing_cycle_day}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

