# DNA na conta

Desde 26/11/2026 o resumo de cada partida analisada fica no navegador
(`localStorage`, `gambyte_dna_v1`, cópia rápida) e, para quem está logado,
também na tabela `partidas_analisadas` do Supabase.

- Migração: `supabase/migrations/0004_dna_na_conta.sql` (RLS: cada conta só
  lê, grava e apaga as próprias linhas; teto de 400 por conta).
- Cliente: `js/modules/dna-nuvem.js`, carregado em `/` e `/dna`.
  - Ao entrar na conta: baixa da conta o que o aparelho não tem
    (`PlayerDNA.mesclar`) e envia o que a conta não tem.
  - Cada partida nova (`PlayerDNA.aoRegistrar`) vai para a conta.
  - `DNASync.sincronizar` espera `DNANuvem.pronto()` (até 8 s) antes de buscar
    partidas novas, para não analisar de novo o que veio de outro aparelho.
  - "Apagar os dados do DNA" apaga no aparelho e na conta.
- Sem a migração aplicada, o cliente percebe que a tabela não existe e segue
  só com o navegador (aviso no console, nada na tela).
- Textos: `privacidade.html` (parágrafo `#dna-conta`), FAQ da página inicial
  (também no JSON-LD) e o rodapé do `/dna`.
