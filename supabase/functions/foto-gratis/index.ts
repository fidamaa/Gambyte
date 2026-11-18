// Gambyte — Edge Function: libera o teste grátis da foto do tabuleiro.
//
// Quem é Pro usa à vontade. Quem tem conta e não é Pro pode usar a foto
// uma vez por dia (horário de Brasília); o uso conta por conta e também por
// IP, para que outra conta ou uma guia anônima na mesma rede não libere de
// novo no mesmo dia. Sem conta, vale um teste só, para sempre, por IP. O IP não é guardado: fica só um resumo
// (hash com segredo) num marcador do dia, num armazenamento privado.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "foto-gratis";

const ORIGEM = "https://gambyte.com.br";
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGEM,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function ipDe(req: Request): string {
  const h = req.headers;
  const ip = h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "";
  return ip.trim();
}

async function resumo(texto: string): Promise<string> {
  const dados = new TextEncoder().encode(`${SUPABASE_SERVICE_ROLE_KEY.slice(-24)}|${texto}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const MSG_USADA = "Você já usou sua foto grátis de hoje. Volte amanhã ou assine o Pro para usar quantas vezes quiser.";
const MSG_SEM_CONTA = "Você já usou o teste sem conta. Crie uma conta grátis para usar uma foto por dia, ou assine o Pro para usar quantas vezes quiser.";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== ORIGEM) return json({ error: "Origem não permitida." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: b } = await admin.storage.getBucket(BUCKET);
    if (!b) await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 1024 });
    const ip = ipDe(req);

    // Marca o uso num caminho; devolve false se já existia.
    const marcar = async (caminho: string): Promise<boolean> => {
      const up = await admin.storage.from(BUCKET).upload(caminho, new Blob(["1"], { type: "text/plain" }), { upsert: false });
      if (!up.error) return true;
      const txt = `${up.error.message || ""} ${(up.error as { statusCode?: string }).statusCode || ""}`;
      if (/exist|duplicate|409/i.test(txt)) return false;
      throw up.error;
    };

    const authHeader = req.headers.get("Authorization") || "";
    let user: { id: string; app_metadata?: Record<string, unknown> } | null = null;
    if (authHeader) {
      // Sem login, o cliente manda a chave pública no lugar do token: aí não há usuário.
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data } = await userClient.auth.getUser().catch(() => ({ data: { user: null } }));
      user = data?.user || null;
    }

    // Sem conta: um teste só, para sempre, por IP (guia anônima não muda o IP).
    if (!user) {
      if (!ip) return json({ ok: false, motivo: "entrar", mensagem: MSG_SEM_CONTA });
      const livre = await marcar(`sem-conta/${await resumo(ip)}.txt`);
      return livre ? json({ ok: true, gratis: true, semConta: true }) : json({ ok: false, motivo: "entrar", mensagem: MSG_SEM_CONTA });
    }

    const { data: perfil } = await admin.from("profiles").select("premium, proximo_vencimento").eq("id", user.id).single();
    const pro = !!perfil?.premium && (!perfil.proximo_vencimento || new Date(perfil.proximo_vencimento) >= new Date());
    if (pro) return json({ ok: true, pro: true });

    const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const meta = (user.app_metadata || {}) as Record<string, unknown>;
    if (meta.foto_gratis_dia === dia) return json({ ok: false, motivo: "usada", mensagem: MSG_USADA });

    // Marcador do IP no dia: se já existe, alguém nesta rede já usou hoje.
    if (ip && !(await marcar(`dia/${dia}/${await resumo(ip)}.txt`))) return json({ ok: false, motivo: "usada", mensagem: MSG_USADA });

    await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, foto_gratis_dia: dia } });
    return json({ ok: true, gratis: true });
  } catch (err) {
    console.error("[foto-gratis] Erro:", err);
    return json({ error: "Erro interno." }, 500);
  }
});
