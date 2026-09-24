-- Reliability hardening found in a full backend review.
-- Nothing here changes normal app behaviour; it closes gaps an abusive or
-- malformed client could otherwise use to starve every user's reminders.

-- ---------------------------------------------------------------------------
-- 1. claim_due_reminders: a stuck 'sending' row must be measured from when it
--    was CLAIMED, not from its fire_at. Before this, a batch of reminders whose
--    fire_at was already >5 min in the past (e.g. after an outage) could be
--    reset and re-claimed by the very next tick while the first run was still
--    sending them, producing duplicate pushes.
-- ---------------------------------------------------------------------------
alter table public.reminders add column if not exists claimed_at timestamptz;

create or replace function public.claim_due_reminders(batch int default 100)
returns setof public.reminders
language plpgsql security definer set search_path = public as $$
begin
  update public.reminders set status = 'pending', claimed_at = null
   where status = 'sending' and sent_at is null and claimed_at < now() - interval '5 minutes' and attempts < 5;

  return query
  update public.reminders r
     set status = 'sending', attempts = r.attempts + 1, claimed_at = now()
   where r.id in (
     select id from public.reminders
      where status = 'pending' and fire_at <= now()
      order by fire_at
      limit batch
      for update skip locked)
  returning r.*;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Reminders are written by the authenticated user's own client (RLS
--    `for all`), which lets one account insert an unbounded number of rows
--    with a far-past fire_at and dominate claim_due_reminders' FIFO order,
--    starving every other user. Two independent, minimal-risk guards:
--    a) fire_at must fall in a realistic window;
--    b) a hard cap on pending reminders per user.
--    Neither changes anything for normal use, where planReminders() only ever
--    schedules a handful of rows per task, days in the future at most.
-- ---------------------------------------------------------------------------
alter table public.reminders drop constraint if exists reminders_fire_at_sane;
alter table public.reminders add constraint reminders_fire_at_sane
  check (fire_at > created_at - interval '1 day' and fire_at < created_at + interval '400 days');

create or replace function public.reminder_owner_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'reminder task owner mismatch';
  end if;
  if new.status = 'pending' and tg_op = 'INSERT' and
     (select count(*) from public.reminders r where r.user_id = new.user_id and r.status = 'pending') >= 500 then
    raise exception 'too many pending reminders';
  end if;
  return new;
end $$;
-- (the trigger itself, and its search_path, are already correct; only the function body changed)
alter function public.reminder_owner_check() set search_path = '';

-- ---------------------------------------------------------------------------
-- 3. touch_updated_at also needs a fixed search_path (flagged by the advisor).
-- ---------------------------------------------------------------------------
alter function public.touch_updated_at() set search_path = '';

-- ---------------------------------------------------------------------------
-- 4. Auth hand-off rows (nora_auth_handoff.sql) hold a plaintext refresh
--    token for up to 5 minutes and are only swept opportunistically, on the
--    next call to nora_handoff_put. A hand-off nobody claims (an interrupted
--    Google sign-in) would otherwise sit there indefinitely.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'nora-handoff-sweep',
  '*/5 * * * *',
  $$ delete from public.auth_handoffs where created_at < now() - interval '5 minutes' $$
);
