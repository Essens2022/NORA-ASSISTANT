// Deliver a notification to all of a user's devices; disable dead subscriptions.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { NotificationPayload } from './core/index.ts';
import { sendWebPush, type VapidKeys } from './webpush.ts';

export function vapidFromEnv(): VapidKeys | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@nora.app' };
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
