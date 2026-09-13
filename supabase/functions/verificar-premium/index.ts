// Gambyte — Edge Function: verifica/expira o status premium.
//
// O cliente também escuta a tabela profiles em tempo real (Supabase
// Realtime) — esta function existe pra forçar a checagem de vencimento
// sem esperar o próximo pagamento mudar a linha.
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
    const { data: profile } = await admin
      .from("profiles").select("*").eq("id", user.id).single();
    if (!profile) return json({ premium: false });

    if (profile.premium && profile.proximo_vencimento && new Date(profile.proximo_vencimento) < new Date()) {
      await admin.from("profiles").update({ premium: false }).eq("id", user.id);
      return json({ premium: false, motivo: "expirado" });
    }

    return json({
      premium: profile.premium || false,
      premium_ativado_em: profile.premium_ativado_em,
      proximo_vencimento: profile.proximo_vencimento,
    });
  } catch (err) {
    console.error("[verificar-premium] Erro:", err);
    return json({ error: "Erro interno." }, 500);
  }
});
