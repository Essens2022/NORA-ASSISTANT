-- NORA – core schema.
-- Every user-owned table has user_id + Row Level Security: user A can never read user B's data.
-- Times: instants are timestamptz (UTC); local wall-clock date/time + IANA timezone are stored separately.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  ui_lang text not null default 'en' check (ui_lang in ('en', 'ro', 'it', 'ru')),
  conv_lang text check (conv_lang in ('en', 'ro', 'it', 'ru')),
  locale text not null default 'en-US',
  timezone text not null default 'UTC',
  prefs jsonb not null default '{}'::jsonb,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, ui_lang, locale, timezone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'ui_lang', ''), 'en'),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en-US'),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  kind text not null default 'generic' check (kind in ('appointment', 'call', 'payment', 'shopping', 'travel', 'document', 'generic')),
  status text not null default 'captured' check (status in (
    'captured', 'needs_clarification', 'scheduled', 'upcoming', 'reminded', 'acknowledged',
    'in_progress', 'completed', 'missed', 'rescheduled', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  due_time time,
  time_window text check (time_window in ('morning', 'afternoon', 'evening', 'anytime')),
  timezone text not null default 'UTC',
  time_binding text not null default 'floating' check (time_binding in ('floating', 'absolute')),
  start_at timestamptz,
  duration_min int check (duration_min between 0 and 1440),
  location text,
  travel_min int check (travel_min between 0 and 1440),
  buffer_min int check (buffer_min between 0 and 1440),
  recurrence text,
  missing_fields text[] not null default '{}',
  followup_count int not null default 0,
  max_followups int not null default 3,
  source_message text,
  confidence real,
  client_request_id text,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tasks_idempotency on public.tasks (user_id, client_request_id) where client_request_id is not null;
create index tasks_user_status_date on public.tasks (user_id, status, due_date);
create index tasks_user_updated on public.tasks (user_id, updated_at desc);
create index tasks_title_search on public.tasks using gin (to_tsvector('simple', title));

-- ---------------------------------------------------------------------------
-- Reminders – durable schedule. Survives restarts; sent by the dispatcher.
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('prep', 'departure', 'main', 'followup', 'snooze')),
  fire_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  sound text not null default 'normal' check (sound in ('silent', 'normal', 'important')),
  -- unguessable token: lets a notification button act on exactly this reminder without a session
  action_token uuid not null default gen_random_uuid() unique,
  attempts int not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index reminders_due on public.reminders (fire_at) where status = 'pending';
create index reminders_task on public.reminders (task_id, status);

-- ---------------------------------------------------------------------------
-- Event log – history for debugging, analytics and personalisation
-- ---------------------------------------------------------------------------
create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index task_events_task on public.task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Conversations (short-term context) and messages
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user on public.conversations (user_id, updated_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  request_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages (conversation_id, id desc);
create unique index messages_request on public.messages (user_id, request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- Long-term memory – visible, editable and deletable by the user
-- ---------------------------------------------------------------------------
create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'preference' check (kind in ('preference', 'fact')),
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Devices (push endpoints). Web Push today; APNs / FCM later.
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'webpush' check (kind in ('webpush', 'apns', 'fcm')),
  endpoint text not null unique,
  keys jsonb not null default '{}'::jsonb,
  user_agent text,
  lang text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index devices_user on public.devices (user_id) where disabled_at is null;

-- ---------------------------------------------------------------------------
-- Privacy-friendly product analytics / performance metrics (no message content)
-- ---------------------------------------------------------------------------
create table public.metrics (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  value real,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index metrics_name_time on public.metrics (name, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create trigger memory_touch before update on public.memory_items for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.task_events enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_items enable row level security;
alter table public.devices enable row level security;
alter table public.metrics enable row level security;

create policy profiles_own on public.profiles for all using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy tasks_own on public.tasks for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reminders_own on public.reminders for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy task_events_own on public.task_events for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy conversations_own on public.conversations for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy messages_own on public.messages for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy memory_own on public.memory_items for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_own on public.devices for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy metrics_insert_own on public.metrics for insert with check (user_id = (select auth.uid()));

-- A reminder may only point at a task of the same user.
create or replace function public.reminder_owner_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'reminder task owner mismatch';
  end if;
  return new;
end $$;
create trigger reminders_owner before insert or update of task_id, user_id on public.reminders
  for each row execute function public.reminder_owner_check();

-- ---------------------------------------------------------------------------
-- Dispatcher helpers (service role only)
-- ---------------------------------------------------------------------------

-- Atomically claim due reminders. SKIP LOCKED makes concurrent dispatchers safe;
-- reminders stuck in 'sending' (crashed worker) are retried after 5 minutes.
create or replace function public.claim_due_reminders(batch int default 100)
returns setof public.reminders
language plpgsql security definer set search_path = public as $$
begin
  update public.reminders set status = 'pending'
   where status = 'sending' and sent_at is null and fire_at < now() - interval '5 minutes' and attempts < 5;

  return query
  update public.reminders r
     set status = 'sending', attempts = r.attempts + 1
   where r.id in (
     select id from public.reminders
      where status = 'pending' and fire_at <= now()
      order by fire_at
      limit batch
      for update skip locked)
  returning r.*;
end $$;

revoke all on function public.claim_due_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;
