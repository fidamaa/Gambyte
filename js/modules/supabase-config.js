/* ==============================================================
   MODULE: supabase-config.js
   Configuração do projeto Supabase do Gambyte.

   Os valores abaixo NÃO são segredos — "Project URL" e a chave "anon
   public" são feitas pra ficar no navegador (a segurança de verdade vem
   das políticas RLS no banco, não de esconder isso). Pegue os valores
   reais em: Painel Supabase → Project Settings → API.

   Depende de (carregar ANTES deste arquivo, via <script> no <head>/<body>):
     https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
   ============================================================== */
const SUPABASE_URL      = "https://agxispsevxwkprcfptbx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneGlzcHNldnh3a3ByY2ZwdGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyNTg0NTEsImV4cCI6MjEwNDgzNDQ1MX0.Vv6X8KDEln9HbB93XaUsZVwOBz1OMUDSFiqHAp4lkpI";                  // ← VOCÊ PREENCHE

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
