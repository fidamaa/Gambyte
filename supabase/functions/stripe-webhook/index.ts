// Gambyte — Edge Function: recebe os avisos do Stripe (assinatura criada,
// renovada, com pagamento falho, cancelada) e atualiza o Pro da conta.
//
// Chamada pelo Stripe, não pelo navegador: roda com verify_jwt = false
// (ver supabase/config.toml). A garantia de que o aviso é do Stripe é a
// assinatura do cabeçalho Stripe-Signature, conferida abaixo.
import Stripe from "npm:stripe@22";
import { sincronizar, stripe } from "../_stripe/comum.ts";

const cripto = Stripe.createSubtleCryptoProvider();
const EVENTOS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });
  const assinatura = req.headers.get("Stripe-Signature");
  const segredo = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!assinatura || !segredo) return new Response("Sem assinatura.", { status: 400 });

  const corpo = await req.text();   // o texto bruto: a assinatura é conferida sobre ele
  let evento: Stripe.Event;
  try {
    evento = await stripe.webhooks.constructEventAsync(corpo, assinatura, segredo, undefined, cripto);
  } catch (err) {
    console.warn("[stripe-webhook] assinatura inválida:", (err as Error).message);
    return new Response("Assinatura inválida.", { status: 400 });
  }
  if (!EVENTOS.has(evento.type)) return Response.json({ ignorado: evento.type });

  try {
    // deno-lint-ignore no-explicit-any
    const obj = evento.data.object as any;
    const cliente = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
    if (cliente) await sincronizar(cliente);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[stripe-webhook] Erro:", err);
    // 500 faz o Stripe tentar de novo mais tarde.
    return new Response("Erro interno.", { status: 500 });
  }
});
