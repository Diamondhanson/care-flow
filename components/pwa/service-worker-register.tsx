"use client";

import { useEffect } from "react";

/**
 * Registers the CareFlow service worker (`/public/sw.js`) for installability and
 * offline support. Renders nothing. The worker is HMR-safe (network-first
 * navigations), so it is registered in all environments and offline behaviour
 * can be exercised straight from the dev server.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

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
