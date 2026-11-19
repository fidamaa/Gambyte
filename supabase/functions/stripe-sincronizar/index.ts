// Gambyte — Edge Function: confere no Stripe a assinatura da própria conta
// e atualiza o Pro. É a segunda via do webhook: o site chama ao voltar do
// pagamento, para o Pro ativar mesmo se o aviso do Stripe atrasar.
// Cada pessoa só sincroniza o próprio cliente do Stripe.
import { admin, json, preflight, sincronizar, usuario } from "../_stripe/comum.ts";

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const user = await usuario(req);
    if (!user) return json({ error: "Entre na sua conta." }, 401);
    const { data: perfil } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    if (!perfil?.stripe_customer_id) return json({ ok: true, assinatura: null });
    await sincronizar(perfil.stripe_customer_id);
    const { data: depois } = await admin.from("profiles")
      .select("premium, stripe_status, proximo_vencimento").eq("id", user.id).single();
    return json({ ok: true, assinatura: depois?.stripe_status ?? null, premium: !!depois?.premium, vence: depois?.proximo_vencimento ?? null });
  } catch (err) {
    console.error("[stripe-sincronizar] Erro:", err);
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    const detalhe = e?.type?.startsWith?.("Stripe") ? ` (Stripe: ${e.code || e.type})` : "";
    return json({ error: "Não consegui conferir a assinatura agora." + detalhe }, 500);
  }
});
