import type { Metadata, Viewport } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "./theme-glass.css";
import "@/ui/planner/routing-method-comparison.css";
import { NativeShell } from "./NativeShell";
import { OfflineNavGuard } from "@/ui/nav/OfflineNavGuard";
import { SkipLink } from "@/ui/nav/SkipLink";
import { APPEARANCE_BOOT_SCRIPT, THEME_COLOR } from "@/ui/appearance/appearance";

/** Interface text uses Plus Jakarta Sans; headings use Outfit. */
const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--og-font-body",
  display: "swap",
});

const display = Outfit({
  subsets: ["latin"],
  variable: "--og-font-display",
  display: "swap",
});

/** Link previews use the app's own desktop screenshot. */
const SHARE_IMAGE = {
  url: "/screenshots/social-preview.png",
  width: 1200,
  height: 630,
  alt: "OpenGravel route planner with a sample motorcycle ride",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.OGV_PUBLIC_ORIGIN ?? "http://localhost:3000"),
  title: "OpenGravel",
  description: "Find the ride worth taking.",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "OpenGravel",
    statusBarStyle: "black-translucent",
    startupImage: [
      { url: "/splash/iphone-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone-1320x2868.png", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/ipad-1640x2360.png", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/splash/ipad-1668x2388.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/splash/ipad-2048x2732.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  openGraph: {
    title: "OpenGravel",
    description: "Find the ride worth taking.",
    siteName: "OpenGravel",
    type: "website",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenGravel",
    description: "Find the ride worth taking.",
    images: [SHARE_IMAGE.url],
  },
};

/**
 * `viewportFit: "cover"` is what makes the safe-area insets real (12 §12): the
 * compact bottom sheet pads itself with `env(safe-area-inset-bottom)`, and an
 * inset that is always `0` would put the commitment button under the home
 * indicator on a notched phone.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Day or Night follows the phone until the rider picks one in Settings; the
  // boot script then rewrites this to the chosen theme (appearance.ts).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.day },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.night },
  ],
};

const STYLE_RECOVERY_SCRIPT = `(function(){
var KEY="og-style-reload";
function recover(){try{var last=Number(sessionStorage.getItem(KEY)||0);if(Date.now()-last<30000)return;sessionStorage.setItem(KEY,String(Date.now()));}catch(e){return}location.reload();}
function isSheet(n){return n&&n.tagName==="LINK"&&/stylesheet/i.test(n.rel||"");}
window.addEventListener("error",function(e){if(isSheet(e.target))recover();},true);
window.addEventListener("load",function(){var links=document.querySelectorAll('link[rel="stylesheet"]');for(var i=0;i<links.length;i++){if(!links[i].sheet){recover();return;}}});
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="night" suppressHydrationWarning>
      <head>
        {/* Day or Night before first paint, so a Day rider never sees a dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        {/* Marks the iOS app before first paint, so its native styling never flashes in. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())document.documentElement.dataset.native='1'}catch(e){}",
          }}
        />
        {/* A stylesheet that fails to load (a restart mid-request, a dropped
            connection) would leave the page in browser-default styling (AQ-03).
            Reload once to fetch it again; the stamp stops a reload loop. */}
        <script
          dangerouslySetInnerHTML={{
            __html: STYLE_RECOVERY_SCRIPT,
          }}
        />
      </head>
      <body className={`${body.variable} ${display.variable}`}>
        <SkipLink />
        <NativeShell />
        {children}
        <OfflineNavGuard />
      </body>
    </html>
  );
}
