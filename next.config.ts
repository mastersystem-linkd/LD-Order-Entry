import type { NextConfig } from "next";

// The old `serverExternalPackages: ["@neondatabase/serverless", "ws"]` entry is
// gone with Neon. It existed solely because bundling `ws` stubbed the optional
// native `bufferutil`, leaving ws calling an undefined `bufferUtil.mask` and
// killing every interactive transaction. postgres.js is pure JS over a plain
// TCP socket, so that whole failure mode no longer exists.
const nextConfig: NextConfig = {};

export default nextConfig;
