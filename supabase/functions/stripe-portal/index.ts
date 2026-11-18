// Gambyte — Edge Function: abre o portal do Stripe, onde a pessoa troca o
// cartão, vê as faturas ou cancela a assinatura do Pro.
import { admin, json, preflight, SITE, stripe, usuario } from "../_stripe/comum.ts";

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const user = await usuario(req);
    if (!user) return json({ error: "Entre na sua conta." }, 401);
    const { data: perfil } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    if (!perfil?.stripe_customer_id) return json({ error: "Esta conta não tem assinatura no cartão." }, 404);
    const sessao = await stripe.billingPortal.sessions.create({
      customer: perfil.stripe_customer_id,
      return_url: `${SITE}/gambyte-login.html`,
      locale: "pt-BR",
    });
    return json({ url: sessao.url });
  } catch (err) {
    console.error("[stripe-portal] Erro:", err);
    return json({ error: "Não consegui abrir o portal agora. Tente de novo em instantes." }, 500);
  }
});
