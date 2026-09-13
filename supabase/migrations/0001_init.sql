-- Gambyte — schema inicial (Postgres/Supabase)
--
-- Princípio central: o campo "premium" (e tudo relacionado a pagamento)
-- NUNCA pode ser escrito pelo navegador do usuário — só pelas Edge
-- Functions, usando a service_role key (que ignora RLS). Sem isso,
-- qualquer pessoa com o DevTools aberto poderia se dar Premium de graça,
-- exatamente como acontecia antes com o localStorage.

-- ── Tabela de perfis (1:1 com auth.users) ──────────────────────────────
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  name                text default '',
  premium             boolean not null default false,
  premium_ativado_em  timestamptz,
  proximo_vencimento  timestamptz,
  mp_payment_id       text,
  mp_preference_id    text,
  cancelado_em        timestamptz,
  criado_em           timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuário só lê o próprio perfil.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Só pode alterar o próprio nome — nada relacionado a premium/pagamento
-- (a policy de UPDATE do Postgres não permite restringir COLUNAS
-- diretamente, então isso é reforçado também no trigger abaixo, que
-- ignora qualquer tentativa de mudar os campos sensíveis vindo do
-- cliente autenticado; só a service_role — usada pelas Edge Functions —
-- passa direto sem trigger nenhum interferir).
create policy "profiles_update_own_name_only"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.profiles_protect_sensitive_fields()
returns trigger
language plpgsql
security definer
as $$
begin
  -- service_role (Edge Functions) não passa por aqui — só chamadas
  -- feitas com o token do próprio usuário (anon/authenticated) via RLS.
  if auth.role() = 'authenticated' then
    new.premium             := old.premium;
    new.premium_ativado_em  := old.premium_ativado_em;
    new.proximo_vencimento  := old.proximo_vencimento;
    new.mp_payment_id       := old.mp_payment_id;
    new.mp_preference_id    := old.mp_preference_id;
    new.cancelado_em        := old.cancelado_em;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect
  before update on public.profiles
  for each row execute function public.profiles_protect_sensitive_fields();

-- ── Cria o perfil automaticamente quando alguém se cadastra ───────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Registro de pagamentos (histórico/auditoria) ───────────────────────
create table if not exists public.pagamentos (
  id             text primary key,        -- preference_id do Mercado Pago
  uid            uuid not null references auth.users(id) on delete cascade,
  email          text,
  status         text not null default 'pendente',
  valor          numeric(10,2) not null,
  payment_id     text,
  criado_em      timestamptz not null default now(),
  aprovado_em    timestamptz
);

alter table public.pagamentos enable row level security;

-- Cada usuário só vê os próprios pagamentos; só a service_role escreve.
create policy "pagamentos_select_own"
  on public.pagamentos for select
  using (auth.uid() = uid);
