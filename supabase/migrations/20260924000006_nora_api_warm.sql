-- Keep the api function warm so the first tap after a pause answers instantly
-- (no edge cold start). One tiny health request per minute.
select cron.schedule(
  'nora-api-warm',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nora_project_url') || '/functions/v1/api/v1/health',
    timeout_milliseconds := 10000
  );
  $$
);
