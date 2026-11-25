# Treinador do Gambyte (Pro): como ligar

O que já está pronto no código:
- `supabase/functions/treinador/index.ts`: confere se a pessoa é Pro, aplica o
  limite (1 relatório por semana, ou antes com 5 partidas novas), chama o
  Claude Haiku 5.5 e guarda o último relatório num armazenamento privado
  (bucket `treinador`, criado sozinho na primeira chamada).
- `js/pages/dna-treinador.js` + o cartão em `dna.html`: monta o resumo do
  DNA (só números) e mostra o relatório.
- Trecho na Política de Privacidade (`#treinador`).

Para ligar (feito por você, nunca pelo Claude):
1. Criar a conta em console.anthropic.com, colocar crédito e gerar uma chave.
2. Guardar a chave no Supabase:
   `supabase secrets set ANTHROPIC_API_KEY=...`
3. Publicar a função:
   `supabase functions deploy treinador`
   (ela não usa `_shared/`, então não depende das mudanças ainda não
   commitadas de lá.)
4. Só então publicar o site: antes disso, o cartão aparece para quem é Pro
   e responde "O Treinador não respondeu agora".

Trocar de modelo sem mexer no código: `supabase secrets set TREINADOR_MODELO=claude-sonnet-5-5`
(o padrão é `claude-haiku-5-5`, ~US$ 0,002 por relatório).

O custo de cada relatório aparece no log da função
(`[treinador] relatório gerado ... entrada N, saída N tokens`).
