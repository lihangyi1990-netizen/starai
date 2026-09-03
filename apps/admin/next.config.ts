import type { NextConfig } from "next";

const adminAssetPrefix = process.env.ADMIN_ASSET_PREFIX || "";

/**
 * Keep the development graph separate from the production build output. The
 * web and admin apps are often run alongside a build command on the same
 * checkout; sharing `.next` can leave a live dev server pointing at a chunk
 * that the build has just replaced.
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
  return port ? `.next-dev-${port}` : ".next-dev";
}

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
  { key: "Surrogate-Control", value: "no-store" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "Vary", value: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url, Accept-Encoding" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.NODE_ENV === "development" ? developmentDistDir() : ".next",
  transpilePackages: ["@starai/shared-types"],
  ...(adminAssetPrefix ? { assetPrefix: adminAssetPrefix } : {}),
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/admin",
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
