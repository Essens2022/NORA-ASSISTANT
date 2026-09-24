-- OAuth hand-off for installed iOS web apps.
-- A home-screen app opens Google sign-in in a separate in-app browser whose storage
-- is not the app's. The browser parks the new session's refresh token under a
-- one-time nonce that only the app knows; the app claims it and signs in.
-- Tokens live at most 5 minutes and are deleted on first read.

create table if not exists public.auth_handoffs (
  nonce_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

alter table public.auth_handoffs enable row level security;
-- no policies: only the functions below touch this table
revoke all on public.auth_handoffs from anon, authenticated;

-- called by the in-app browser right after sign-in (signed-in user)
create or replace function public.nora_handoff_put(p_nonce text, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if length(p_nonce) < 32 or length(p_nonce) > 128 or length(p_refresh_token) > 4096 then
    raise exception 'invalid';
  end if;
  delete from public.auth_handoffs where created_at < now() - interval '5 minutes';
  insert into public.auth_handoffs (nonce_hash, user_id, refresh_token)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'), auth.uid(), p_refresh_token)
  on conflict (nonce_hash) do nothing;
end;
$$;

-- called by the installed app (not signed in yet): single use, 5 minute window
create or replace function public.nora_handoff_take(p_nonce text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if length(p_nonce) < 32 or length(p_nonce) > 128 then
    return null;
  end if;
  delete from public.auth_handoffs
  where nonce_hash = encode(extensions.digest(p_nonce, 'sha256'), 'hex')
    and created_at > now() - interval '5 minutes'
  returning refresh_token into v_token;
  return v_token;
end;
$$;

revoke all on function public.nora_handoff_put(text, text) from public, anon;
grant execute on function public.nora_handoff_put(text, text) to authenticated;
revoke all on function public.nora_handoff_take(text) from public;
grant execute on function public.nora_handoff_take(text) to anon, authenticated;
