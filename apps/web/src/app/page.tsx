import type { Metadata } from "next";
import LandingPageClient from "@/components/LandingPageClient";
import { getPublicSystemConfig } from "@/lib/public-config";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getPublicSystemConfig();
  const siteName = String(cfg.site_name || "tuna").trim();
  const title = String(cfg.home_meta_title || "").trim() || `${siteName} - 把 AI 变简单`;
  const description =
    String(cfg.home_meta_description || "").trim() ||
    String(cfg.site_description || "").trim() ||
    "一个账号完成对话、生图和视频创作。";

  return {
    title,
    description,
  };
}

export default function Page() {
  return <LandingPageClient />;
}
