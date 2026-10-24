import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppwritePing } from "@/components/appwrite-ping";
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

export const viewport: Viewport = { themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_HOST_INJECTIONS }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" />
      </head>
      <body className="min-h-screen">
        <AppwritePing />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
