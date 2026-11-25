# Histórico e DNA na conta (o que falta no servidor)

Hoje o histórico, o DNA geral e o explorador de aberturas leem os resumos que
cada análise grava **só neste aparelho** (`localStorage`, chave
`gambyte_dna_v1`, até 300 partidas). Isso foi mantido de propósito: a política
de privacidade promete que nada da análise é enviado ao servidor, e mudar isso
é uma decisão do dono do site.

Para o histórico seguir a conta entre aparelhos, falta:

## 1. Tabela no Supabase (migração nova)

```sql
create table public.partidas_analisadas (
  id          bigint primary key,            -- o mesmo id do resumo local (Date.now())
  user_id     uuid not null references auth.users(id) on delete cascade,
  chave       text not null,                 -- lances, para não duplicar
  resumo      jsonb not null,                -- o objeto salvo por PlayerDNA.registrar
  criado_em   timestamptz not null default now(),
  unique (user_id, chave)
);
alter table public.partidas_analisadas enable row level security;
create policy "dono lê"     on public.partidas_analisadas for select using (auth.uid() = user_id);
create policy "dono grava"  on public.partidas_analisadas for insert with check (auth.uid() = user_id);
create policy "dono apaga"  on public.partidas_analisadas for delete using (auth.uid() = user_id);
```

Tamanho: um resumo tem ~1,5 KB (com o PGN enxuto); 300 partidas ≈ 450 KB por usuário.

## 2. Cliente (`js/modules/player-dna.js`)

- Em `registrar()`: depois de gravar no aparelho, se houver sessão
  (`AuthSystem.currentSession()`), fazer `upsert` em `partidas_analisadas`.
- Em `ler()`: juntar o local com o da conta (por `chave`), na abertura das
  páginas `/` e `/dna`. A página `/dna` hoje não carrega o Supabase; seria
  preciso incluir `js/vendor/supabase-*.js` e `supabase-config.js` nela.
- `apagar()`: apagar também na conta (com confirmação).

## 3. Texto

- Atualizar `privacidade.html` (seção de dados guardados) e a resposta
  "Minhas partidas ficam guardadas em algum servidor?" do FAQ da página
  inicial e do JSON-LD.
- Uma opção na conta: "Guardar meu histórico na conta" (ligada só com
  consentimento).

Enquanto isso não existir, a interface diz "neste aparelho" em todos os
lugares, para não parecer que sincroniza.
