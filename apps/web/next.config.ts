import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared workspace package ships raw TypeScript (no build step), so Next
  // must transpile it like first-party source.
  transpilePackages: ["@careflow/shared"],
  async headers() {
    return [
      {
        // Never cache the service worker itself, so clients always pick up a new
        // version, and serve it with the correct JS content type.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
