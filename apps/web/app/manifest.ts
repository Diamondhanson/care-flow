import type { MetadataRoute } from "next";

/**
 * Web App Manifest (Next.js built-in metadata route). Makes CareFlow installable
 * as a standalone PWA. Colors are concrete hex from the slate theme tokens
 * (a manifest cannot reference CSS variables).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CareFlow — Hospital Operations",
    short_name: "CareFlow",
    description:
      "Hospital operations system and lightweight EMR — track patients from arrival through discharge and follow-up. Works offline.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    categories: ["medical", "productivity", "health"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
