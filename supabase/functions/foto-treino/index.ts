// Gambyte — Edge Function: guarda uma foto de tabuleiro corrigida pelo
// usuário, para treinar de novo o leitor de fotos do Gambyte.
//
// Só chega aqui com a autorização da pessoa (caixa na aba Foto e no editor).
// A foto e a posição corrigida vão para o bucket privado "fotos-treino"
// (só o service role lê). Nada disso é usado para outra coisa.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "fotos-treino";
const MAX_BASE64 = 3_000_000;       // ~2,2 MB de JPEG
const LIMITE_DIA = 50;              // envios por conta por dia (contra abuso)

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

const FEN_PECAS = /^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8}$/;
const LADOS = ["baixo", "cima", "esquerda", "direita"];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== ORIGEM) return json({ error: "Origem não permitida." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Entre na sua conta." }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Sessão inválida." }, 401);

    const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
    const imagem = String(corpo?.imagem || "");
    const fen = String(corpo?.fen || "").split(" ")[0];
    const cantos = corpo?.cantos as number[][] | undefined;
    const lado = String(corpo?.lado_brancas || "baixo");
    const lido = String(corpo?.lido || "").slice(0, 100);
    if (!imagem || imagem.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(imagem)) return json({ error: "Imagem inválida." }, 400);
    if (!FEN_PECAS.test(fen)) return json({ error: "Posição inválida." }, 400);
    if (!Array.isArray(cantos) || cantos.length !== 4 || !cantos.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
      return json({ error: "Cantos inválidos." }, 400);
    }
    if (!LADOS.includes(lado)) return json({ error: "Lado inválido." }, 400);
    // Filtro leve: posição possível (um rei de cada cor, até 32 peças),
    // cantos dentro de uma foto de até 1280 px e arquivo JPEG de verdade.
    const pecas = fen.replace(/[^a-zA-Z]/g, "");
    if ((pecas.match(/K/g) || []).length !== 1 || (pecas.match(/k/g) || []).length !== 1 || pecas.length > 32) {
      return json({ error: "Posição inválida." }, 400);
    }
    if (!cantos.every(([x, y]) => x > -100 && x < 1400 && y > -100 && y < 1400)) return json({ error: "Cantos inválidos." }, 400);

    // Limite diário simples por conta (nos metadados de app).
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const meta = (user.app_metadata || {}) as Record<string, unknown>;
    const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const usadas = meta.treino_dia === dia ? Number(meta.treino_n || 0) : 0;
    if (usadas >= LIMITE_DIA) return json({ ok: false, motivo: "limite" });

    // Cria o bucket privado na primeira vez.
    const { data: b } = await admin.storage.getBucket(BUCKET);
    if (!b) await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 3_000_000 });

    const id = `${dia}/${crypto.randomUUID()}`;
    const bytes = Uint8Array.from(atob(imagem), (c) => c.charCodeAt(0));
    if (bytes.length < 2000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ error: "Imagem inválida." }, 400);
    const up1 = await admin.storage.from(BUCKET).upload(`${id}.jpg`, bytes, { contentType: "image/jpeg" });
    if (up1.error) throw up1.error;
    // "conta" é só o código interno da conta (sem nome nem e-mail), para
    // achar e apagar as fotos se a pessoa pedir.
    const rotulo = { fen, corners: cantos, lado_brancas: lado, lido, fonte: "site", conta: user.id, criado: new Date().toISOString() };
    const up2 = await admin.storage.from(BUCKET).upload(`${id}.json`, new Blob([JSON.stringify(rotulo)], { type: "application/json" }));
    if (up2.error) throw up2.error;

    await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, treino_dia: dia, treino_n: usadas + 1 } });
    return json({ ok: true });
  } catch (err) {
    console.error("[foto-treino] Erro:", err);
    return json({ error: "Erro interno." }, 500);
  }
});
