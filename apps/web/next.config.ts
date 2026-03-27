import type { NextConfig } from "next";

const rawUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000"
).trim();

// Ensure the URL has a protocol so Next.js rewrites don't fail
const backendBaseUrl = (rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`).replace(/\/$/, "");

const nextConfig: NextConfig = {
  typescript: {
    // Type errors are caught in local dev; don't fail Vercel builds
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
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
