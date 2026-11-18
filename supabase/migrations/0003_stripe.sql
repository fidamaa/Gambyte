-- Gambyte — assinatura do Pro por cartão (Stripe).
--
-- Guarda no perfil o cliente e a assinatura do Stripe. Como os outros
-- campos de pagamento, só as Edge Functions (service_role) escrevem aqui:
-- o navegador não consegue mudar esses campos nem se dar o Pro.
begin;

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_status          text;

create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

-- Mesma proteção de antes, agora também para os campos do Stripe.
create or replace function public.profiles_protect_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    new.premium                := old.premium;
    new.premium_ativado_em     := old.premium_ativado_em;
    new.proximo_vencimento     := old.proximo_vencimento;
    new.mp_payment_id          := old.mp_payment_id;
    new.mp_preference_id       := old.mp_preference_id;
    new.cancelado_em           := old.cancelado_em;
    new.stripe_customer_id     := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.stripe_status          := old.stripe_status;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_protect_sensitive_fields() from public, anon, authenticated;

commit;
