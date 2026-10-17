/**
 * Gateway de Orquestração para o Agente de IA (n8n / Evolution API).
 *
 * Contratos HTTP/Webhook expostos:
 *   1. GET  /api/ai/customer-context?phone=5511987650001
 *   2. POST /api/ai/create-order
 */
import { z } from 'zod';
import { localDb } from '@/lib/offlineDb';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';
import { Decimal, SCALE, toDb } from '@/lib/decimal';

export interface AiCustomerContextResponse {
  found: boolean;
  phone: string;
  customer: {
    id: string;
    name: string;
    document: string | null;
    customer_type: 'B2C' | 'B2B';
    credit_limit: number;
    current_balance_due: number;
    available_credit: number;
    billing_cycle_day: number | null;
    recurring_order_json: unknown[];
  } | null;
  conversation_status: 'IA_ATIVA' | 'HUMANO' | 'ENCERRADA';
  recent_orders: Array<{
    order_id: string;
    created_at: string;
    total: number;
    payment_method: string;
  }>;
}

export const aiCreateOrderSchema = z.object({
  whatsapp_phone: z.string().regex(/^\d{12,13}$/, 'Telefone E.164 sem + (ex: 5511987650001)'),
  delivery_date: z.string().min(10, 'Informe a data/hora de entrega ISO-8601'),
  payment_method: z.enum(['PIX', 'CREDITO', 'DEBITO', 'DINHEIRO', 'FATURADO_B2B']),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export type AiCreateOrderPayload = z.infer<typeof aiCreateOrderSchema>;

export interface AiCreateOrderResponse {
  order_id: string;
  customer_name: string;
  total: number;
  delivery_date: string;
  pcp_alert_id: string;
  pcp_alert_message: string;
}

/**
 * Endpoint 1: `GET /api/ai/customer-context?phone=...`
 */
export async function getAiCustomerContextByPhone(rawPhone: string): Promise<AiCustomerContextResponse> {
  const phone = rawPhone.replace(/\D/g, '');
  const customer = await localDb.customers.where('whatsapp_phone').equals(phone).first();
  const conv = await localDb.conversations.where('whatsapp_phone').equals(phone).first();
  const sales = customer
    ? await localDb.pendingSales.filter((s) => s.customer_id === customer.id).toArray()
    : [];

  if (!customer) {
    return {
      found: false,
      phone,
      customer: null,
      conversation_status: conv?.status ?? 'IA_ATIVA',
      recent_orders: [],
    };
  }

  const availableCredit = new Decimal(customer.credit_limit)
    .minus(customer.current_balance_due)
    .toDecimalPlaces(SCALE.money)
    .toNumber();

  return {
    found: true,
    phone,
    customer: {
      id: customer.id,
      name: customer.name,
      document: customer.document,
      customer_type: customer.customer_type,
      credit_limit: customer.credit_limit,
      current_balance_due: customer.current_balance_due,
      available_credit: availableCredit,
      billing_cycle_day: customer.billing_cycle_day,
      recurring_order_json: customer.recurring_order_json,
    },
    conversation_status: conv?.status ?? 'IA_ATIVA',
    recent_orders: sales.slice(0, 5).map((s) => ({
      order_id: s.offline_client_id,
      created_at: s.created_at,
      total: s.total,
      payment_method: s.payment_method,
    })),
  };
}

/**
 * Endpoint 2: `POST /api/ai/create-order`
 * Valida limite B2B, cria o pedido e injeta um alerta em tempo real na Tela do Padeiro (PCP).
 */
export async function postAiCreateOrder(rawPayload: unknown): Promise<AiCreateOrderResponse> {
  const payload = aiCreateOrderSchema.parse(rawPayload);

  // 1. Tenta gravar diretamente no Supabase via RPC record_pos_or_ai_sale
  const customerRemote = await supabase
    .from('crm_customers')
    .select('*')
    .eq('whatsapp_phone', payload.whatsapp_phone)
    .maybeSingle();

  const skus = payload.items.map((i) => i.sku);
  const itemsRemote = await supabase.from('items').select('*').in('sku', skus);

  if (itemsRemote.data && itemsRemote.data.length === payload.items.length) {
    const rpcItems = payload.items.map((req) => {
      const found = itemsRemote.data.find((it) => it.sku === req.sku)!;
      return {
        item_id: found.id,
        quantity: req.quantity,
        unit_price: found.sale_price ?? 0,
      };
    });

    const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_pos_or_ai_sale', {
      p_origin: 'WHATSAPP_IA',
      p_payment_method: payload.payment_method,
      p_items: rpcItems,
      p_discount: 0,
      p_customer_id: customerRemote.data?.id ?? null,
      p_delivery_date: payload.delivery_date,
      p_notes: payload.notes ?? 'Encomenda via Agente IA WhatsApp',
    });

    if (!rpcErr && rpcRes) {
      await pullSupabaseToLocalCache();
      return {
        order_id: rpcRes.order_id,
        customer_name: customerRemote.data?.name ?? payload.whatsapp_phone,
        total: rpcRes.total,
        delivery_date: payload.delivery_date,
        pcp_alert_id: rpcRes.order_id,
        pcp_alert_message: `Pedido #${rpcRes.order_number} registrado no Supabase e alerta disparado para o PCP!`,
      };
    }
  }

  return localDb.transaction(
    'rw',
    [localDb.customers, localDb.items, localDb.pendingSales, localDb.productionAlerts, localDb.conversations, localDb.messages],
    async () => {
      const customer = await localDb.customers
        .where('whatsapp_phone')
        .equals(payload.whatsapp_phone)
        .first();

      let totalOrder = new Decimal(0);
      const resolvedLines: Array<{
        item_id: string;
        sku: string;
        name: string;
        is_weighed: boolean;
        quantity: number;
        unit_price: number;
        total_price: number;
      }> = [];

      for (const reqLine of payload.items) {
        const item = await localDb.items.where('sku').equals(reqLine.sku).first();
        if (!item) {
          throw new Error(`SKU "${reqLine.sku}" não encontrado no catálogo.`);
        }
        const unitPrice = item.sale_price ?? 0;
        const lineValue = item.is_weighed
          ? new Decimal(reqLine.quantity).dividedBy(1000).times(unitPrice)
          : new Decimal(reqLine.quantity).times(unitPrice);

        totalOrder = totalOrder.plus(lineValue);
        resolvedLines.push({
          item_id: item.id,
          sku: item.sku,
          name: item.name,
          is_weighed: item.is_weighed,
          quantity: reqLine.quantity,
          unit_price: unitPrice,
          total_price: toDb(lineValue, SCALE.money),
        });
      }

      const finalTotal = toDb(totalOrder, SCALE.money);

      if (payload.payment_method === 'FATURADO_B2B') {
        if (!customer || customer.customer_type !== 'B2B') {
          throw new Error('Pagamento FATURADO_B2B exige cliente corporativo B2B cadastrado.');
        }
        const available = new Decimal(customer.credit_limit).minus(customer.current_balance_due);
        if (available.lt(finalTotal)) {
          throw new Error(
            `Limite de crédito B2B insuficiente (${customer.name}). Disponível: R$ ${available.toFixed(2)}, Pedido: R$ ${finalTotal.toFixed(2)}`,
          );
        }
        await localDb.customers.update(customer.id, {
          current_balance_due: toDb(new Decimal(customer.current_balance_due).plus(finalTotal), SCALE.money),
        });
      }

      const orderId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      await localDb.pendingSales.put({
        offline_client_id: orderId,
        origin: 'WHATSAPP_IA',
        customer_id: customer?.id ?? null,
        cashier_id: 'aaaaaaaa-0000-4000-a000-000000000001',
        subtotal: finalTotal,
        discount: 0,
        total: finalTotal,
        payment_method: payload.payment_method,
        fiscal_status: 'PENDENTE',
        items: resolvedLines,
        created_at: nowIso,
        synced: 0,
      });

      const summaryText = resolvedLines
        .map((l) => `${l.quantity} ${l.is_weighed ? 'g' : 'un'} ${l.name}`)
        .join(', ');

      const alertId = crypto.randomUUID();
      const alertTitle = `Nova Encomenda IA WhatsApp — Entrega ${new Date(payload.delivery_date).toLocaleString('pt-BR')}`;
      const alertMsg = `${customer?.name ?? payload.whatsapp_phone}: ${summaryText}`;

      await localDb.productionAlerts.put({
        id: alertId,
        alert_type: 'NOVA_ENCOMENDA',
        title: alertTitle,
        message: alertMsg,
        sales_order_id: orderId,
        payload: {
          order_id: orderId,
          customer: customer?.name ?? payload.whatsapp_phone,
          items: resolvedLines,
        },
        acknowledged_at: null,
        acknowledged_by: null,
        created_at: nowIso,
      });

      // Registra mensagem automática do Agente de IA na conversa
      const conv = await localDb.conversations
        .where('whatsapp_phone')
        .equals(payload.whatsapp_phone)
        .first();

      if (conv) {
        const aiConfirmation = `Pedido confirmado no ERP (#${orderId.slice(0, 6).toUpperCase()})! Itens: ${summaryText} • Total: R$ ${finalTotal.toFixed(2)} • Alerta enviado para a tela do padeiro.`;
        await localDb.messages.put({
          id: crypto.randomUUID(),
          conversation_id: conv.id,
          sender: 'IA',
          sender_user_id: null,
          content: aiConfirmation,
          media_url: null,
          external_id: `AI-ORD-${orderId.slice(0, 8)}`,
          metadata: { order_id: orderId },
          created_at: nowIso,
        });
        await localDb.conversations.update(conv.id, {
          last_message_at: nowIso,
          last_message_preview: aiConfirmation,
        });
      }

      return {
        order_id: orderId,
        customer_name: customer?.name ?? payload.whatsapp_phone,
        total: finalTotal,
        delivery_date: payload.delivery_date,
        pcp_alert_id: alertId,
        pcp_alert_message: alertMsg,
      };
    },
  );
}

