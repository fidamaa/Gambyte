// Gambyte — Edge Function: cancela a assinatura (o usuário pede pra
// parar de renovar).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await admin.from("profiles").update({
      premium: false,
      cancelado_em: new Date().toISOString(),
      proximo_vencimento: null,
    }).eq("id", user.id);

    return json({ ok: true });
  } catch (err) {
    console.error("[cancelar-assinatura] Erro:", err);
    return json({ error: "Erro interno." }, 500);
  }
});
