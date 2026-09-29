// Single source of truth for brand & product configuration.
// Rename the product here – never hardcode "NORA" in components.

const env = import.meta.env;
const flags = new Set(String(env.VITE_FEATURES ?? '').split(',').map((s) => s.trim()).filter(Boolean));

export const brand = {
  appName: 'NORA',
  /** Localised tagline lives in i18n (`brand.tagline`); this is the canonical English one. */
  tagline: "Tell me once. I'll remember.",
  // temporary, personal inbox until a dedicated support@ address exists for the app
  supportEmail: 'ionbondari16@gmail.com',
  urls: {
    privacy: '/privacy',
    terms: '/terms',
  },
} as const;

export const config = {
  supabaseUrl: String(env.VITE_SUPABASE_URL ?? ''),
  supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY ?? ''),
  apiUrl: String(env.VITE_API_URL || `${env.VITE_SUPABASE_URL ?? ''}/functions/v1/api`),
  // The "Web application" OAuth client (Google Cloud Console) - same one already
  // used server-side by Supabase's Google provider. Required for native Google
  // Sign-In on Android (Credential Manager needs it as the ID token's audience),
  // separate from the Android OAuth client (package name + SHA-1, registered in
  // the console only, never referenced from app code).
  googleWebClientId: String(env.VITE_GOOGLE_WEB_CLIENT_ID ?? ''),
};

export type Feature = 'google_login' | 'apple_login' | 'experimental_voice';

export function feature(name: Feature): boolean {
  return flags.has(name);
}

export const isConfigured = () => !!config.supabaseUrl && !!config.supabaseAnonKey;
