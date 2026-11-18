// Gambyte — Edge Function: lê a posição de uma FOTO de tabuleiro (Pro).
//
// O navegador manda a foto já reduzida (JPEG, lado maior até 1280 px).
// Aqui conferimos a sessão e o Pro, aplicamos um limite diário por conta
// e pedimos ao Claude (visão) a posição em JSON estruturado. A pessoa
// confere e corrige tudo no editor antes de analisar.
//
// Segredo necessário: ANTHROPIC_API_KEY (supabase secrets set ...).
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import Anthropic from "npm:@anthropic-ai/sdk@^0.136.0";

// CORS próprio (só o site chama esta função).
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
function requestGuard(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  if (origin && origin !== ORIGEM) return json({ error: "Origem não permitida." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  return null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Cada leitura é paga (API da Anthropic): limites por conta Pro.
const LIMITE_DIA = 10;              // fotos por conta por dia
const LIMITE_MES = 60;              // fotos por conta por mês
const MAX_BASE64 = 4_500_000;       // ~3,3 MB de imagem
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

const SISTEMA = `Você lê posições de xadrez em fotos e prints de tabuleiro.
Responda só com o JSON pedido.

Formato de "fileiras": exatamente 8 textos, da fileira 8 até a fileira 1
(a fileira 8 é a das peças pretas na posição inicial). Cada texto tem
exatamente 8 caracteres, da coluna a até a coluna h. Use K Q R B N P para
as peças brancas, k q r b n p para as pretas e "." para casa vazia.

Descubra a orientação antes de montar as fileiras: use as letras e números
das bordas quando aparecerem; senão, a cor da casa do canto (a casa h1 é
clara), a posição dos reis e dos peões. Informe em "brancas_embaixo" se,
na imagem, as brancas estão do lado de baixo.

Olhe cada casa com cuidado: peças caídas, tortas ou cortadas pela foto
ainda contam. Diferencie bem rei de dama e bispo de peão. Liste em
"casas_duvidosas" (ex.: "e4") as casas em que não tem certeza.
Se não houver um tabuleiro de xadrez na imagem, use
"encontrou_tabuleiro": false e deixe "fileiras" vazio.`;

const ESQUEMA = {
  type: "object",
  properties: {
    encontrou_tabuleiro: { type: "boolean" },
    brancas_embaixo: { type: "boolean" },
    fileiras: { type: "array", items: { type: "string" } },
    vez: { type: "string", enum: ["brancas", "pretas", "desconhecida"] },
    casas_duvidosas: { type: "array", items: { type: "string" } },
    observacao: { type: "string" },
  },
  required: ["encontrou_tabuleiro", "brancas_embaixo", "fileiras", "vez", "casas_duvidosas", "observacao"],
  additionalProperties: false,
};

function hojeSP(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const blocked = requestGuard(req);
  if (blocked) return blocked;

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "A leitura por foto ainda não foi ativada no servidor." }, 503);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Entre na sua conta para usar a foto do tabuleiro." }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Sessão inválida. Entre de novo." }, 401);

    // Só para o Pro ativo.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("profiles").select("premium, proximo_vencimento").eq("id", user.id).single();
    const pro = !!(profile?.premium && profile.proximo_vencimento && new Date(profile.proximo_vencimento) > new Date());
    if (!pro) return json({ error: "A foto do tabuleiro é um recurso do Gambyte Pro." }, 403);

    // Limite diário por conta (fica nos metadados de app, que o usuário não edita).
    const meta = (user.app_metadata || {}) as Record<string, unknown>;
    const dia = hojeSP(), mes = dia.slice(0, 7);
    const usadas = meta.foto_dia === dia ? Number(meta.foto_n || 0) : 0;
    const usadasMes = meta.foto_mes === mes ? Number(meta.foto_m || 0) : 0;
    if (usadasMes >= LIMITE_MES) {
      return json({ error: `Você já leu ${LIMITE_MES} fotos este mês. O limite volta no mês que vem; prints continuam liberados.` }, 429);
    }
    if (usadas >= LIMITE_DIA) {
      return json({ error: `Você já leu ${LIMITE_DIA} fotos hoje. O limite volta amanhã; prints continuam liberados.` }, 429);
    }

    const corpo = await req.json().catch(() => null) as { imagem?: string; tipo?: string } | null;
    const imagem = corpo?.imagem || "";
    const tipo = corpo?.tipo || "image/jpeg";
    if (!imagem || typeof imagem !== "string" || !/^[A-Za-z0-9+/=]+$/.test(imagem)) {
      return json({ error: "Imagem inválida." }, 400);
    }
    if (imagem.length > MAX_BASE64) return json({ error: "Imagem grande demais." }, 413);
    if (!TIPOS.includes(tipo)) return json({ error: "Formato de imagem não aceito." }, 400);

    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...meta, foto_dia: dia, foto_n: usadas + 1, foto_mes: mes, foto_m: usadasMes + 1 },
    });

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const resposta = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // medium: o padrão do modelo; pensa o suficiente para ler a foto
      // sem gastar à toa (o raciocínio é cobrado como saída).
      output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipo as "image/jpeg", data: imagem } },
          { type: "text", text: "Qual é a posição deste tabuleiro?" },
        ],
      }],
    });

    // Custo de cada leitura nos logs da função (tokens de entrada e saída).
    console.log("[reconhecer-tabuleiro] uso", JSON.stringify({
      entrada: resposta.usage?.input_tokens, saida: resposta.usage?.output_tokens, modelo: resposta.model,
    }));

    if (resposta.stop_reason === "refusal") {
      return json({ error: "Não foi possível ler esta imagem. Tente outra foto." }, 422);
    }
    const texto = resposta.content.find((b) => b.type === "text");
    if (!texto || texto.type !== "text") return json({ error: "Resposta vazia. Tente de novo." }, 502);
    const lido = JSON.parse(texto.text);

    if (!lido.encontrou_tabuleiro) {
      return json({ ok: false, motivo: lido.observacao || "Não encontrei um tabuleiro nesta foto." });
    }
    // Normaliza as fileiras: 8 linhas de 8 casas, só caracteres válidos.
    const fileiras = Array.from({ length: 8 }, (_, i) => {
      const f = String(lido.fileiras?.[i] || "").replace(/[^KQRBNPkqrbnp.]/g, "");
      return (f + "........").slice(0, 8);
    });
    const duvidas = (lido.casas_duvidosas || []).filter((c: unknown) => typeof c === "string" && /^[a-h][1-8]$/.test(c));
    return json({
      ok: true,
      linhas: fileiras,
      brancasEmbaixo: lido.brancas_embaixo !== false,
      vez: lido.vez,
      duvidas,
      observacao: String(lido.observacao || "").slice(0, 300),
      restantes: Math.min(LIMITE_DIA - usadas - 1, LIMITE_MES - usadasMes - 1),
    });
  } catch (err) {
    console.error("[reconhecer-tabuleiro] Erro:", err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Muita procura agora. Tente em um minuto." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: "O serviço de leitura falhou. Tente de novo." }, 502);
    return json({ error: "Erro interno." }, 500);
  }
});
