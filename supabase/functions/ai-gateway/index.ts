// Supabase Edge Function: GET /api/ai/customer-context?phone=5511987650001
// e POST /api/ai/create-order para integração com n8n / Evolution API.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = Deno.env.get('AI_WEBHOOK_SECRET');
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized webhook' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const url = new URL(req.url);

  // 1. GET /api/ai/customer-context?phone=...
  if (req.method === 'GET' && url.pathname.endsWith('/customer-context')) {
    const phone = (url.searchParams.get('phone') ?? '').replace(/\D/g, '');
    const { data: customer } = await supabase
      .from('crm_customers')
      .select('*')
      .eq('whatsapp_phone', phone)
      .maybeSingle();

    const { data: recentOrders } = customer
      ? await supabase
          .from('orders_and_pos_sales')
          .select('id, order_number, total, payment_method, status, created_at')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(5)
      : { data: [] };

    return new Response(
      JSON.stringify({
        found: Boolean(customer),
        phone,
        customer: customer
          ? {
              ...customer,
              available_credit: Number((customer.credit_limit - customer.current_balance_due).toFixed(2)),
            }
          : null,
        recent_orders: recentOrders ?? [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 2. POST /api/ai/create-order
  if (req.method === 'POST' && url.pathname.endsWith('/create-order')) {
    const body = await req.json();
    const phone = String(body.whatsapp_phone ?? '').replace(/\D/g, '');

    const { data: customer } = await supabase
      .from('crm_customers')
      .select('*')
      .eq('whatsapp_phone', phone)
      .maybeSingle();

    const { data: order, error: orderErr } = await supabase
      .from('orders_and_pos_sales')
      .insert({
        origin: 'WHATSAPP_IA',
        customer_id: customer?.id ?? null,
        status: 'PENDENTE_PRODUCAO',
        subtotal: body.total,
        discount: 0,
        total: body.total,
        payment_method: body.payment_method ?? 'PIX',
        delivery_date: body.delivery_date,
        notes: body.notes ?? 'Encomenda estruturada pelo Agente de IA',
      })
      .select()
      .single();

    if (orderErr) {
      return new Response(JSON.stringify({ error: orderErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('production_alerts').insert({
      alert_type: 'NOVA_ENCOMENDA',
      title: `Nova Encomenda IA — Pedido #${order.order_number}`,
      message: `${customer?.name ?? phone}: entrega ${body.delivery_date}`,
      sales_order_id: order.id,
      payload: body,
    });

    return new Response(JSON.stringify({ ok: true, order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Route not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

