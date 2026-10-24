"use client";
import { openCookieSettings } from "@/lib/client/consent";

export function CookieSettingsLink({ className = "" }: { className?: string }) {
  return <button type="button" onClick={openCookieSettings} className={className}>Cookie settings</button>;
}
