import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the shared workspace package's raw TypeScript source.
  transpilePackages: ["@careflow/shared"],
};

export default nextConfig;
