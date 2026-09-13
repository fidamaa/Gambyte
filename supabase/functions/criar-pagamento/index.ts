// Gambyte — Edge Function: cria a preferência de pagamento no Mercado
// Pago pro usuário logado. Chamada pelo frontend quando clica "Assinar".
//
// Segredos necessários (configurar com `supabase secrets set`):
//   MP_ACCESS_TOKEN  — Access Token do Mercado Pago (painel de Developers)
//   SITE_URL         — ex.: https://gambyte.com.br (opcional, tem fallback)
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY já vêm
// disponíveis automaticamente em toda Edge Function — não precisa setar.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://gambyte.com.br";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLAN = {
  id: "gambyte-premium-mensal",
  title: "Gambyte Premium — Mensal",
  description: "Acesso completo à Análise Profunda e aos Insights de partida",
  price: 9.90, // BRL
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!MP_ACCESS_TOKEN) {
      return json({ error: "Servidor sem MP_ACCESS_TOKEN configurado." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Você precisa estar logado para assinar." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user || !user.email) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: profile } = await admin
      .from("profiles").select("premium").eq("id", user.id).single();
    if (profile?.premium) {
      return json({ error: "Você já possui uma assinatura Premium ativa." }, 409);
    }

    // notification_url aponta pra ESTA mesma instância Supabase — o
    // Mercado Pago chama a Edge Function webhook-mp diretamente, sem
    // depender de onde o site estático está hospedado.
    const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook-mp`;

    const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{
          id: PLAN.id,
          title: PLAN.title,
          description: PLAN.description,
          quantity: 1,
          currency_id: "BRL",
          unit_price: PLAN.price,
        }],
        payer: { email: user.email },
        back_urls: {
          success: `${SITE_URL}/gambyte-premium.html?status=success`,
          failure: `${SITE_URL}/gambyte-premium.html?status=failure`,
          pending: `${SITE_URL}/gambyte-premium.html?status=pending`,
        },
        auto_return: "approved",
        notification_url: webhookUrl,
        statement_descriptor: "GAMBYTE",
        // external_reference é o que o Mercado Pago devolve no webhook —
        // é assim que sabemos QUAL usuário pagou, sem confiar em nada
        // que o navegador do cliente mande de volta.
        external_reference: user.id,
        payment_methods: { installments: 1 },
        metadata: { supabase_uid: user.id, user_email: user.email },
      }),
    });

    if (!prefRes.ok) {
      const errBody = await prefRes.text();
      console.error("[criar-pagamento] Mercado Pago respondeu com erro:", prefRes.status, errBody);
      return json({ error: "Erro ao criar pagamento." }, 502);
    }

    const pref = await prefRes.json();

    await admin.from("pagamentos").insert({
      id: pref.id,
      uid: user.id,
      email: user.email,
      status: "pendente",
      valor: PLAN.price,
    });

    return json({
      preference_id: pref.id,
      init_point: pref.init_point,               // produção
      sandbox_init_point: pref.sandbox_init_point, // testes (credenciais de teste)
    });
  } catch (err) {
    console.error("[criar-pagamento] Erro:", err);
    return json({ error: "Erro interno ao criar pagamento." }, 500);
  }
});
