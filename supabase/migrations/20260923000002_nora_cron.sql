-- Background scheduling: every minute pg_cron calls the `dispatch` edge function,
-- which sends due reminders, follow-ups and marks missed tasks.
-- Reminders live in the database, so nothing is lost when a server or the app restarts.
--
-- One-time setup (SQL editor), values are NOT committed to git:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'nora_project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'nora_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nora-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nora_project_url') || '/functions/v1/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nora_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
