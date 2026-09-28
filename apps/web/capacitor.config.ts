import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.norakeep.app',
  appName: 'NORA',
  webDir: 'dist',
  // Load the live PWA directly, same as the previous TWA setup: the app
  // always shows the latest deploy (GitHub Pages) with no store update
  // needed for web-only changes. `dist` above is only a fallback bundled
  // asset directory Capacitor requires to exist; it is never actually
  // served while `server.url` is set.
  server: {
    url: 'https://norakeep.com',
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#F7F9FC',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#F7F9FC',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
