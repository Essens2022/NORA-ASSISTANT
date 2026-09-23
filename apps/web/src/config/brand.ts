// Single source of truth for brand & product configuration.
// Rename the product here – never hardcode "NORA" in components.

const env = import.meta.env;
const flags = new Set(String(env.VITE_FEATURES ?? '').split(',').map((s) => s.trim()).filter(Boolean));

export const brand = {
  appName: 'NORA',
  /** Localised tagline lives in i18n (`brand.tagline`); this is the canonical English one. */
  tagline: "Tell me once. I'll remember.",
  supportEmail: 'support@nora.app',
  urls: {
    privacy: '/privacy',
    terms: '/terms',
  },
} as const;

export const config = {
  supabaseUrl: String(env.VITE_SUPABASE_URL ?? ''),
  supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY ?? ''),
  apiUrl: String(env.VITE_API_URL || `${env.VITE_SUPABASE_URL ?? ''}/functions/v1/api`),
};

export type Feature = 'google_login' | 'apple_login' | 'experimental_voice';

export function feature(name: Feature): boolean {
  return flags.has(name);
}

export const isConfigured = () => !!config.supabaseUrl && !!config.supabaseAnonKey;
