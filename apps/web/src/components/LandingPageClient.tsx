"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  Clock3,
  Copy,
  Download,
  Headphones,
  ImageIcon,
  MessageCircle,
  Phone,
  Play,
  UserRound,
  X,
} from "lucide-react";
import { LoginModal } from "@/components/LoginModal";
import { SiteBrand, useSiteBranding } from "@/components/SiteBrand";
import { UILanguageSelector } from "@/components/UILanguageSelector";
import { useI18n } from "@/i18n/I18nProvider";
import { api, hasUserSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface GalleryItem {
  public_id: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags?: string[];
  is_featured?: boolean;
  like_count?: number;
}

const FALLBACK_GALLERY: GalleryItem[] = [
  {
    public_id: "landing-1",
    title: "未来城市视觉提案",
    prompt: "霓虹高楼、雨夜街道、电影感构图、超清细节",
    tags: ["视觉设计", "建筑"],
    is_featured: true,
    like_count: 128,
  },
  {
    public_id: "landing-2",
    title: "产品海报自动生成",
    prompt: "高端科技产品、玻璃材质、商业广告光效",
    tags: ["电商", "海报"],
    like_count: 96,
  },
  {
    public_id: "landing-3",
    title: "短视频脚本分镜",
    prompt: "30 秒品牌短片，分镜、旁白、镜头运动完整输出",
    tags: ["视频", "脚本"],
    like_count: 74,
  },
  {
    public_id: "landing-4",
    title: "角色设定草案",
    prompt: "东方幻想角色，服饰设定，三视图参考，情绪板",
    tags: ["角色", "插画"],
    is_featured: true,
    like_count: 151,
  },
  {
    public_id: "landing-5",
    title: "API 文档示例生成",
    prompt: "把模型能力、参数、错误码整理成可复制文档",
    tags: ["开发者", "API"],
    like_count: 63,
  },
  {
    public_id: "landing-6",
    title: "音乐封面概念",
    prompt: "电子音乐封面，强节奏，抽象几何，暗色商业风",
    tags: ["音乐", "封面"],
    like_count: 88,
  },
];

/**
 * Creation modes are the product's primary axis: users decide "what do I want
 * to make" before "which model". The homepage teaches this vocabulary and the
 * channel colors, so entering /app confirms an already-learned model instead of
 * presenting a new one. Naming here is authoritative — see
 * design-concept/APP-SPEC.md. Do not reintroduce 「聊天」/「图片」as synonyms.
 */
type ModeKey = "chat" | "image" | "video" | "audio" | "flow";

type ModeSpec = {
  key: ModeKey;
  label: string;
  icon: typeof MessageCircle;
  /** Channel color. The only color semantics in the product. */
  channel: string;
  model: string;
  /**
   * Indicative starting price only. The authoritative figure lives in the
   * catalog and on /app/pricing — keep this in sync or drop it rather than
   * letting it drift.
   */
  price: string;
  estimate: string;
  placeholder: string;
  params: { label: string; value: string }[];
};

function useModes(): ModeSpec[] {
  const { td } = useI18n();
  return useMemo(
    () => [
      {
        key: "chat",
        label: td("mode.chat", "对话"),
        icon: MessageCircle,
        channel: "#2563EB",
        model: "Claude Sonnet 4.5",
        price: td("landing.price.metered", "按用量计"),
        estimate: "0.08",
        placeholder: td("landing.placeholder.chat", "今天想聊点什么？"),
        params: [
          { label: td("landing.param.temperature", "风格"), value: td("landing.param.balanced", "平衡") },
          { label: td("landing.param.length", "长度"), value: td("landing.param.medium", "中") },
        ],
      },
      {
        key: "image",
        label: td("mode.image", "生图"),
        icon: ImageIcon,
        channel: "#059669",
        model: "nano-banana-pro",
        price: td("landing.price.perImage", "0.12/张"),
        estimate: "0.12",
        placeholder: td("landing.placeholder.image", "描述你想要的画面，越具体越好"),
        params: [
          { label: td("landing.param.ratio", "比例"), value: "1:1" },
          { label: td("landing.param.count", "数量"), value: "1" },
        ],
      },
      {
        key: "video",
        label: td("mode.video", "视频"),
        icon: Play,
        channel: "#7C3AED",
        model: "Seedance 2.0",
        price: td("landing.price.perClip", "1.80/条"),
        estimate: "1.80",
        placeholder: td("landing.placeholder.video", "描述镜头、动作和时长"),
        params: [
          { label: td("landing.param.duration", "时长"), value: td("landing.param.5s", "5 秒") },
          { label: td("landing.param.quality", "画质"), value: td("landing.param.hd", "高清") },
        ],
      },
      {
        key: "audio",
        label: td("mode.audio", "音频"),
        icon: Headphones,
        channel: "#EA580C",
        model: "MiniMax Speech",
        price: td("landing.price.perKChar", "0.03/千字"),
        estimate: "0.03",
        placeholder: td("landing.placeholder.audio", "写下要念的文字，或描述一段音乐"),
        params: [
          { label: td("landing.param.voice", "音色"), value: td("landing.param.voiceCalm", "沉稳女声") },
          { label: td("landing.param.speed", "语速"), value: "1.0x" },
        ],
      },
      {
        key: "flow",
        label: td("mode.flow", "工作流"),
        icon: Boxes,
        channel: "#475569",
        model: td("landing.model.canvas", "无限画布"),
        price: td("landing.price.perNode", "按节点计"),
        estimate: "0.50",
        placeholder: td("landing.placeholder.flow", "选一个模板开始，或从空白画布搭"),
        params: [{ label: td("landing.param.template", "模板"), value: td("landing.model.canvas", "无限画布") }],
      },
    ],
    [td],
  );
}

/** Key used to hand the hero draft over to the workbench composer. */
export const HERO_DRAFT_KEY = "tuna.heroDraft";

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}

function GalleryPreview({ item, index }: { item: GalleryItem; index: number }) {
  const { ts } = useI18n();
  const heightClass = ["h-64", "h-80", "h-56", "h-72", "h-96", "h-60"][index % 6];
  const mediaURL = item.media_url || item.cover_url || "";
  const poster = item.thumbnail_url || (item.cover_url && item.cover_url !== mediaURL ? item.cover_url : "");
  const isVideo = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
  const previewURL = isVideo ? withVideoPreviewTime(mediaURL) : mediaURL;
  const channel = isVideo ? "#7C3AED" : "#059669";
  return (
    <Link
      href={item.public_id.startsWith("landing-") ? "/app/gallery" : `/app/gallery/${item.public_id}`}
      className="mb-4 block break-inside-avoid overflow-hidden rounded-lg border border-line bg-white text-left transition-colors hover:border-line-firm focus-visible:border-line-firm"
    >
      <div className="relative">
        {/* Channel bar: tells you which mode produced this, using the same
            color the composer and the sidebar use. */}
        <span aria-hidden className="absolute inset-x-0 top-0 z-10 h-[3px]" style={{ background: channel }} />
        {isVideo && mediaURL ? (
          <div className={`${heightClass} relative overflow-hidden bg-ink`}>
            <video src={previewURL} poster={poster || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            <span className="absolute bottom-2 left-3 rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-ink">
              {ts("视频")}
            </span>
          </div>
        ) : mediaURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaURL} alt={item.title || ""} className="w-full object-cover" />
        ) : (
          <div className={`${heightClass} bg-sunk`} />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2">
          {item.is_featured && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-mid">{ts("精选")}</span>
          )}
          <h3 className="truncate text-sm font-medium text-ink">{item.title || ts("未命名作品")}</h3>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-6 text-ink-mid">
          {item.prompt || ts("点开可以看到完整提示词和模型设置，直接拿去改。")}
        </p>
        {(item.tags || []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(item.tags || []).slice(0, 3).map((tag) => (
              <span key={tag} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-soft">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

type CustomerServiceConfig = ReturnType<typeof useSiteBranding>;

function CustomerService({ config }: { config: CustomerServiceConfig }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const enabledValue: unknown = config.customer_service_enabled;
  const enabled =
    enabledValue === undefined ||
    !(enabledValue === false || enabledValue === 0 || String(enabledValue).toLowerCase() === "false");
  if (!enabled) return null;

  const title = config.customer_service_title || t("customerService.title");
  const name = config.customer_service_name || t("customerService.name");
  const subtitle = config.customer_service_subtitle || t("customerService.subtitle");
  const qrTip = config.customer_service_qr_tip || t("customerService.qrTip");
  const copyValue = async (label: string, value?: string) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  };
  const downloadQR = () => {
    if (!config.customer_service_qr_url) return;
    const link = document.createElement("a");
    link.href = config.customer_service_qr_url;
    link.download = "customer-service-qr";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("customerService.open")}
        className="fixed bottom-5 right-4 z-[80] flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-line bg-white p-1.5 text-ink transition-colors hover:border-line-firm sm:bottom-7 sm:right-7"
      >
        {config.customer_service_floating_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.customer_service_floating_image} alt={name} className="h-full w-full rounded object-contain" />
        ) : (
          <Headphones size={24} strokeWidth={1.5} />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-5"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("customerService.dialog")}
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-line bg-white text-ink sm:max-w-[390px] sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <div className="text-base font-semibold">{title}</div>
                <div className="mt-0.5 text-xs text-ink-soft">{subtitle}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded border border-line text-ink-mid transition-colors hover:border-line-firm"
                aria-label={t("common.close")}
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center gap-3 rounded-lg border border-line p-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded bg-sunk text-ink-soft">
                  {config.customer_service_avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.customer_service_avatar} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound size={22} strokeWidth={1.5} />
                  )}
                </div>
                <div className="text-sm font-medium">{name}</div>
              </div>

              {config.customer_service_qr_url && (
                <div className="text-center">
                  <div className="mx-auto w-fit rounded-lg border border-line p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={config.customer_service_qr_url} alt={qrTip} className="h-44 w-44 object-contain sm:h-48 sm:w-48" />
                  </div>
                  <div className="mt-2 text-xs text-ink-soft">{qrTip}</div>
                </div>
              )}

              <div className="space-y-2">
                {config.customer_service_phone && (
                  <button
                    type="button"
                    onClick={() => copyValue("phone", config.customer_service_phone)}
                    className="flex w-full items-center justify-between rounded-lg border border-line px-3.5 py-3 text-left transition-colors hover:border-line-firm"
                  >
                    <span className="flex items-center gap-3">
                      <Phone size={17} strokeWidth={1.5} className="text-ink-soft" />
                      <span>
                        <span className="block text-[11px] text-ink-soft">{t("customerService.phone")}</span>
                        <span className="text-sm font-medium">{config.customer_service_phone}</span>
                      </span>
                    </span>
                    {copied === "phone" ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} className="text-ink-soft" />}
                  </button>
                )}
                {config.customer_service_wechat && (
                  <button
                    type="button"
                    onClick={() => copyValue("wechat", config.customer_service_wechat)}
                    className="flex w-full items-center justify-between rounded-lg border border-line px-3.5 py-3 text-left transition-colors hover:border-line-firm"
                  >
                    <span className="flex items-center gap-3">
                      <MessageCircle size={17} strokeWidth={1.5} className="text-ink-soft" />
                      <span>
                        <span className="block text-[11px] text-ink-soft">{t("customerService.wechat")}</span>
                        <span className="text-sm font-medium">{config.customer_service_wechat}</span>
                      </span>
                    </span>
                    {copied === "wechat" ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} className="text-ink-soft" />}
                  </button>
                )}
                {config.customer_service_hours && (
                  <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3">
                    <Clock3 size={17} strokeWidth={1.5} className="text-ink-soft" />
                    <span>
                      <span className="block text-[11px] text-ink-soft">{t("customerService.hours")}</span>
                      <span className="text-sm font-medium">{config.customer_service_hours}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-line p-5 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-line py-2.5 text-sm font-medium transition-colors hover:border-line-firm"
              >
                {t("common.gotIt")}
              </button>
              <button
                type="button"
                onClick={downloadQR}
                disabled={!config.customer_service_qr_url}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={16} strokeWidth={1.5} />
                {t("customerService.downloadQR")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function LandingPageClient() {
  const { t, td } = useI18n();
  const router = useRouter();
  const { token, hydrate } = useAuthStore();
  const [showLogin, setShowLogin] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>(FALLBACK_GALLERY);
  const [activeMode, setActiveMode] = useState<ModeKey>("image");
  const [draft, setDraft] = useState("");
  const branding = useSiteBranding();
  const modes = useModes();
  const mode = modes.find((item) => item.key === activeMode) || modes[1];
  const { site_name, site_copyright, api_docs_enabled, api_docs_operations } = branding;
  const apiDocsVisible =
    api_docs_enabled !== false &&
    (!api_docs_operations ||
      Object.keys(api_docs_operations).length === 0 ||
      Object.values(api_docs_operations).some((value) => value !== false));
  const displayName = site_name || "tuna";
  const copyrightText = site_copyright || `© ${new Date().getFullYear()} ${displayName}. All rights reserved.`;

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("referral_code");
    if (code) setShowLogin(true);
  }, []);

  useEffect(() => {
    api<{ items: GalleryItem[] }>("/api/gallery?page_size=10")
      .then((r) => {
        if (r.items?.length) setGallery(r.items.slice(0, 10));
      })
      .catch(() => setGallery(FALLBACK_GALLERY));
  }, []);

  const enterAppOrLogin = (target?: ModeKey) => {
    const hasToken = token || hasUserSession();
    if (!hasToken) {
      setShowLogin(true);
      return;
    }
    if (!target) {
      router.push("/app");
      return;
    }
    router.push(target === "flow" ? "/app?section=workflows" : `/app?mode=${target}`);
  };

  /**
   * Carries the hero draft across the navigation. The workbench composer reads
   * this key on mount; if it has not been wired yet the draft is simply
   * ignored rather than lost silently mid-typing.
   */
  const startCreating = () => {
    const text = draft.trim();
    if (text) {
      try {
        window.sessionStorage.setItem(HERO_DRAFT_KEY, JSON.stringify({ mode: activeMode, prompt: text }));
      } catch {
        // Private mode / quota — entering the app still works without the draft.
      }
    }
    enterAppOrLogin(activeMode);
  };

  return (
    <div className="min-h-screen bg-white text-ink">
      <a
        href="#hero"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        {td("landing.skipToContent", "跳到主要内容")}
      </a>

      {/* ---------------- Nav ---------------- */}
      <header className="sticky top-0 z-50 border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-5 py-3 sm:px-8">
          {/* SiteBrand hardcodes `h-10 w-10 rounded-xl` on the badge; passing a
              smaller size or radius here loses to it in Tailwind's output order
              rather than overriding it, so match those values. */}
          <SiteBrand
            href="/"
            className="min-w-0 flex-1 gap-2 pr-1"
            nameClassName="text-base font-semibold text-ink"
            subtitleClassName="max-w-[130px] text-xs text-ink-soft sm:max-w-none"
            badgeClassName="h-10 w-10 rounded-xl text-sm"
          />
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/app/pricing"
              className="hidden rounded-lg px-3 py-2 text-sm text-ink-mid transition-colors hover:text-ink sm:inline-flex"
            >
              {td("landing.nav.pricing", "定价")}
            </Link>
            {apiDocsVisible && (
              <Link
                href="/app/api-docs"
                className="hidden rounded-lg px-3 py-2 text-sm text-ink-mid transition-colors hover:text-ink sm:inline-flex"
              >
                {t("landing.apiDocs")}
              </Link>
            )}
            {!token && (
              <button
                type="button"
                onClick={() => enterAppOrLogin()}
                className="rounded-lg px-3 py-2 text-sm text-ink-mid transition-colors hover:text-ink"
              >
                {t("landing.login")}
              </button>
            )}
            <button
              type="button"
              onClick={() => enterAppOrLogin()}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("landing.start")}
            </button>
            <UILanguageSelector compact />
          </div>
        </div>
      </header>

      {/* ---------------- Hero: a working composer, not a poster ---------------- */}
      <section id="hero" className="border-b border-line px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <h1 className="max-w-[18em] text-[28px] font-semibold leading-[1.3] tracking-tight sm:text-[42px]">
            {td("landing.hero.title", "一张创作桌，玩遍所有 AI。")}
          </h1>
          <p className="mt-4 max-w-[34em] text-[15px] leading-[1.8] text-ink-mid">
            {td(
              "landing.hero.desc",
              "对话、生图、视频、音频，都在这张桌子上。选一个，写下你想要的东西，就可以开始。",
            )}
          </p>

          <div className="mt-8 max-w-[760px] rounded-lg border border-line">
            {/* Step 1 — mode. The first-class choice: what do you want to make. */}
            <div
              role="tablist"
              aria-label={td("landing.hero.modeLabel", "选择创作模式")}
              className="flex overflow-x-auto border-b border-line"
            >
              {modes.map((item) => {
                const Icon = item.icon;
                const active = item.key === activeMode;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="hero-composer-panel"
                    id={`hero-tab-${item.key}`}
                    onClick={() => setActiveMode(item.key)}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${
                      active ? "font-medium text-ink" : "border-transparent text-ink-mid hover:text-ink"
                    }`}
                    style={active ? { borderBottomColor: item.channel } : undefined}
                  >
                    <Icon size={16} strokeWidth={1.5} style={active ? { color: item.channel } : undefined} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* One panel whose contents follow the selected mode. */}
            <div id="hero-composer-panel" role="tabpanel" aria-labelledby={`hero-tab-${mode.key}`}>
              {/* Step 2 — model, with the price right next to it. */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: mode.channel }} />
                  <span className="truncate font-medium">{mode.model}</span>
                  <span className="shrink-0 tabular-nums text-ink-soft">{mode.price}</span>
                </div>
                {/* The model picker lives in the workbench; there is no /app/models
                    index route, so this enters the app in the current mode. */}
                <button
                  type="button"
                  onClick={() => enterAppOrLogin(activeMode)}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-mid transition-colors hover:border-line-firm hover:text-ink"
                >
                  {td("landing.hero.switchModel", "换模型")}
                </button>
              </div>

              {/* Step 3 — write it. */}
              <div className="px-4 pt-4">
                <label className="sr-only" htmlFor="hero-composer">
                  {td("landing.hero.composerLabel", "写下你的需求")}
                </label>
                <textarea
                  id="hero-composer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      startCreating();
                    }
                  }}
                  rows={3}
                  placeholder={mode.placeholder}
                  className="w-full resize-none rounded-lg border border-line bg-white px-3.5 py-3 text-sm leading-[1.8] text-ink placeholder:text-ink-soft focus:border-line-firm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  style={{ ["--tw-ring-color" as string]: mode.channel }}
                />
              </div>

              {/* Common parameters stay visible; the long tail lives in the app. */}
              <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                {mode.params.map((param) => (
                  <span key={param.label} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-mid">
                    {param.label} <span className="text-ink">{param.value}</span>
                  </span>
                ))}
                <span className="text-xs text-ink-soft">{td("landing.hero.moreInApp", "更多设置在创作台里")}</span>
              </div>

              {/* Step 4 — the cost is on the button, before you commit. */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                <p className="text-xs text-ink-soft">{td("landing.hero.enterHint", "按 Enter 开始，Shift + Enter 换行")}</p>
                <button
                  type="button"
                  onClick={startCreating}
                  className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  {td("landing.hero.start", "开始创作")}
                  <span className="ml-2 tabular-nums opacity-70">
                    {td("landing.hero.estimate", "预计 {value}", { value: mode.estimate })}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- What you get, and what it costs ---------------- */}
      <section className="border-b border-line px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">
            {td("landing.capability.title", "五种模式，一份算力余额")}
          </h2>
          <p className="mt-3 max-w-[34em] text-sm leading-[1.8] text-ink-mid">
            {td("landing.capability.desc", "下面是每个模式的默认模型和起步价。实际价格以定价页和模型目录为准。")}
          </p>

          <ul className="mt-8 border-t border-line">
            {modes.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMode(item.key);
                      document.getElementById("hero")?.scrollIntoView({ block: "start" });
                    }}
                    className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-sunk"
                  >
                    <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: item.channel }} />
                    <Icon size={18} strokeWidth={1.5} className="shrink-0 text-ink-mid" />
                    <span className="w-16 shrink-0 text-sm font-medium">{item.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-mid">{item.model}</span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-mid">{item.price}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <Link
            href="/app/pricing"
            className="mt-6 inline-flex rounded-lg border border-line px-4 py-2 text-sm text-ink-mid transition-colors hover:border-line-firm hover:text-ink"
          >
            {td("landing.capability.pricingLink", "看完整定价")}
          </Link>
        </div>
      </section>

      {/* ---------------- Works: an entry point, not a showcase ---------------- */}
      <section className="border-b border-line px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">
                {td("landing.gallery.title", "别人在这张桌上做出来的")}
              </h2>
              <p className="mt-3 max-w-[34em] text-sm leading-[1.8] text-ink-mid">
                {td("landing.gallery.desc", "点开任意一张，可以看到完整提示词和模型设置，直接拿去改。")}
              </p>
            </div>
            <Link
              href="/app/gallery"
              className="shrink-0 self-start rounded-lg border border-line px-4 py-2 text-sm text-ink-mid transition-colors hover:border-line-firm hover:text-ink sm:self-auto"
            >
              {t("landing.viewAll")}
            </Link>
          </div>
          <div className="mt-8 columns-1 gap-4 sm:columns-2 lg:columns-3">
            {gallery.map((item, index) => (
              <GalleryPreview key={item.public_id} item={item} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Three steps, told plainly ---------------- */}
      <section className="border-b border-line px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">
            {td("landing.steps.title", "三步就能拿到结果")}
          </h2>
          <p className="mt-3 max-w-[34em] text-sm leading-[1.8] text-ink-mid">
            {td("landing.steps.desc", "不用先学会调参。写下你要什么，需要选的地方 tuna 会问你。")}
          </p>
          <div className="mt-8 grid gap-px bg-line sm:grid-cols-3">
            {[
              [td("landing.steps.1.title", "说人话写需求"), td("landing.steps.1.desc", "用平常聊天的方式描述目标，也可以直接丢参考图进来。")],
              [td("landing.steps.2.title", "挑模型和参数"), td("landing.steps.2.desc", "数量、比例、清晰度和语言，按选中模型能做到的范围给选项。")],
              [td("landing.steps.3.title", "拿走或接着改"), td("landing.steps.3.desc", "预览后可以下载、发到灵感广场，或者送进下一个环节继续加工。")],
            ].map(([title, desc]) => (
              <div key={title} className="bg-white p-5 sm:p-6">
                <div className="text-sm font-medium">{title}</div>
                <p className="mt-2 text-sm leading-[1.8] text-ink-mid">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="border-b border-line px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">{td("landing.cta.title", "桌子已经摆好了")}</h2>
          <p className="mt-3 max-w-[34em] text-sm leading-[1.8] text-ink-mid">
            {td("landing.cta.desc", "充多少用多少，余额不清零，五个模式共用一份算力。")}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => enterAppOrLogin()}
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {td("landing.cta.enter", "进入创作台")}
            </button>
            <Link
              href="/app/gallery"
              className="rounded-lg border border-line px-5 py-2.5 text-sm text-ink-mid transition-colors hover:border-line-firm hover:text-ink"
            >
              {td("landing.cta.browse", "先看看别人的作品")}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-4 text-xs text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="break-words">{copyrightText}</div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/app/pricing" className="transition-colors hover:text-ink">
              {td("landing.nav.pricing", "定价")}
            </Link>
            {apiDocsVisible && (
              <Link href="/app/api-docs" className="transition-colors hover:text-ink">
                {t("landing.apiDocs")}
              </Link>
            )}
            <Link href="/terms" className="transition-colors hover:text-ink">
              {td("landing.nav.terms", "服务条款")}
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-ink">
              {td("landing.nav.privacy", "隐私政策")}
            </Link>
          </nav>
        </div>
      </footer>

      <CustomerService config={branding} />
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
