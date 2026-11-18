// Gambyte — partes comuns das funções do Stripe (assinatura do Pro por cartão).
//
// Segredos (configurados pelo dono do site no Supabase, nunca no código):
//   STRIPE_SECRET_KEY          chave secreta (sk_test_... no teste, sk_live_... no ar)
//   STRIPE_PRICE_ID            preço mensal do Pro (price_...)
//   STRIPE_WEBHOOK_SECRET      segredo do webhook (whsec_...)
import Stripe from "npm:stripe@22";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

export const SITE = "https://gambyte.com.br";
export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
export function preflight(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  if (origin && origin !== SITE) return json({ error: "Origem não permitida." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  return null;
}

// Usuário logado a partir do token enviado pelo site.
export async function usuario(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data } = await c.auth.getUser();
  return data?.user ?? null;
}

// Fim do período pago de uma assinatura (o campo mudou de lugar nas versões
// novas da API do Stripe: agora fica em cada item da assinatura).
function fimDoPeriodo(sub: Stripe.Subscription): number | null {
  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  const item = s.items?.data?.[0];
  return (item?.current_period_end ?? s.current_period_end ?? null) as number | null;
}

const ATIVAS = ["active", "trialing", "past_due"];

// Lê no Stripe as assinaturas do cliente e grava no perfil o estado atual.
// Pode ser chamada quantas vezes for: o resultado é sempre o mesmo.
export async function sincronizar(customerId: string) {
  const { data: perfil } = await admin.from("profiles")
    .select("id, premium, proximo_vencimento, stripe_subscription_id")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!perfil) {
    console.warn("[stripe] cliente sem perfil:", customerId);
    return;
  }
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const ordenadas = subs.data.sort((a, b) => b.created - a.created);
  const ativa = ordenadas.find((s) => ATIVAS.includes(s.status));
  const sub = ativa ?? ordenadas[0];
  if (!sub) return;

  const agora = Date.now();
  const fim = fimDoPeriodo(sub);
  const fimIso = fim ? new Date(fim * 1000).toISOString() : null;
  const atual = perfil.proximo_vencimento ? new Date(perfil.proximo_vencimento).getTime() : 0;
  const mudanca: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_status: sub.status,
    cancelado_em: sub.cancel_at_period_end || sub.status === "canceled"
      ? new Date(((sub.canceled_at ?? Math.floor(agora / 1000)) as number) * 1000).toISOString()
      : null,
  };
  if (ativa && fim && fim * 1000 > agora) {
    // Se a pessoa já tinha acesso pago por Pix até mais tarde, mantém a data maior.
    mudanca.premium = true;
    mudanca.proximo_vencimento = fim * 1000 > atual ? fimIso : perfil.proximo_vencimento;
    if (!perfil.premium) mudanca.premium_ativado_em = new Date(agora).toISOString();
  } else if (atual <= agora + 60_000) {
    // Sem assinatura ativa e sem outro período pago em aberto: volta ao grátis.
    mudanca.premium = false;
  }
  const { error } = await admin.from("profiles").update(mudanca).eq("id", perfil.id);
  if (error) throw error;
}
