// Gambyte — Edge Function: webhook do Mercado Pago.
//
// Único lugar que efetivamente liga "premium: true". Precisa ter certeza
// de que quem está chamando é MESMO o Mercado Pago (assinatura HMAC
// verificada), senão qualquer um poderia forjar essa chamada e ganhar
// Premium de graça.
//
// Segredos necessários (configurar com `supabase secrets set`):
//   MP_ACCESS_TOKEN   — mesmo token de criar-pagamento
//   MP_WEBHOOK_SECRET — "Assinatura secreta" do painel Webhooks do MP
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(req: Request, url: URL): Promise<boolean> {
  const signatureHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
  if (!signatureHeader || !requestId) return false;

  if (!MP_WEBHOOK_SECRET) {
    // Sem o secret configurado não dá pra verificar nada — melhor
    // recusar do que aceitar qualquer POST como se fosse o MP de verdade.
    console.error("[webhook-mp] MP_WEBHOOK_SECRET ausente — recusando por segurança.");
    return false;
  }

  const parts: Record<string, string> = {};
  for (const kv of signatureHeader.split(",")) {
    const [k, v] = kv.split("=").map((s) => (s || "").trim());
    if (k) parts[k] = v;
  }
  const ts = parts.ts, hash = parts.v1;
  if (!ts || !hash) return false;

  const dataId = (url.searchParams.get("data.id") || url.searchParams.get("id") || "").toLowerCase();
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(expected, hash);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  if (!(await verifySignature(req, url))) {
    console.warn("[webhook-mp] Assinatura inválida ou ausente — requisição recusada.");
    return new Response("Assinatura inválida", { status: 401 });
  }

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* alguns eventos chegam sem corpo */ }

  const type = body.type || url.searchParams.get("type");
  const dataId = body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id");

  console.log("[webhook-mp] Evento recebido:", type, dataId);

  if (type !== "payment" || !dataId) return new Response("OK", { status: 200 });

  try {
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!payRes.ok) {
      console.error("[webhook-mp] Erro ao buscar pagamento no MP:", payRes.status);
      return new Response("Erro ao buscar pagamento", { status: 502 });
    }
    const payment = await payRes.json();
    console.log("[webhook-mp] status:", payment.status, "| uid:", payment.external_reference);

    if (payment.status === "approved") {
      const uid = payment.external_reference;
      if (!uid) {
        console.error("[webhook-mp] external_reference (uid) ausente no pagamento");
        return new Response("UID ausente", { status: 400 });
      }

      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const proximoVencimento = new Date();
      proximoVencimento.setMonth(proximoVencimento.getMonth() + 1);

      await admin.from("profiles").update({
        premium: true,
        premium_ativado_em: new Date().toISOString(),
        mp_payment_id: String(payment.id),
        mp_preference_id: payment.preference_id,
        proximo_vencimento: proximoVencimento.toISOString(),
      }).eq("id", uid);

      await admin.from("pagamentos")
        .update({
          status: "aprovado",
          payment_id: String(payment.id),
          aprovado_em: new Date().toISOString(),
        })
        .eq("id", payment.preference_id);

      console.log(`[webhook-mp] ✅ Premium ativado para uid: ${uid}`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[webhook-mp] Erro ao processar:", err);
    return new Response("Erro interno", { status: 500 });
  }
});
