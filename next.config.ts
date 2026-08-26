import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // El import de productos manda muchas filas por server action (default: 1MB).
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
