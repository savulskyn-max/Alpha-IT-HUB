import type { NextConfig } from "next";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendBaseUrl}/api/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${backendBaseUrl}/health`,
      },
      {
        source: "/ping",
        destination: `${backendBaseUrl}/ping`,
      },
    ];
  },
};

export default nextConfig;
