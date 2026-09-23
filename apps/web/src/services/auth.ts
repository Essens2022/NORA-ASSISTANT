// Authentication (Supabase Auth). Email one-time code works inside installed
// PWAs (magic links would open the browser instead); Google / Apple are behind flags.

import { AuthClient, type Session } from '@supabase/auth-js';
import { config, isConfigured } from '../config/brand.ts';

export const auth: InstanceType<typeof AuthClient> | null = isConfigured()
  ? new AuthClient({
      url: `${config.supabaseUrl}/auth/v1`,
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      storageKey: 'nora.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    })
  : null;

export async function currentSession(): Promise<Session | null> {
  if (!auth) return null;
  const { data } = await auth.getSession();
  return data.session;
}

export async function accessToken(): Promise<string | null> {
  return (await currentSession())?.access_token ?? null;
}

export async function sendCode(email: string, meta: Record<string, string>) {
  if (!auth) throw new Error('not_configured');
  const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin, data: meta } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!auth) throw new Error('not_configured');
  const { data, error } = await auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signInWith(provider: 'google' | 'apple') {
  if (!auth) throw new Error('not_configured');
  const { error } = await auth.signInWithOAuth({ provider, options: { redirectTo: location.origin } });
  if (error) throw error;
}

export async function signOut() {
  await auth?.signOut();
}
