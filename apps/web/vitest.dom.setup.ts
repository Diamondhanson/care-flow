/**
 * Shared setup for the jsdom component-test project (vitest.dom.config.ts).
 *
 * jsdom provides window/document/localStorage, but a few browser APIs the app
 * touches are missing and are stubbed here. IndexedDB is deliberately NOT
 * stubbed: `services/localDb` detects its absence and degrades to memory-only,
 * which is exactly the hermetic behavior we want in tests.
 */
import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library drives updates through act(); make React treat this
// process as an act() environment (vitest doesn't set it the way jest does).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The Supabase env vars must be ABSENT so AuthProvider / syncQueue take their
// "backend not configured" paths (no network, no client construction).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// next-themes (and any prefers-* media query) needs matchMedia; jsdom has none.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // legacy API some libraries still call
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Base UI popups/dialogs may observe element sizes; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom implements neither scrolling nor pointer capture; focus management in
// dialog libraries calls these unconditionally.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

afterEach(() => {
  cleanup();
  // Each test seeds its own persisted state (outbox, conflicts, locale).
  window.localStorage.clear();
});
