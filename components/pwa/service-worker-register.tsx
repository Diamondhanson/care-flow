"use client";

import { useEffect } from "react";

/**
 * Registers the CareFlow service worker (`/public/sw.js`) for installability and
 * offline support. Renders nothing.
 *
 * The worker is registered in PRODUCTION ONLY. In development it actively
 * unregisters any previously-installed worker and clears its caches. Reason:
 * `sw.js` serves everything under `/_next/static/` cache-first, but Turbopack's
 * dev chunk URLs are reused while their bytes change on every edit — so a cached
 * worker would feed React a STALE client bundle that hydrates against fresh SSR
 * HTML, producing hydration mismatches (e.g. the search trigger rendering with
 * outdated classes). Self-healing here means a developer who previously loaded
 * the app recovers automatically on the next dev load, no manual DevTools steps.
 *
 * To exercise offline behaviour, run a production build (`next build && next start`).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Dev: tear down any stale worker + caches so cached bundles can't cause
      // hydration mismatches against fresh SSR/Turbopack output.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => {
          console.warn("[CareFlow] service worker registration failed:", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
