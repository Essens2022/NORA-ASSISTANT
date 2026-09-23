-- "Call again": a reminder the user did not react to is repeated (kind 'nudge').
alter table public.reminders drop constraint reminders_kind_check;
alter table public.reminders add constraint reminders_kind_check
  check (kind in ('prep', 'departure', 'main', 'followup', 'snooze', 'nudge'));
