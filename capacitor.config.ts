import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.delivroom.app',
  appName: 'Delivroom',
  webDir: 'dist',
  plugins: {
    BackgroundRunner: {
      // Runs runners/maxymo-scan.js in a separate JS context on a schedule.
      // The minimum honoured interval on Android is 15 min (WorkManager) and
      // ~20 min on iOS (BGTaskScheduler), regardless of what we ask for.
      label: 'com.delivroom.app.scanner',
      src: 'runners/maxymo-scan.js',
      event: 'scheduledScan',
      repeat: true,
      interval: 30,
      autoStart: true,
    },
  },
};

export default config;
