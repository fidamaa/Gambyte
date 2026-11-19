// Gambyte — Edge Function: abre o Checkout do Stripe para assinar o Pro
// (R$ 9,90 por mês, no cartão, com renovação automática e cancelamento a
// qualquer momento). Só para quem está logado.
import { admin, json, preflight, SITE, stripe, usuario } from "../_stripe/comum.ts";

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const user = await usuario(req);
    if (!user) return json({ error: "Entre na sua conta para assinar." }, 401);
    const preco = Deno.env.get("STRIPE_PRICE_ID");
    if (!preco || !Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Pagamento por cartão ainda não configurado." }, 503);

    const { data: perfil } = await admin.from("profiles")
      .select("stripe_customer_id, stripe_status").eq("id", user.id).single();
    if (perfil?.stripe_status && ["active", "trialing", "past_due"].includes(perfil.stripe_status)) {
      return json({ error: "Sua assinatura já está ativa. Para mudar o cartão ou cancelar, use “Gerenciar assinatura”." }, 409);
    }

    // Um cliente do Stripe por conta do Gambyte, guardado no perfil.
    let cliente = perfil?.stripe_customer_id as string | null;
    if (!cliente) {
      const c = await stripe.customers.create({ email: user.email ?? undefined, metadata: { uid: user.id } }, { idempotencyKey: `cliente-${user.id}` });
      cliente = c.id;
      const { error } = await admin.from("profiles").update({ stripe_customer_id: cliente }).eq("id", user.id);
      if (error) throw error;
    }

    const sessao = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: cliente,
      client_reference_id: user.id,
      line_items: [{ price: preco, quantity: 1 }],
      subscription_data: { metadata: { uid: user.id } },
      metadata: { uid: user.id },
      locale: "pt-BR",
      allow_promotion_codes: true,   // campo de cupom no pagamento (testes e promoções)
      success_url: `${SITE}/gambyte-premium.html?stripe=ok`,
      cancel_url: `${SITE}/gambyte-premium.html?stripe=cancelado`,
    });
    return json({ url: sessao.url });
  } catch (err) {
    console.error("[stripe-checkout] Erro:", err);
    // Erros do Stripe trazem um código que ajuda a achar o problema
    // (a chave aparece mascarada pelo próprio Stripe).
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    const detalhe = e?.type?.startsWith?.("Stripe") ? ` (Stripe: ${e.code || e.type}${e.message ? " — " + String(e.message).slice(0, 220) : ""})` : "";
    return json({ error: "Não consegui abrir o pagamento agora." + detalhe }, 500);
  }
});
