import type { NextConfig } from "next";

/**
 * Next loads this config before it assigns the CLI port to process.env.PORT.
 * Read an explicitly supplied -p/--port so parallel dev servers do not share
 * the same webpack output directory. Keep the historical directory for the
 * default 3000 server to avoid unnecessary cache churn for the normal command.
 */
function devPortFromArgs() {
  const args = process.argv.slice(2);
  const flagIndex = args.findIndex((arg) => arg === "-p" || arg === "--port");
  if (flagIndex >= 0) {
    const value = Number(args[flagIndex + 1]);
    if (Number.isInteger(value) && value > 0 && value < 65536) return value;
  }
  const inline = args.find((arg) => arg.startsWith("--port="))?.slice("--port=".length);
  const value = Number(inline || process.env.PORT || "");
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

function developmentDistDir() {
  const explicit = process.env.NEXT_DIST_DIR?.trim();
  if (explicit) return explicit;
  const port = devPortFromArgs();
  if (!port || port === 3000) return ".next-dev";
  return `.next-dev-${port}`;
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep hot-reload graphs isolated from production builds and from parallel
  // dev servers. Running build/dev processes against one directory can leave
  // the browser in a short window where a route chunk has been deleted.
  distDir: process.env.NODE_ENV === "development" ? developmentDistDir() : ".next",
  transpilePackages: ["@starai/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  async rewrites() {
    const apiBaseURL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/+$/, "");
    // Production uses the same-domain reverse proxy for /v1. In local mode,
    // make the address shown in PICO (`localhost:3000/v1`) work the same way.
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiBaseURL)) return [];
    return [
      // Keep browser API calls same-origin in local development. This avoids
      // cross-port/CORS failures in embedded browsers while preserving the
      // existing `/api/*` contract used by the client.
      { source: "/api/:path*", destination: `${apiBaseURL}/api/:path*` },
      { source: "/v1/:path*", destination: `${apiBaseURL}/v1/:path*` },
      // Gemini-compatible clients use the native `/v1beta` surface. Without
      // this rule the address shown in API management is handled by Next's
      // page router and returns a misleading 404 in local deployments.
      { source: "/v1beta/:path*", destination: `${apiBaseURL}/v1beta/:path*` },
    ];
  },
  async headers() {
    const noStoreHeaders = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
      { key: "Surrogate-Control", value: "no-store" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
      { key: "Vary", value: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url, Accept-Encoding" },
    ];

    return [
      { source: "/", headers: noStoreHeaders },
      { source: "/app/:path*", headers: noStoreHeaders },
      { source: "/auth/:path*", headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
