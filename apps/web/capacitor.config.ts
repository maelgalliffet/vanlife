import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fr.galliffet.vanlife",
  appName: "Réservations Van",
  webDir: "dist",
  server: {
    // En production native, appeler directement l'API CloudFront
    url: undefined,
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
