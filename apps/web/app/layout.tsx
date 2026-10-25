import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { CookieBanner } from "@/components/cookie-banner";
import { ErrorReporter } from "@/components/error-reporter";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Engram: memory you can prove", template: "%s · Engram" },
  description: "Verifiable, time-travelling memory for AI agents. Every memory is stored by meaning, chained by hash and replayable in time. Built on Appwrite VectorsDB.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: { title: "Engram: memory you can prove", description: "Verifiable, time-travelling memory for AI agents.", type: "website" },
};

// Netlify injects a promotional comment (plus a newline) into <head> on production domains. React 19
// cannot hydrate <head> with those extra nodes, so they are removed before the app's scripts run.
const STRIP_HOST_INJECTIONS = `(function(){var h=document.head;if(!h)return;for(var n=h.firstChild;n;){var x=n.nextSibling;if(n.nodeType===8||(n.nodeType===3&&!n.textContent.trim()))h.removeChild(n);n=x;}})();`;

// Self-hosted at build time by next/font: no request to Google from the visitor's browser, before or after consent.
// next/font keeps the real family names, so globals.css, canvas and SVG text that name them keep working.
const sans = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600"], display: "swap", variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap", variable: "--font-instrument-serif" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-jetbrains-mono" });

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce from proxy.ts. Reading request headers also renders every page per request, which a
  // nonce needs (cached HTML would carry a stale one).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: STRIP_HOST_INJECTIONS }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          {children}
          <CookieBanner />
        </Providers>
        <ErrorReporter />
      </body>
    </html>
  );
}
