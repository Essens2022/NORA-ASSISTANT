// Secrets: environment first (supabase secrets set …), then Supabase Vault
// (read through a service-role-only RPC). Cached per function instance.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const cache = new Map<string, string | null>();

export async function getSecret(admin: SupabaseClient, vaultName: string, envName?: string): Promise<string | null> {
  const env = envName ? Deno.env.get(envName) : undefined;
  if (env) return env;
  if (cache.has(vaultName)) return cache.get(vaultName)!;
  const { data, error } = await admin.rpc('nora_get_secret', { p_name: vaultName });
  const value = error ? null : ((data as string | null) ?? null);
  if (value) cache.set(vaultName, value);
  return value;
}

/** Store `value` unless a secret with this name exists; returns the stored value (race-safe). */
export async function ensureSecret(admin: SupabaseClient, vaultName: string, value: string): Promise<string> {
  const { data, error } = await admin.rpc('nora_ensure_secret', { p_name: vaultName, p_value: value });
  if (error || typeof data !== 'string') throw new Error(`secret_store_failed:${vaultName}`);
  cache.set(vaultName, data);
  return data;
}
