import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Neon serverless driver uses `ws` for its WebSocket transaction pool.
  // When Turbopack/webpack bundles `ws`, it stubs the optional native
  // `bufferutil` require as an empty object, so ws calls `bufferUtil.mask`
  // (undefined) and every interactive transaction dies with
  // "bufferUtil.mask is not a function". Keeping these packages external makes
  // Node require them normally at runtime (bufferutil is absent → ws uses its
  // pure-JS masker), so transactions (order create, stage updates) work.
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
};

export default nextConfig;
