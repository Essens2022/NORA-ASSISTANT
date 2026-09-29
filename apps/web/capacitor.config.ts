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
    // Capacitor only treats a navigation as "inside the app" when the host
    // matches server.url exactly (Bridge.launchIntent, @capacitor/android).
    // Any redirect the live site issues on load (e.g. a canonical www/host
    // redirect) lands on a host it doesn't recognize, so it fires an
    // external ACTION_VIEW intent instead - kicking the whole session out
    // to the system browser (Chrome), address bar and all, on first launch.
    // Listing both forms here keeps any such redirect inside the WebView.
    allowNavigation: ['norakeep.com', '*.norakeep.com'],
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
    // Only Google is used (native sign-in, Credential Manager) - the other
    // providers' SDKs aren't bundled into the APK.
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
    },
  },
};

export default config;
