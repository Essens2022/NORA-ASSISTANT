// Deliver a notification to all of a user's devices; disable dead subscriptions.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { NotificationPayload } from './core/index.ts';
import { ensureSecret, getSecret } from './secrets.ts';
import { generateVapidKeys, sendWebPush, type VapidKeys } from './webpush.ts';

let vapidCache: VapidKeys | null = null;

/** VAPID keys from env or Vault; generated and stored on first use (no manual setup). */
export async function getVapid(admin: SupabaseClient): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@nora.app';
  const envPub = Deno.env.get('VAPID_PUBLIC_KEY');
  const envPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (envPub && envPriv) {
    vapidCache = { publicKey: envPub, privateKey: envPriv, subject };
    return vapidCache;
  }
  // the key pair must stay consistent: one JSON secret, created once (race-safe)
  const stored = (await getSecret(admin, 'nora_vapid_pair')) ?? (await ensureSecret(admin, 'nora_vapid_pair', JSON.stringify(await generateVapidKeys())));
  const pair = JSON.parse(stored) as { publicKey: string; privateKey: string };
  vapidCache = { publicKey: pair.publicKey, privateKey: pair.privateKey, subject };
  return vapidCache;
}

export async function pushToUser(admin: SupabaseClient, userId: string, payload: NotificationPayload | Record<string, unknown>, vapid: VapidKeys): Promise<{ sent: number; devices: number }> {
  const { data: devices } = await admin.from('devices').select('id, endpoint, keys').eq('user_id', userId).eq('kind', 'webpush').is('disabled_at', null);
  let sent = 0;
  await Promise.all(
    (devices ?? []).map(async (d) => {
      try {
        const r = await sendWebPush({ endpoint: d.endpoint, keys: d.keys }, payload, vapid, {
          urgency: (payload as NotificationPayload).sound === 'silent' ? 'low' : 'high',
          topic: (payload as NotificationPayload).tag,
        });
        if (r.ok) sent++;
        else if (r.gone) await admin.from('devices').update({ disabled_at: new Date().toISOString() }).eq('id', d.id);
        else console.warn(JSON.stringify({ event: 'push_failed', status: r.status }));
      } catch (err) {
        console.warn(JSON.stringify({ event: 'push_error', error: String(err) }));
      }
    }),
  );
  return { sent, devices: devices?.length ?? 0 };
}
