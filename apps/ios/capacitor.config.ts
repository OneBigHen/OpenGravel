import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();
const server = serverUrl === undefined || serverUrl === ""
  ? { errorPath: "offline.html" }
  : (() => {
      const url = new URL(serverUrl);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        throw new Error("CAPACITOR_SERVER_URL must use HTTPS, except for localhost development.");
      }
      return {
        url: url.toString(),
        allowNavigation: [url.host],
        errorPath: "offline.html",
      };
    })();

const config: CapacitorConfig = {
  appId: "org.onebighen.opengravel",
  appName: "OpenGravel",
  webDir: "www",
  server,
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
    scheme: "OpenGravel",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#243a35",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
    },
  },
};

export default config;
