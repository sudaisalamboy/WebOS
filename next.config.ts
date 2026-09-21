import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Dev-server memory tuning. Turbopack's in-memory cache grows unbounded and
  // gets OOM-killed on this 4GB box, which restarts the dev server (the site
  // "restarts on its own"). These limits keep the compiler's heap in check.
  // (Production builds use `next build` and aren't affected by these.)
  experimental: {
    turbopack: {
      // Cap the persistent memory cache so it doesn't exhaust the cgroup.
      memoryLimit: 512,
    },
  },
};

export default nextConfig;
