// Cabeçalhos CORS compartilhados por todas as Edge Functions do Gambyte —
// o site (Cloudflare Pages) chama estas funções de um domínio diferente
// do Supabase, então isso é obrigatório.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
