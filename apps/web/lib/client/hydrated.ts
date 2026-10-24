"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False in the server HTML and during hydration, true once React handles events. Forms keep submit disabled
 * until then: a click that lands before hydration would otherwise submit natively and silently reload the page.
 */
export const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);
