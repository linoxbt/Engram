"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/client/report";

/** Catches errors no boundary saw: script errors and unhandled promise rejections. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError("error", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportError("unhandledrejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
