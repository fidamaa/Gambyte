-- Gambyte — DNA guardado na conta
--
-- Cada partida analisada vira um resumo (o mesmo objeto que
-- PlayerDNA.registrar grava no navegador, ~1,5 a 3 KB com o PGN enxuto).
-- Com isso o DNA abre pronto em qualquer aparelho em que a pessoa entrar,
-- sem analisar tudo de novo. Cada pessoa só vê, grava e apaga os próprios.

create table if not exists public.partidas_analisadas (
  user_id    uuid not null references auth.users(id) on delete cascade,
  chave      text not null check (char_length(chave) between 1 and 700),   -- lances da partida (não duplica)
  resumo     jsonb not null check (pg_column_size(resumo) < 20000),
  criado_em  timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.partidas_analisadas enable row level security;

create policy "partidas_select_own" on public.partidas_analisadas
  for select using (auth.uid() = user_id);
create policy "partidas_insert_own" on public.partidas_analisadas
  for insert with check (auth.uid() = user_id);
create policy "partidas_update_own" on public.partidas_analisadas
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "partidas_delete_own" on public.partidas_analisadas
  for delete using (auth.uid() = user_id);

-- Teto por conta (o navegador guarda até 300): evita que alguém encha o
-- banco gravando resumos sem parar.
create or replace function public.partidas_analisadas_teto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.partidas_analisadas where user_id = new.user_id and chave = new.chave)
     and (select count(*) from public.partidas_analisadas where user_id = new.user_id) >= 400 then
    raise exception 'limite de partidas guardadas na conta';
  end if;
  return new;
end;
$$;

drop trigger if exists partidas_analisadas_teto on public.partidas_analisadas;
create trigger partidas_analisadas_teto
  before insert on public.partidas_analisadas
  for each row execute function public.partidas_analisadas_teto();

create index if not exists partidas_analisadas_user_criado on public.partidas_analisadas (user_id, criado_em desc);
