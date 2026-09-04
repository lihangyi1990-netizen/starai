"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import {
  ArrowUp,
  Bell,
  ChevronDown,
  Check,
  Copy,
  Download,
  History,
  Image as ImageIcon,
  Menu,
  MessageCircle,
  Mic,
  Plus,
  Settings2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { ModelCategoryIcon } from "./CategoryIcon";
import { api, API_URL, clearClientAuth, clientAuthSnapshot, hasUserSession, legacyAuthHeaders, uploadAsset } from "@/lib/api";
import { publicError, publicText } from "@/lib/publicText";
import type { Model } from "@starai/shared-types";
import {
  buildAudioTaskParams,
  buildVideoTaskParams,
  EMPTY_VIDEO_MEDIA,
  canonicalVideoSize,
  isSizeBasedVideoProfile,
  normalizeSizeBasedVideoParams,
  parseAudioRuntime,
  parseVideoRuntime,
  schemaDefaultsFromFields,
  type VideoMediaState,
} from "@starai/shared-types";
import { useNotificationPolling } from "@/hooks/useNotificationPolling";
import { useNotificationStore } from "@/store/notifications";
import { WorkbenchUserMenu } from "@/components/WorkbenchUserMenu";
import { UILanguageSelector } from "@/components/UILanguageSelector";
import { useI18n } from "@/i18n/I18nProvider";
import { notificationTitle } from "@/lib/notificationText";
import { CATEGORY_TAG, isStandaloneAudioModel } from "./categoryMeta";
import { SchemaForm, schemaDefaults, schemaProperties } from "./SchemaForm";
import { ChatTopTools, type BottomBarState } from "./BottomBar";
import { AudioOptionToolbar, AudioTopControls } from "./audio/AudioOptionToolbar";
import { AudioUploadButton } from "./audio/AudioUploadButton";
import { VideoUploadArea } from "./video/VideoUploadArea";
import { VideoOptionToolbar, VideoTopControls } from "./video/VideoOptionToolbar";
import {
  ImageGenerationToolbar,
  buildImageGenerationParams,
  normalizeCustomImageDimensions,
  normalizeTier,
} from "./ImageGenerationToolbar";
import { GenerationLanguageMenu, buildLanguageParams, useGenerationLanguages } from "./GenerationLanguageMenu";

interface Message {
  role: "user" | "assistant";
  content: string;
  reasoning_content?: string;
}

type MultiModelResult = {
  model_code: string;
  display_name: string;
  icon_url?: string;
  content: string;
  error?: { code: string; message: string };
};

type MultiCollabSnapshot = {
  type: "multi_collab";
  summary: string;
  results: MultiModelResult[];
};

function defaultImageSizeForConfig(runtimeRule: Model["runtime_rule"], defaultParams: Model["default_params"]) {
  const runtimeQuality = (runtimeRule as any)?.image?.default_quality;
  const defaultQuality = (defaultParams as any)?.quality ?? (defaultParams as any)?.image_size;
  return normalizeTier(String(runtimeQuality ?? defaultQuality ?? "1K").toUpperCase());
}

function parseMultiCollabSnapshot(content: string): MultiCollabSnapshot | null {
  try {
    const data = JSON.parse(content) as Partial<MultiCollabSnapshot>;
    if (data?.type === "multi_collab") {
      return {
        type: "multi_collab",
        summary: typeof data.summary === "string" ? data.summary : "",
        results: Array.isArray(data.results)
          ? data.results
              .filter((x) => x && typeof x.model_code === "string")
              .map((x) => ({
                model_code: String(x.model_code),
                display_name: String(x.display_name || x.model_code),
                icon_url: typeof x.icon_url === "string" ? x.icon_url : undefined,
                content: typeof x.content === "string" ? x.content : "",
                error:
                  x.error && typeof x.error === "object"
                    ? { code: String((x.error as { code?: string }).code || ""), message: String((x.error as { message?: string }).message || "") }
                    : undefined,
              }))
          : [],
      };
    }
  } catch {
    /* legacy plain-text assistant message */
  }
  return null;
}

type RefImage = { url: string; name: string; public_id?: string };
type VideoResult = { url: string; thumbnail?: string };

function singleResultAudioSchema(schema: Model["input_schema"]) {
  const source = (schema ?? {}) as Record<string, unknown>;
  const properties = { ...((source.properties as Record<string, unknown> | undefined) ?? {}) };
  delete properties.count;
  delete properties.n;
  return { ...source, properties };
}

function singleResultAudioParams(params: Record<string, unknown>) {
  const next = { ...params };
  delete next.count;
  delete next.n;
  return next;
}

function sizeBasedVideoSchema(schema: Model["input_schema"], runtimeRule: Model["runtime_rule"], defaults: Model["default_params"]) {
  if (!isSizeBasedVideoProfile(runtimeRule)) return schema;
  const source = (schema ?? {}) as Record<string, unknown>;
  const properties = { ...((source.properties as Record<string, any> | undefined) ?? {}) };
  const profile = String((runtimeRule as any)?.video?.upload_profile || "").toLowerCase();
  const sizeField = { ...(properties.size || {}) };
  const legacyField = properties.aspect_ratio || properties.orientation || properties.ratio || {};
  const defaultSize = canonicalVideoSize(
    sizeField.default ?? defaults?.size ?? legacyField.default ?? defaults?.aspect_ratio ?? defaults?.orientation ?? defaults?.ratio
  );
  delete properties.aspect_ratio;
  delete properties.orientation;
  delete properties.ratio;
  const sizes = profile === "omni_reference"
    ? ["1280x720", "720x1280"]
    : ["1280x720", "720x1280", "1920x1080", "1080x1920"];
  properties.size = {
    ...sizeField,
    type: "string",
    title: "视频尺寸",
    enum: sizes,
    enumLabels: {
      "1280x720": "横屏 720P",
      "720x1280": "竖屏 720P",
      ...(profile === "omni_reference" ? {} : { "1920x1080": "横屏 1080P", "1080x1920": "竖屏 1080P" }),
    },
    default: sizes.includes(defaultSize) ? defaultSize : sizes[0],
    "x-widget": "option_menu",
    "x-icon": "ratio",
  };
  return { ...source, properties };
}

type HistoryItem = {
  id: string;
  kind: "chat" | "task";
  mediaType?: "image" | "video" | "audio";
  title?: string | null;
  updated_at: string;
  status?: string;
};

type ChannelPreset = {
  key: string;
  name: string;
  model_codes?: string[];
  answer_model_codes?: string[];
  summary_model_codes?: string[];
  is_fallback_enabled?: boolean;
};

type ModelBadge = { code: string; icon?: string; label: string };
type ChatModelOption = {
  code: string;
  display_name: string;
  icon_url?: string;
  description?: string;
  /** Keep publication state in the picker so pending catalog entries are explicit. */
  is_enabled?: boolean;
  price_rule?: Model["price_rule"];
};

/**
 * A model can be present in the catalog before an operator publishes a retail
 * price. Such entries are useful in the picker, but must never result in a
 * request. Treat an explicit disabled flag and every non-published pricing
 * state as pending; legacy/manual models with no pricing status keep their
 * historical enabled behaviour.
 */
export function isModelCallable(model: Pick<Model, "is_enabled" | "price_rule"> | ChatModelOption) {
  if (model.is_enabled === false) return false;
  const status = String((model.price_rule as Record<string, unknown> | undefined)?.pico_pricing_status || "")
    .trim()
    .toLowerCase();
  return !status || status === "published";
}

function modelPendingLabel(model: Pick<Model, "is_enabled" | "price_rule"> | ChatModelOption) {
  if (model.is_enabled === false) return "待管理员发布";
  const status = String((model.price_rule as Record<string, unknown> | undefined)?.pico_pricing_status || "")
    .trim()
    .toLowerCase();
  return status && status !== "published" ? "待管理员发布" : "暂不可用";
}

const MODEL_PENDING_MESSAGE = "该模型尚未开放使用，请稍后再试。";

function normalizeModelCodes(codes?: string[]) {
  const seen = new Set<string>();
  return (codes || [])
    .map((code) => (typeof code === "string" ? code.trim() : ""))
    .filter((code) => {
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function BadgeCircle({ badge, size = 28 }: { badge: ModelBadge; size?: number }) {
  const dim = { width: size, height: size };
  if (badge.icon) {
    return (
      <div className="rounded-full border-2 border-white bg-gray-100 overflow-hidden flex items-center justify-center" style={dim} title={badge.label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badge.icon} alt={badge.label} className="w-full h-full object-cover" />
      </div>
    );
  }
  const initial = (badge.label || badge.code || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="rounded-full border-2 border-white bg-primary/15 text-primary font-semibold flex items-center justify-center"
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={badge.label}
    >
      {initial}
    </div>
  );
}

const OUTPUT_FORMAT_INSTRUCTION =
  "Use structured Markdown in the answer: start with a short title (# or ##), organize the body into clear paragraphs, and use ##/### headings, lists, bold text, and code blocks when helpful. Do not output raw HTML.";

const UI_TEXT = {
  copied: "\u5df2\u590d\u5236",
  copy: "\u590d\u5236",
  copyContent: "\u590d\u5236\u5185\u5bb9",
  generating: "\u751f\u6210\u4e2d...",
  thinking: "\u601d\u8003\u4e2d...",
  summaryGenerating: "\u6c47\u603b\u751f\u6210\u4e2d...",
  noSummary: "\u6682\u65e0\u6c47\u603b",
  waitingModel: "\u6b63\u5728\u7b49\u5f85\u6a21\u578b\u54cd\u5e94...",
  imageUnit: "\u5f20",
  requestFailed: "\u8bf7\u6c42\u5931\u8d25",
  taskStatus: "\u4efb\u52a1\u72b6\u6001",
  statusPending: "\u7b49\u5f85\u4e2d",
  statusRunning: "\u751f\u6210\u4e2d",
  statusSucceeded: "\u5df2\u5b8c\u6210",
  statusFailed: "\u751f\u6210\u5931\u8d25",
  statusCancelled: "\u5df2\u53d6\u6d88",
  generatedImages: "\u751f\u6210\u7ed3\u679c",
  noImageResult: "\u4efb\u52a1\u5df2\u5b8c\u6210\uff0c\u4f46\u672a\u8fd4\u56de\u53ef\u663e\u793a\u7684\u56fe\u7247\u5730\u5740\u3002",
  imageLoadFailed: "\u56fe\u7247\u5730\u5740\u65e0\u6cd5\u8bbf\u95ee\uff0c\u8bf7\u68c0\u67e5 API/MinIO \u6216\u751f\u6210\u670d\u52a1\u662f\u5426\u542f\u52a8\u3002",
  openImage: "\u6253\u5f00\u539f\u56fe",
  downloadImage: "\u4e0b\u8f7d\u56fe\u7247",
  historyEmpty: "\u6682\u65e0\u5386\u53f2\u8bb0\u5f55",
  count: "\u6570\u91cf",
  chooseCount: "\u9009\u62e9\u751f\u6210\u6570\u91cf",
  customCount: "\u81ea\u5b9a\u4e49\u6570\u91cf",
  aspectRatio: "\u5c3a\u5bf8\u6bd4\u4f8b",
  chooseAspectRatio: "\u9009\u62e9\u56fe\u7247\u6bd4\u4f8b",
  quality: "\u8d28\u91cf",
  chooseQuality: "\u9009\u62e9\u56fe\u7247\u8d28\u91cf",
};

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "pending") return UI_TEXT.statusPending;
  if (normalized === "running" || normalized === "runing" || normalized === "processing") return UI_TEXT.statusRunning;
  if (normalized === "succeeded" || normalized === "success") return UI_TEXT.statusSucceeded;
  if (normalized === "failed" || normalized === "error") return UI_TEXT.statusFailed;
  if (normalized === "cancelled" || normalized === "canceled") return UI_TEXT.statusCancelled;
  return status;
}

function isSucceededStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "succeeded" || normalized === "success";
}

function isFailedStatus(status: string) {
  const normalized = status.toLowerCase();
  // Canceled tasks are terminal too; leaving them in the polling loop makes a
  // history item appear permanently active after the backend has finished it.
  return normalized === "failed" || normalized === "error" || normalized === "cancelled" || normalized === "canceled";
}

function fallbackProgress(status: string, current = 0) {
  const normalized = status.toLowerCase();
  if (normalized === "pending") return Math.max(current, 8);
  if (normalized === "running" || normalized === "runing" || normalized === "processing") return Math.max(current, 28);
  if (isSucceededStatus(normalized)) return 100;
  if (normalized === "failed" || normalized === "error" || normalized === "cancelled" || normalized === "canceled") return current;
  return current;
}

function latestProgressFromEvents(events: unknown[]) {
  let latest = -1;
  for (const item of events) {
    const event = item as { payload?: Record<string, unknown> };
    const raw = event?.payload?.progress;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) latest = Math.max(latest, Math.min(100, Math.max(0, n)));
  }
  return latest;
}

function collectURLs(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectURLs(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...collectURLs(record.url),
      ...collectURLs(record.image_url),
      ...collectURLs(record.b64_json),
      ...collectURLs(record.output_url),
      ...collectURLs(record.thumbnail),
    ];
  }
  return [];
}

function normalizeImageSrc(src: string) {
  const value = src.trim();
  if (!value) return "";
  if (/^(https?:|data:image\/|blob:)/i.test(value)) return value;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100) {
    return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
  }
  return value;
}

function collectVideoResults(value: unknown): VideoResult[] {
  if (!value) return [];
  if (typeof value === "string") {
    const url = value.trim();
    return url ? [{ url }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectVideoResults(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = collectURLs(record.url)[0] || collectURLs(record.video_url)[0] || collectURLs(record.result_url)[0] || "";
    if (!url) return [];
    const thumbnail = collectURLs(record.thumbnail)[0] || collectURLs(record.cover_url)[0] || collectURLs(record.poster_url)[0] || undefined;
    return [{ url, thumbnail }];
  }
  return [];
}

function extractTaskOutput(output?: Record<string, unknown> | null) {
  if (!output) return { videoURLs: [] as VideoResult[], audioURL: "", imageURLs: [] as string[] };
  const videoURLs = [
    ...collectVideoResults(output.video_url),
    ...collectVideoResults(output.videos),
    ...collectVideoResults(output.results),
    ...collectVideoResults(output.data),
  ].filter((item, idx, arr) => item.url && arr.findIndex((x) => x.url === item.url) === idx);
  const audioURL = collectURLs(output.audio_url)[0] || "";
  const imageURLs = [
    ...collectURLs(output.image_url),
    ...collectURLs(output.b64_json),
    ...collectURLs(output.images),
    ...collectURLs(output.urls),
    ...collectURLs(output.results),
    ...collectURLs(output.data),
  ].map(normalizeImageSrc).filter((url, idx, arr) => url && arr.indexOf(url) === idx);
  return { videoURLs, audioURL, imageURLs };
}

function TaskMediaVideo({ src, className }: { src: string; className?: string }) {
  const { t } = useI18n();
  const [playSrc, setPlaySrc] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const needsAuth = /\/api\/tasks\/[^/]+\/media\b/.test(src);
    if (!needsAuth) {
      setPlaySrc(src);
      setLoading(false);
      return;
    }
    let objectURL = "";
    setLoading(true);
    fetch(src, { headers: legacyAuthHeaders(), credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectURL = URL.createObjectURL(blob);
        setPlaySrc(objectURL);
      })
      .catch(() => setPlaySrc(""))
      .finally(() => setLoading(false));
    return () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [src]);
  if (loading) return <div className="text-sm text-gray-500 py-8">{t("workspace.videoLoading")}</div>;
  if (!playSrc) return <div className="text-sm text-red-500 py-8">{t("workspace.videoLoadFailed")}</div>;
  return <video src={playSrc} controls className={className} />;
}

function ModelMediaResultGrid({
  type,
  images = [],
  videos = [],
}: {
  type: "image" | "video";
  images?: string[];
  videos?: VideoResult[];
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const items = type === "video" ? videos.map((item) => item.url).filter(Boolean) : images.filter(Boolean);
  const visibleItems = items;
  const count = visibleItems.length;
  const gridClass =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : count === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  const mediaHeight = count <= 1 ? "h-[210px] sm:h-[240px] lg:h-[260px]" : "h-[150px] sm:h-[170px] lg:h-[190px]";

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [preview]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl p-3 sm:p-4" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{t("workspace.generationResult")}</div>
      </div>
      <div className={`grid ${gridClass} gap-2 sm:gap-3`}>
        {visibleItems.map((url, idx) => (
          <ModelMediaResultCard
            key={`${url}-${idx}`}
            url={url}
            type={type}
            index={idx}
            mediaHeight={mediaHeight}
            onPreview={(nextURL, nextType) => setPreview({ url: nextURL, type: nextType })}
          />
        ))}
      </div>
      {preview && createPortal(
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[200] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className={`relative flex max-h-[calc(100dvh-2rem)] w-full items-center justify-center overflow-hidden rounded-2xl bg-black ${preview.type === "video" ? "max-w-6xl" : "max-w-4xl"}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-xl text-gray-900" style={{ border: "1px solid var(--pico-premium-line)", background: "rgba(255,255,255,0.9)" }} aria-label={t("common.close")}><X size={16} /></button>
            {preview.type === "video" ? (
              <TaskMediaVideo src={preview.url} className="h-auto max-h-[82dvh] w-full object-contain" />
            ) : (
              <div className="relative flex max-h-[82dvh] w-full items-center justify-center">
                <button
                  type="button"
                  className="absolute left-3 top-3 z-20 flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-gray-900"
                  style={{ border: "1px solid var(--pico-premium-line)", background: "rgba(255,255,255,0.9)" }}
                  title={t("workspace.downloadImage")}
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadImage(preview.url, "starai-image.png");
                  }}
                >
                  <Download size={15} />
                  {t("common.download")}
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt="" className="h-auto max-h-[82dvh] w-auto max-w-full object-contain" />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ModelMediaPendingGrid({ type, count }: { type: "image" | "video"; count: number }) {
  const { t } = useI18n();
  const safeCount = Math.min(8, Math.max(1, Math.round(Number(count) || 1)));
  const placeholders = Array.from({ length: safeCount });
  const gridClass =
    safeCount <= 1
      ? "grid-cols-1"
      : safeCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : safeCount === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  const mediaHeight = safeCount <= 1 ? "h-[210px] sm:h-[240px] lg:h-[260px]" : "h-[150px] sm:h-[170px] lg:h-[190px]";
  return (
    <div className="rounded-2xl p-3 sm:p-4" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{t("workspace.generationResult")}</div>
      <div className={`grid ${gridClass} gap-2 sm:gap-3`}>
        {placeholders.map((_, idx) => (
          <div key={idx} className="rounded-2xl p-2.5" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--pico-premium-muted)" }}>#{idx + 1}</span>
              <span className="text-xs text-amber-600">{t("status.running")}</span>
            </div>
            <div className={`result-scan rounded-xl ${mediaHeight} flex items-center justify-center overflow-hidden`} style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)" }}>
              <div className="px-4 text-center text-sm" style={{ color: "var(--pico-premium-muted)" }}>
                {type === "video" ? t("workspace.videoGenerating") : t("workspace.imageGenerating")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelMediaResultCard({
  url,
  type,
  index,
  mediaHeight,
  onPreview,
}: {
  url: string;
  type: "image" | "video";
  index: number;
  mediaHeight: string;
  onPreview: (url: string, type: "image" | "video") => void;
}) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [url]);
  return (
    <div className="relative rounded-2xl p-2.5 transition" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
      <span className="absolute left-2 top-2 z-10 h-3 w-3 rounded-sm" style={{ background: type === "video" ? "var(--pico-ch-video)" : "var(--pico-ch-image)" }} aria-hidden="true" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: "var(--pico-premium-muted)" }}>#{index + 1}</span>
        <span className="text-xs text-emerald-600">{t("status.succeeded")}</span>
      </div>
      <div className={`rounded-xl ${mediaHeight} flex items-center justify-center overflow-hidden`} style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)" }}>
        {type === "video" ? (
          <div className="relative h-full w-full bg-black flex items-center justify-center">
            <TaskMediaVideo src={url} className="h-full w-full bg-black object-contain" />
            <button type="button" onClick={() => onPreview(url, "video")} className="absolute right-2 top-2 z-20 rounded-lg border border-white/20 bg-gray-950/85 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-900">{t("common.preview")}</button>
          </div>
        ) : !imageFailed ? (
          <div className="relative h-full w-full">
            <button type="button" onClick={() => onPreview(url, "image")} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Generated result ${index + 1}`} onError={() => setImageFailed(true)} className="w-full h-full object-contain" />
            </button>
            <button
              type="button"
              className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-gray-950/85 text-white hover:bg-gray-900"
              title={t("workspace.downloadImage")}
              onClick={(e) => {
                e.stopPropagation();
                downloadImage(url, `starai-image-${index + 1}.png`);
              }}
            >
              <Download size={15} />
            </button>
          </div>
        ) : (
          <div className="px-4 text-center text-sm" style={{ color: "var(--pico-premium-muted)" }}>{t("workspace.imageLoadFailed")}</div>
        )}
      </div>
    </div>
  );
}

function downloadImage(src: string, filename: string) {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = src;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  if (typeof document === "undefined") return Promise.resolve();
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

function compactCostNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number >= 100 ? number.toFixed(0) : number >= 1 ? number.toFixed(2) : number.toFixed(4);
}

const TIPS_DISMISSED_KEY = "starai_tips_dismissed";

const EXAMPLE_PROMPTS: Record<"chat" | "image" | "video", string[]> = {
  chat: [
    "用不超过 100 字介绍一下这周的科技新闻",
    "帮我把这句话翻译成正式的英文邮件用语：「附件是我们这季度的报表，请查收」",
    "写一段祝朋友生日快乐的话，带点冷幽默",
  ],
  image: [
    "一只戴眼镜的橘猫坐在书桌前看书，暖色台灯，写实风格",
    "极简几何风格的演示封面，留出标题位置，蓝白配色",
    "手写感标题的活动海报，暖光实拍背景，竖版 3:4",
  ],
  video: [
    "一只猫在雨中的城市街道奔跑，慢镜头，电影感，5 秒",
    "无人机航拍海边悬崖日出，橙紫渐变天空，10 秒",
    "一杯咖啡被缓缓搅拌，特写镜头，蒸汽升腾，3 秒",
  ],
};

/** Mirrors ModelPlaza.tsx's priceSummary() but formatted for the compact generate-button label. */
function estimatedCostLabel(model: Model): string | null {
  const rule = model.price_rule as unknown as Record<string, unknown> | undefined;
  if (!rule) return null;
  const unit = typeof rule.currency === "string" && rule.currency.trim() ? rule.currency.trim() : "算力";
  switch (rule.billing_type) {
    case "per_image": {
      const value = compactCostNumber(rule.unit_price);
      return value ? `${value} ${unit}/张` : null;
    }
    case "per_request": {
      const value = compactCostNumber(rule.unit_price);
      return value ? `${value} ${unit}/次` : null;
    }
    case "per_second": {
      const value = compactCostNumber(rule.unit_price);
      return value ? `${value} ${unit}/秒` : null;
    }
    default:
      return null;
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} className="font-semibold text-gray-950">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key} className="px-1.5 py-0.5 rounded-md bg-gray-100 text-[0.92em] text-gray-800">{part.slice(1, -1)}</code>;
    }
    return <span key={key}>{part}</span>;
  });
}

function RichMarkdown({ content, emptyText }: { content: string; emptyText?: string }) {
  const text = content.trim() || emptyText || "";
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];

  const pushParagraph = (parts: string[], key: string) => {
    const body = parts.join(" ").trim();
    if (!body) return;
    nodes.push(
      <p key={key} className="my-2 text-[15px] leading-7 text-gray-700">
        {renderInlineMarkdown(body, key)}
      </p>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`code-${i}`} className="my-3 overflow-x-auto rounded-2xl bg-gray-950 px-4 py-3 text-xs leading-6 text-gray-100">
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const body = heading[2].replace(/#+$/, "").trim();
      if (level === 1) {
        nodes.push(<h1 key={`h1-${i}`} className="mb-3 mt-1 text-xl font-bold leading-8 text-gray-950">{body}</h1>);
      } else if (level === 2) {
        nodes.push(<h2 key={`h2-${i}`} className="mb-2 mt-5 text-lg font-bold leading-7 text-gray-950">{body}</h2>);
      } else {
        nodes.push(<h3 key={`h3-${i}`} className="mb-2 mt-4 text-base font-semibold leading-6 text-gray-900">{body}</h3>);
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      i--;
      nodes.push(
        <ul key={`ul-${i}`} className="my-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-gray-700">
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ul-${i}-${idx}`)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      i--;
      nodes.push(
        <ol key={`ol-${i}`} className="my-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-7 text-gray-700">
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ol-${i}-${idx}`)}</li>)}
        </ol>
      );
      continue;
    }

    if (line.startsWith(">")) {
      const quote = line.replace(/^>\s?/, "");
      nodes.push(
      <blockquote key={`quote-${i}`} className="my-3 rounded-2xl border-l-4 border-primary/60 bg-primary/5 px-4 py-3 text-sm leading-7 text-gray-700">
          {renderInlineMarkdown(quote, `quote-${i}`)}
        </blockquote>
      );
      continue;
    }

    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(#{1,3})\s+/.test(lines[i + 1].trim()) &&
      !/^[-*]\s+/.test(lines[i + 1].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i + 1].trim()) &&
      !lines[i + 1].trim().startsWith(">") &&
      !lines[i + 1].trim().startsWith("```")
    ) {
      paragraph.push(lines[i + 1].trim());
      i++;
    }
    pushParagraph(paragraph, `p-${i}`);
  }

  return <div className="rich-output min-w-0">{nodes}</div>;
}

function CopyOutputButton({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  const { t } = useI18n();
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition"
      style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel)", color: "var(--pico-premium-muted)" }}
      onClick={onCopy}
      title={copied ? t("common.copied") : t("common.copyContent")}
      aria-label={copied ? t("common.copied") : t("common.copyContent")}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  );
}

interface Props {
  model: Model;
  conversationScope?: string;
  initialPrompt?: string;
  models?: Model[];
  workflows?: Array<{ code: string; name: string; description?: string; icon?: string }>;
  onSelectModel?: (code: string) => void;
  onSelectWorkflow?: (code: string) => void;
  onOpenModelPicker?: (category?: string) => void;
  onOpenNav?: () => void;
  onRecharge?: () => void;
  /** The premium shell owns account actions in its global top bar. */
  hideWorkspaceAccountActions?: boolean;
}

/** Right-side input toolbar meta, aligned to h-9 controls. */
function InputToolbarMeta() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-end justify-center gap-0.5 shrink-0 h-9">
      <span className="text-[10px] leading-none text-gray-300 whitespace-nowrap">{t("workspace.shiftEnter")}</span>
    </div>
  );
}

export function ModelWorkspace({
  model,
  conversationScope = "current-user",
  initialPrompt,
  models = [],
  workflows = [],
  onSelectModel,
  onSelectWorkflow,
  onOpenModelPicker,
  onOpenNav,
  onRecharge,
  hideWorkspaceAccountActions = false,
}: Props) {
  const { t, td, ts } = useI18n();
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState("");
  const [mmMode, setMmMode] = useState(false);
  const [mmActiveTab, setMmActiveTab] = useState<"answer" | "summary">("answer");
  const [mmResults, setMmResults] = useState<MultiModelResult[]>([]);
  const [mmSummary, setMmSummary] = useState<string>("");
  const [copiedOutputKey, setCopiedOutputKey] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState("");
  const [taskError, setTaskError] = useState("");
  const [taskOutput, setTaskOutput] = useState<string | null>(null);
  const [taskImages, setTaskImages] = useState<string[]>([]);
  const [taskVideos, setTaskVideos] = useState<VideoResult[]>([]);
  const [taskProgress, setTaskProgress] = useState(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuCategory, setModelMenuCategory] = useState<"chat" | "image" | "video" | "audio">("chat");
  const [modelMenuTab, setModelMenuTab] = useState<"models" | "workflows">("models");
  const [params, setParams] = useState<Record<string, unknown>>(() => ({
    ...(model.category === "video" || model.category === "audio"
      ? { ...(model.default_params || {}), ...schemaDefaultsFromFields(model.input_schema) }
      : { ...schemaDefaults(model.input_schema), ...(model.default_params || {}) }),
  }));
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [videoMedia, setVideoMedia] = useState<VideoMediaState>(EMPTY_VIDEO_MEDIA);
  const [audioSecondaryPrompt, setAudioSecondaryPrompt] = useState("");
  const [audioRef, setAudioRef] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bottom, setBottom] = useState<BottomBarState>({
    channel_key: typeof model.default_params?.channel_key === "string" && model.default_params.channel_key !== "price_first" ? model.default_params.channel_key : "success_first",
    fallback_enabled: true,
    web_search: false,
    timeout_sec: 30,
    asset_ids: [],
    files: [],
  });
  const [deepThink, setDeepThink] = useState(false);
  const [menuWallet, setMenuWallet] = useState<{ compute_balance?: number } | null>(null);
  const conversationStorageKey = `starai:active-conversation:${conversationScope}:${model.code}`;
  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof window === "undefined" || !hasUserSession()) return "";
    try {
      return window.localStorage.getItem(conversationStorageKey) || "";
    } catch {
      return "";
    }
  });
  const [tipsDismissed, setTipsDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(TIPS_DISMISSED_KEY) === "1";
    } catch {
      return true;
    }
  });
  const dismissTips = () => {
    setTipsDismissed(true);
    try {
      window.localStorage.setItem(TIPS_DISMISSED_KEY, "1");
    } catch {
      // ignore storage failures (private mode, quota)
    }
  };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequestRef = useRef(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const historyLoadingMoreRef = useRef(false);
  const historyAnchorRef = useRef<HTMLDivElement>(null);
  const [historyPanelPosition, setHistoryPanelPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    listMaxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  // Multi-model responses are rendered in a separate result panel rather than
  // as ordinary assistant bubbles. Keep a request-only copy so a restored
  // conversation still carries earlier answers into the next prompt.
  const chatContextRef = useRef<Message[]>([]);
  const chatRunRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const taskPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskRunRef = useRef(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<
    { id: number; title: string; content: string; type?: string; is_read: boolean; created_at: string }[]
  >([]);
  const unread = useNotificationStore((s) => s.unread);
  const setUnread = useNotificationStore((s) => s.setUnread);
  const decrementUnread = useNotificationStore((s) => s.decrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifNeedLogin, setNotifNeedLogin] = useState(false);
  const [channelPresets, setChannelPresets] = useState<ChannelPreset[]>([]);
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  const [selectedAnswerCodes, setSelectedAnswerCodes] = useState<string[]>([]);
  const [selectedSummaryCode, setSelectedSummaryCode] = useState("");
  const [selectionChannelKey, setSelectionChannelKey] = useState("");
  const [customSelectionEnabled, setCustomSelectionEnabled] = useState(false);
  const [draftAnswerCodes, setDraftAnswerCodes] = useState<string[]>([]);
  const [draftSummaryCode, setDraftSummaryCode] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelSelectionError, setModelSelectionError] = useState("");
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [imageCount, setImageCount] = useState(1);
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [imageCustomWidth, setImageCustomWidth] = useState("");
  const [imageCustomHeight, setImageCustomHeight] = useState("");
  const { languages: generationLanguages, selectedCode: languageCode, setSelectedCode: setLanguageCode, selectedLanguage } = useGenerationLanguages();
  const bottomRef = useRef<HTMLDivElement>(null);
  const cancelActiveChat = useCallback(() => {
    chatRunRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
  }, []);
  // IMPORTANT:
  // Your project uses a "pseudo model" for multi-collab chat (seeded as code=multi_collab_chat),
  // and historically it was still under category="chat". So multi-collab mode must be detected by code too,
  // otherwise we'd accidentally downgrade it to single-chat UI and break channel/timeout + mm SSE.
  const isMultiCollab = model.category === "multi_collab" || model.code === "multi_collab_chat";
  const isChatSingle = model.category === "chat" && !isMultiCollab;
  const isChat = isChatSingle || isMultiCollab;
  const isImage = model.category === "image";
  const isVideo = model.category === "video";
  const isAudio = model.category === "audio";
  const currentPreset = useMemo(
    () => (isMultiCollab ? channelPresets.find((preset) => preset.key === bottom.channel_key) : undefined),
    [isMultiCollab, channelPresets, bottom.channel_key]
  );
  const presetAnswerCodes = useMemo(
    () => normalizeModelCodes(currentPreset?.answer_model_codes?.length ? currentPreset.answer_model_codes : currentPreset?.model_codes),
    [currentPreset]
  );
  const presetSummaryCodes = useMemo(() => normalizeModelCodes(currentPreset?.summary_model_codes), [currentPreset]);
  const activeAnswerCodes = useMemo(
    () => selectionChannelKey === bottom.channel_key && selectedAnswerCodes.length > 0 ? selectedAnswerCodes : presetAnswerCodes,
    [selectionChannelKey, bottom.channel_key, selectedAnswerCodes, presetAnswerCodes]
  );
  const activeSummaryCode =
    selectionChannelKey === bottom.channel_key && selectedSummaryCode ? selectedSummaryCode : presetSummaryCodes[0] || "";
  const workbenchInputSchema = useMemo(
    () => (isAudio ? singleResultAudioSchema(model.input_schema) : sizeBasedVideoSchema(model.input_schema, model.runtime_rule, model.default_params)),
    [isAudio, model.input_schema, model.runtime_rule, model.default_params]
  );
  const hasSchemaFields = Object.keys(schemaProperties(workbenchInputSchema)).length > 0;
  const tag = CATEGORY_TAG[model.category] || { label: model.category, labelKey: `modelCategory.${model.category}`, className: "bg-gray-100 text-gray-600" };
  const modelName = publicText(td(`model.${model.code}.name`, model.display_name), "未命名模型");
  const activeCreationMode: "chat" | "image" | "video" | "audio" = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "chat";
  const modelPending = !isModelCallable(model);
  const inlineModels = useMemo(
    () => {
      // Keep the active model in the picker even when a parent intentionally
      // passes only callable models. This lets a direct link show a pending
      // catalog entry and explain why submission is disabled.
      const source = models.some((item) => item.code === model.code) ? models : [model, ...models];
      return source.filter((item) => {
        if (modelMenuCategory === "chat") return item.category === "chat" || item.category === "multi_collab";
        if (modelMenuCategory === "audio") return isStandaloneAudioModel(item);
        return item.category === modelMenuCategory;
      });
    },
    [model, models, modelMenuCategory],
  );
  const openInlineModelMenu = (category: "chat" | "image" | "video" | "audio") => {
    if (onSelectModel) {
      setModelMenuCategory(category);
      setModelMenuTab("models");
      setModelMenuOpen(true);
      return;
    }
    onOpenModelPicker?.(category);
  };
  const modelCategoryLabel = td(`modelCategory.${model.category}`, t(tag.labelKey), { category: model.category });
  const caps = (model.runtime_rule as any)?.capabilities || {};
  const capWebSearch = !!caps.web_search;
  const capDeepThink = !!caps.deep_think;
  const reasoningConfig = ((model.runtime_rule as any)?.reasoning || {}) as Record<string, unknown>;
  const rawMaxRefImages = (model.runtime_rule as any)?.image?.max_reference_images ?? (model.default_params as any)?.max_reference_images;
  const maxRefImages = Math.max(
    0,
    Math.min(
      20,
      rawMaxRefImages === undefined || rawMaxRefImages === null || rawMaxRefImages === "" ? 4 : Number(rawMaxRefImages) || 0
    )
  );
  const videoConfig = parseVideoRuntime(model.runtime_rule);
  const audioConfig = parseAudioRuntime(model.runtime_rule);
  const isSeedance2 = isVideo && videoConfig.upload_profile === "seedance_2";
  const isMiniMaxH3 = isVideo && videoConfig.upload_profile === "minimax_h3";
  const isVeoReference = isVideo && videoConfig.upload_profile === "veo_reference";
  const videoAdapter = String((model.runtime_rule as any)?.upstream?.adapter || "").toLowerCase();
  const veoIdentity = `${model.code} ${model.display_name}`.toLowerCase();
  const isLegacyVeoFlFramePair =
    videoConfig.upload_profile === "frame_pair" &&
    /(^|[-_\s])veo($|[-_\s\d])/.test(veoIdentity) &&
    /(^|[-_\s])fl($|[-_\s])/.test(veoIdentity);
  const isVeoFramePair =
    isVideo &&
    (videoConfig.upload_profile === "veo_frame_pair" ||
      videoAdapter === "veo_frame_pair_v1" ||
      isLegacyVeoFlFramePair);
  const isFramePairUpload =
    isVideo && (videoConfig.upload_profile === "frame_pair" || isVeoFramePair);
  const videoUploadConfig = isVeoFramePair
    ? {
        ...videoConfig,
        upload_profile: "veo_frame_pair" as const,
        min_reference_images: 0,
        max_reference_images: 0,
        reference_images: { ...(videoConfig.reference_images || {}), max: 0 },
      }
    : videoConfig;
  const isOmniReference = isVideo && videoConfig.upload_profile === "omni_reference";
  const isEnhancedVideoMaterial = isSeedance2 || isMiniMaxH3 || isVeoReference || isOmniReference;
  const videoMaterialMode = String(params[videoConfig.mode_param || "generation_mode"] || "text");
  const veoFirstFrameAssets = useMemo(
    () => (videoMedia.first_frame ? [videoMedia.first_frame] : []),
    [videoMedia.first_frame]
  );
  const veoLastFrameAssets = useMemo(
    () => (videoMedia.last_frame ? [videoMedia.last_frame] : []),
    [videoMedia.last_frame]
  );
  const videoTaskMedia = useMemo(
    () => (isVeoFramePair ? { ...videoMedia, reference_images: [] } : videoMedia),
    [isVeoFramePair, videoMedia]
  );
  const videoRequestParams = useMemo(
    () => normalizeSizeBasedVideoParams(params, model.runtime_rule),
    [params, model.runtime_rule]
  );
  const maxVideoAssetRefs =
    videoConfig.upload_profile === "frame_pair"
      ? videoConfig.reference_images?.max ?? 4
      : videoConfig.max_reference_images ?? 1;
  const promptPlaceholder = isChat
    ? t("workspace.placeholder.chat")
    : isVideo
    ? (videoConfig.prompt_hint ? ts(videoConfig.prompt_hint) : t("workspace.placeholder.video"))
    : isAudio
    ? (audioConfig.prompt_hint ? ts(audioConfig.prompt_hint) : t("workspace.placeholder.audio"))
    : t("workspace.placeholder.image");
  const referenceAssetIds = useMemo(
    () =>
      [
        ...refImages.map((x) => x.public_id),
        videoMedia.first_frame?.public_id,
        videoMedia.last_frame?.public_id,
        ...(!isVeoFramePair ? videoMedia.reference_images.map((x) => x.public_id) : []),
        ...videoMedia.reference_videos.map((x) => x.public_id),
        ...videoMedia.reference_audios.map((x) => x.public_id),
      ].filter((x): x is string => !!x),
    [
      refImages,
      isVeoFramePair,
      videoMedia.first_frame,
      videoMedia.last_frame,
      videoMedia.reference_images,
      videoMedia.reference_videos,
      videoMedia.reference_audios,
    ]
  );

  useEffect(() => {
    cancelActiveChat();
    setStreaming(false);
    taskRunRef.current += 1;
    if (taskPollRef.current !== null) {
      clearInterval(taskPollRef.current);
      taskPollRef.current = null;
    }
    historyRequestRef.current += 1;
    setHistoryOpen(false);
    setHistoryLoading(false);
    setHistoryItems([]);
    setHistoryError("");
    setHistoryPage(1);
    setHistoryHasMore(false);
    setHistoryLoadingMore(false);
    const secondaryKey = parseAudioRuntime(model.runtime_rule).secondary_prompt_key || "style_prompt";
    const defaults = model.default_params || {};
    setParams({
      ...(isVideo || isAudio
        ? { ...defaults, ...schemaDefaultsFromFields(workbenchInputSchema) }
        : { ...schemaDefaults(workbenchInputSchema), ...defaults }),
      ...(isAudio ? { count: undefined, n: undefined } : {}),
    });
    setRefImages([]);
    setVideoMedia(EMPTY_VIDEO_MEDIA);
    setAudioSecondaryPrompt(String(defaults[secondaryKey] ?? ""));
    setAudioRef(null);
    if (isImage) {
      setImageSize(defaultImageSizeForConfig(model.runtime_rule, defaults));
      setImageCustomWidth("");
      setImageCustomHeight("");
    }
    setBottom((prev) => ({
      ...prev,
      channel_key:
        typeof defaults.channel_key === "string" && defaults.channel_key && defaults.channel_key !== "price_first"
          ? defaults.channel_key
          : prev.channel_key === "price_first"
            ? "success_first"
            : prev.channel_key,
    }));
    setDeepThink(capDeepThink && reasoningConfig.default_enabled === true);
    setPrompt(initialPrompt || "");
  }, [cancelActiveChat, model.code, initialPrompt, isVideo, isAudio, isImage, workbenchInputSchema, model.default_params, model.runtime_rule, capDeepThink, reasoningConfig.default_enabled]);

  useEffect(() => {
    if (!isChat) return;
    api<{ items: ChannelPreset[] }>("/api/channel-presets")
      .then((r) => setChannelPresets((r.items || []).filter((preset) => preset.key !== "price_first")))
      .catch(() => setChannelPresets([]));
    api<Model[]>("/api/models?category=chat")
      .then((items) => {
        const options: ChatModelOption[] = [];
        for (const m of items || []) {
          if (m && typeof m.code === "string") {
            if (m.category === "chat" && m.code !== "multi_collab_chat") {
              options.push({
                code: m.code,
                display_name: m.display_name || m.code,
                icon_url: m.icon_url || undefined,
                description: m.description || undefined,
                is_enabled: m.is_enabled,
                price_rule: m.price_rule,
              });
            }
          }
        }
        setChatModels(options);
      })
      .catch(() => {
        setChatModels([]);
      });
  }, [isChat]);

  // Initialize the channel preset once per model. After this runs, the user is
  // free to switch presets via BottomBar without being forced back to default.
  const channelInitRef = useRef<string>("");
  useEffect(() => {
    if (!isMultiCollab || channelPresets.length === 0) return;
    if (channelInitRef.current === model.code) return;
    channelInitRef.current = model.code;
    const defaultKey =
      typeof model.default_params?.channel_key === "string" && model.default_params.channel_key !== "price_first"
        ? model.default_params.channel_key
        : "";
    const nextKey =
      defaultKey && channelPresets.some((p) => p.key === defaultKey)
        ? defaultKey
        : channelPresets.some((p) => p.key === bottom.channel_key)
          ? bottom.channel_key
          : channelPresets[0].key;
    if (nextKey && nextKey !== bottom.channel_key) {
      const preset = channelPresets.find((p) => p.key === nextKey);
      setBottom((prev) => ({ ...prev, channel_key: nextKey, fallback_enabled: preset?.is_fallback_enabled ?? prev.fallback_enabled }));
    }
  }, [isMultiCollab, channelPresets, model.code, model.default_params, bottom.channel_key]);

  const collabSelectionInitRef = useRef("");
  useEffect(() => {
    if (!isMultiCollab) {
      collabSelectionInitRef.current = "";
      return;
    }
    if (!currentPreset) return;
    const initKey = `${model.code}:${currentPreset.key}`;
    if (collabSelectionInitRef.current === initKey) return;
    collabSelectionInitRef.current = initKey;
    setSelectedAnswerCodes(presetAnswerCodes);
    setSelectedSummaryCode(presetSummaryCodes[0] || "");
    setSelectionChannelKey(currentPreset.key);
    setCustomSelectionEnabled(false);
  }, [isMultiCollab, currentPreset, model.code, presetAnswerCodes, presetSummaryCodes]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-starai-history]")) setHistoryOpen(false);
      if (!target.closest("[data-starai-notif]")) setNotifOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    return () => {
      cancelActiveChat();
      if (taskPollRef.current !== null) {
        clearInterval(taskPollRef.current);
        taskPollRef.current = null;
      }
      taskRunRef.current += 1;
    };
  }, [cancelActiveChat]);

  useNotificationPolling(!hideWorkspaceAccountActions);

  const openNotif = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next) return;
    if (!hasUserSession()) {
      setNotifNeedLogin(true);
      setNotifItems([]);
      setNotifLoading(false);
      return;
    }
    setNotifNeedLogin(false);
    setNotifLoading(true);
    api<{
      items: { id: number; title: string; content: string; type?: string; is_read: boolean; created_at: string }[];
      unread: number;
    }>("/api/notifications")
      .then((r) => {
        setNotifItems(r.items || []);
        setUnread(r.unread || 0);
      })
      .catch(() => {
        setNotifItems([]);
      })
      .finally(() => setNotifLoading(false));
  };

  const markNotifRead = async (id: number) => {
    const item = notifItems.find((n) => n.id === id);
    if (!item || item.is_read) return;
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      decrementUnread();
    } catch {
      /* ignore */
    }
  };

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      setNotifItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      clearUnread();
    } catch {
      /* ignore */
    }
  };

  const historyPageSize = 50;
  const mapChatHistory = (items: { public_id: string; title?: string | null; updated_at: string }[]) =>
    (items || []).map((item) => ({
      id: item.public_id,
      kind: "chat" as const,
      title: item.title,
      updated_at: item.updated_at,
    }));
  const mapTaskHistory = (
    items: Array<{
      task_no: string;
      type?: string;
      status: string;
      input?: Record<string, unknown>;
      created_at: string;
      finished_at?: string;
    }>,
    taskType: "image" | "video" | "audio"
  ) =>
    (items || []).map((item) => ({
      id: item.task_no,
      kind: "task" as const,
      mediaType: taskType,
      title:
        typeof item.input?.user_prompt === "string" && item.input.user_prompt.trim()
          ? item.input.user_prompt
          : typeof item.input?.prompt === "string" && item.input.prompt.trim()
            ? item.input.prompt
            : item.task_no,
      updated_at: item.finished_at || item.created_at,
      status: item.status,
    }));
  const appendUniqueHistory = (items: HistoryItem[]) => {
    setHistoryItems((current) => {
      const seen = new Set(current.map((item) => `${item.kind}:${item.id}`));
      return [...current, ...items.filter((item) => !seen.has(`${item.kind}:${item.id}`))];
    });
  };

  const loadHistory = async () => {
    const requestId = ++historyRequestRef.current;
    historyLoadingMoreRef.current = false;
    setHistoryLoading(true);
    setHistoryLoadingMore(false);
    setHistoryPage(1);
    setHistoryHasMore(false);
    setHistoryError("");
    setHistoryItems([]);

    try {
      if (isChat) {
        const items = await api<{ public_id: string; title?: string | null; updated_at: string }[]>(
          `/api/chat/conversations?model_code=${encodeURIComponent(model.code)}&page=1&page_size=${historyPageSize}`
        );
        if (requestId !== historyRequestRef.current) return;
        setHistoryItems(mapChatHistory(items || []));
        setHistoryHasMore((items || []).length >= historyPageSize);
      } else {
        // Keep the active media type in the list. Loading another media type
        // into this workspace would leave a result that the current renderer
        // cannot display (for example, a video selected in image mode).
        const taskType = isVideo ? "video" : isAudio ? "audio" : "image";
        const res = await api<{
          items: Array<{
            task_no: string;
            type?: string;
            status: string;
            input?: Record<string, unknown>;
            created_at: string;
            finished_at?: string;
          }>;
          total?: number;
        }>(`/api/tasks?model_code=${encodeURIComponent(model.code)}&type=${taskType}&page=1&page_size=${historyPageSize}`);
        if (requestId !== historyRequestRef.current) return;
        setHistoryItems(mapTaskHistory(res.items || [], taskType));
        setHistoryHasMore((res.items || []).length >= historyPageSize && 1 * historyPageSize < Number(res.total || 0));
      }
    } catch (err) {
      if (requestId !== historyRequestRef.current) return;
      setHistoryItems([]);
      setHistoryError(publicError(err, "历史记录加载失败，请稍后重试。"));
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!historyOpen || historyLoading || historyLoadingMoreRef.current || !historyHasMore) return;
    const requestId = historyRequestRef.current;
    const nextPage = historyPage + 1;
    historyLoadingMoreRef.current = true;
    setHistoryLoadingMore(true);
    setHistoryError("");
    try {
      if (isChat) {
        const items = await api<{ public_id: string; title?: string | null; updated_at: string }[]>(
          `/api/chat/conversations?model_code=${encodeURIComponent(model.code)}&page=${nextPage}&page_size=${historyPageSize}`
        );
        if (requestId !== historyRequestRef.current) return;
        appendUniqueHistory(mapChatHistory(items || []));
        setHistoryPage(nextPage);
        setHistoryHasMore((items || []).length >= historyPageSize);
      } else {
        const taskType = isVideo ? "video" : isAudio ? "audio" : "image";
        const res = await api<{
          items: Array<{
            task_no: string;
            type?: string;
            status: string;
            input?: Record<string, unknown>;
            created_at: string;
            finished_at?: string;
          }>;
          total?: number;
        }>(`/api/tasks?model_code=${encodeURIComponent(model.code)}&type=${taskType}&page=${nextPage}&page_size=${historyPageSize}`);
        if (requestId !== historyRequestRef.current) return;
        appendUniqueHistory(mapTaskHistory(res.items || [], taskType));
        setHistoryPage(nextPage);
        setHistoryHasMore((res.items || []).length >= historyPageSize && nextPage * historyPageSize < Number(res.total || 0));
      }
    } catch (err) {
      if (requestId === historyRequestRef.current) setHistoryError(publicError(err, "更多历史记录加载失败，请稍后重试。"));
    } finally {
      if (requestId === historyRequestRef.current) historyLoadingMoreRef.current = false;
      if (requestId === historyRequestRef.current) setHistoryLoadingMore(false);
    }
  };

  const openHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) {
      historyRequestRef.current += 1;
      historyLoadingMoreRef.current = false;
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
      setHistoryHasMore(false);
      return;
    }
    void loadHistory();
  };

  // The composer can sit near the top of a short media workspace, while a
  // long chat can push it close to the bottom of the viewport. Position the
  // portal against the action bar and clamp it to the available viewport
  // space so a long history list is always reachable and scrollable.
  const updateHistoryPanelPosition = useCallback(() => {
    if (!historyOpen || typeof window === "undefined") return;
    const anchor = historyAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const panelWidth = Math.min(380, Math.max(240, window.innerWidth - viewportPadding * 2));
    const maxPanelHeight = 538;
    const availableAbove = Math.max(0, rect.top - viewportPadding - gap);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap);
    const placeBelow = availableBelow >= 220 || availableBelow >= availableAbove;
    const available = placeBelow ? availableBelow : availableAbove;
    const panelHeight = Math.min(maxPanelHeight, Math.max(140, available));
    const desiredTop = placeBelow ? rect.bottom + gap : rect.top - gap - panelHeight;
    const top = Math.max(viewportPadding, Math.min(desiredTop, window.innerHeight - viewportPadding - panelHeight));
    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - panelWidth, window.innerWidth - viewportPadding - panelWidth)
    );
    setHistoryPanelPosition({
      left,
      top,
      width: panelWidth,
      maxHeight: panelHeight,
      listMaxHeight: Math.max(80, panelHeight - 60),
    });
  }, [historyOpen]);

  useLayoutEffect(() => {
    if (!historyOpen) {
      setHistoryPanelPosition(null);
      return;
    }
    updateHistoryPanelPosition();
    window.addEventListener("resize", updateHistoryPanelPosition);
    window.addEventListener("scroll", updateHistoryPanelPosition, true);
    return () => {
      window.removeEventListener("resize", updateHistoryPanelPosition);
      window.removeEventListener("scroll", updateHistoryPanelPosition, true);
    };
  }, [historyOpen, updateHistoryPanelPosition]);

  const resetWorkspace = useCallback(() => {
    // A reset starts a new client-side conversation/project. Existing server
    // records remain untouched and can still be opened from History.
    cancelActiveChat();
    setStreaming(false);
    taskRunRef.current += 1;
    if (taskPollRef.current !== null) {
      clearInterval(taskPollRef.current);
      taskPollRef.current = null;
    }
    setPrompt("");
    setMessages([]);
    setChatError("");
    setMmMode(false);
    setMmActiveTab("answer");
    setMmResults([]);
    setMmSummary("");
    setCopiedOutputKey(null);
    chatContextRef.current = [];
    setConversationId("");
    setTaskStatus("");
    setTaskError("");
    setTaskOutput(null);
    setTaskImages([]);
    setTaskVideos([]);
    setTaskProgress(0);
    setImageCustomWidth("");
    setImageCustomHeight("");
    setRefImages([]);
    setVideoMedia(EMPTY_VIDEO_MEDIA);
    setAudioSecondaryPrompt("");
    setAudioRef(null);
    setUploading(false);
    setBottom((current) => ({ ...current, asset_ids: [], files: [] }));
    setHistoryOpen(false);
    historyRequestRef.current += 1;
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    historyLoadingMoreRef.current = false;
    setHistoryPage(1);
    setHistoryHasMore(false);
    setHistoryError("");
  }, [cancelActiveChat]);

  const loadConversation = useCallback(async (publicId: string) => {
    cancelActiveChat();
    setStreaming(false);
    historyRequestRef.current += 1;
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    historyLoadingMoreRef.current = false;
    const runToken = ++taskRunRef.current;
    if (taskPollRef.current !== null) {
      clearInterval(taskPollRef.current);
      taskPollRef.current = null;
    }
    try {
      const conv = await api<{
        public_id: string;
        messages: { role: string; content: string; reasoning_content?: string }[];
      }>(`/api/chat/conversations/${publicId}`);
      if (taskRunRef.current !== runToken) return false;
      const raw = conv.messages || [];
      const displayMessages: Message[] = [];
      const contextMessages: Message[] = [];
      let restoredResults: MultiModelResult[] = [];
      let restoredSummary = "";

      for (const m of raw) {
        if (m.role === "user") {
          const message = { role: "user" as const, content: m.content };
          displayMessages.push(message);
          contextMessages.push(message);
          continue;
        }
        if (m.role !== "assistant") continue;
        if (isMultiCollab) {
          contextMessages.push({ role: "assistant", content: m.content, reasoning_content: m.reasoning_content });
          const snap = parseMultiCollabSnapshot(m.content);
          if (snap) {
            restoredSummary = snap.summary;
            restoredResults = snap.results;
          } else if (m.content.trim()) {
            // Legacy history: assistant content is plain summary text.
            restoredSummary = m.content;
          }
          continue;
        }
        const message = { role: "assistant" as const, content: m.content, reasoning_content: m.reasoning_content };
        displayMessages.push(message);
        contextMessages.push(message);
      }

      setMessages(displayMessages);
      chatContextRef.current = contextMessages;
      setPrompt("");
      setChatError("");
      if (isMultiCollab && (restoredSummary || restoredResults.length > 0)) {
        setMmMode(true);
        setMmResults(restoredResults);
        setMmSummary(restoredSummary);
        setMmActiveTab(restoredSummary ? "summary" : "answer");
      } else {
        setMmMode(false);
        setMmResults([]);
        setMmSummary("");
      }
      setConversationId(conv.public_id);
      setTaskStatus("");
      setTaskError("");
      setTaskOutput(null);
      setTaskImages([]);
      setTaskVideos([]);
      setHistoryOpen(false);
      return true;
    } catch (err) {
      if (taskRunRef.current === runToken) {
        setChatError(publicError(err, "历史对话加载失败，请稍后重试。"));
      }
      return false;
    }
  }, [cancelActiveChat, isMultiCollab]);

  const restoredConversationRef = useRef(false);
  useEffect(() => {
    if (!isChat || !conversationId || restoredConversationRef.current) return;
    restoredConversationRef.current = true;
    void loadConversation(conversationId).then((restored) => {
      if (!restored) {
        // Preserve the id after a transient failure so a later remount can
        // retry restoring the existing conversation.
        restoredConversationRef.current = false;
      }
    });
  }, [conversationId, isChat, loadConversation]);

  useEffect(() => {
    if (!isChat || typeof window === "undefined") return;
    try {
      if (conversationId) window.localStorage.setItem(conversationStorageKey, conversationId);
      else window.localStorage.removeItem(conversationStorageKey);
    } catch {
      /* storage can be unavailable in privacy mode */
    }
  }, [conversationId, conversationStorageKey, isChat]);

  const loadTaskHistory = async (taskNo: string) => {
    cancelActiveChat();
    setStreaming(false);
    historyRequestRef.current += 1;
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    historyLoadingMoreRef.current = false;
    const runToken = ++taskRunRef.current;
    if (taskPollRef.current !== null) {
      clearInterval(taskPollRef.current);
      taskPollRef.current = null;
    }
    try {
      const task = await api<{
        task_no: string;
        status: string;
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
        error_message?: string;
      }>(`/api/tasks/${taskNo}`);
      if (taskRunRef.current !== runToken) return;
      const media = extractTaskOutput(task.output || {});
      setMessages([]);
      chatContextRef.current = [];
      setConversationId("");
      setChatError("");
      setMmMode(false);
      setMmResults([]);
      setMmSummary("");
      setPrompt(
        typeof task.input?.user_prompt === "string" && task.input.user_prompt.trim()
          ? task.input.user_prompt
          : typeof task.input?.prompt === "string"
            ? task.input.prompt
            : ""
      );
      if (isImage) {
        const input = task.input || {};
        const rawSize = typeof input.size === "string" ? input.size : "";
        const sizeParts = /^(\d+)x(\d+)$/i.exec(rawSize);
        const restoredWidth = input.width ?? sizeParts?.[1] ?? "";
        const restoredHeight = input.height ?? sizeParts?.[2] ?? "";
        const customDimensions = normalizeCustomImageDimensions(restoredWidth as string | number, restoredHeight as string | number);
        setImageCustomWidth(customDimensions ? String(customDimensions.width) : "");
        setImageCustomHeight(customDimensions ? String(customDimensions.height) : "");
        if (typeof input.aspect_ratio === "string" && input.aspect_ratio.trim()) setImageRatio(input.aspect_ratio);
        if (typeof input.image_size === "string" && input.image_size.trim()) setImageSize(normalizeTier(input.image_size));
        const rawCount = typeof input.count === "number" ? input.count : Number(input.count);
        if (Number.isFinite(rawCount) && rawCount > 0) setImageCount(Math.min(50, Math.max(1, Math.round(rawCount))));
      }
      setTaskStatus(task.status);
      setTaskError(isFailedStatus(task.status) ? publicText(task.error_message, "模型服务暂时不可用，请稍后重试。") : "");
      setTaskOutput(media.videoURLs[0]?.url || media.audioURL || media.imageURLs[0] || null);
      setTaskImages(media.imageURLs);
      setTaskVideos(media.videoURLs);
      setTaskProgress(isSucceededStatus(task.status) ? 100 : fallbackProgress(task.status));
      setHistoryOpen(false);
    } catch (err) {
      if (taskRunRef.current === runToken) {
        setTaskError(publicError(err, "历史生成记录加载失败，请稍后重试。"));
      }
    }
  };

  useEffect(() => {
    api<{ compute_balance: number }>("/api/wallet")
      .then((w) => setMenuWallet(w))
      .catch(() => setMenuWallet(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = sp.get("prompt");
      if (p) setPrompt(p);
    } catch {
      /* ignore */
    }
  }, []);

  const handleCopyOutput = async (key: string, text: string) => {
    await copyToClipboard(text);
    setCopiedOutputKey(key);
    window.setTimeout(() => setCopiedOutputKey((current) => (current === key ? null : current)), 1500);
  };

  const handleChat = async () => {
    if (!prompt.trim() || streaming) return;
    if (modelPending) {
      setChatError(MODEL_PENDING_MESSAGE);
      return;
    }
    if (menuWallet && Number(menuWallet.compute_balance || 0) <= 0) {
      setChatError("您的余额不足，请及时充值或购买会员后再试。");
      return;
    }
    cancelActiveChat();
    const runToken = chatRunRef.current;
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const isCurrentRun = () => chatRunRef.current === runToken;
    const updateMessagesForRun = (update: (current: Message[]) => Message[]) => {
      if (!isCurrentRun()) return;
      setMessages((current) => (isCurrentRun() ? update(current) : current));
    };
    const setConversationForRun = (value: string) => {
      if (!isCurrentRun()) return;
      setConversationId((current) => (isCurrentRun() ? value : current));
    };
    const setMmModeForRun = (value: boolean) => {
      if (!isCurrentRun()) return;
      setMmMode((current) => (isCurrentRun() ? value : current));
    };
    const setMmTabForRun = (value: "answer" | "summary") => {
      if (!isCurrentRun()) return;
      setMmActiveTab((current) => (isCurrentRun() ? value : current));
    };
    const setMmSummaryForRun = (value: string) => {
      if (!isCurrentRun()) return;
      setMmSummary((current) => (isCurrentRun() ? value : current));
    };
    const updateMmResultsForRun = (update: (current: MultiModelResult[]) => MultiModelResult[]) => {
      if (!isCurrentRun()) return;
      setMmResults((current) => (isCurrentRun() ? update(current) : current));
    };
    const userMsg: Message = { role: "user", content: prompt };
    updateMessagesForRun((prev) => [...prev, userMsg]);
    setChatError("");
    setPrompt("");
    setStreaming(true);
    setMmModeForRun(false);
    updateMmResultsForRun(() => []);
    setMmSummaryForRun("");
    const contextBefore = isMultiCollab ? chatContextRef.current : messages;
    const newMessages = [...contextBefore, userMsg];
    chatContextRef.current = newMessages;
    let assistantContent = "";
    let assistantReasoning = "";
    let receivedReply = false;
    let receivedMultiModelEvent = false;
    let multiSnapshotContent = "";
    const authSnapshot = clientAuthSnapshot();
    try {
      const res = await fetch(`${API_URL}/api/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...legacyAuthHeaders(),
        },
        signal: abortController.signal,
        credentials: "include",
        body: JSON.stringify({
          model_code: model.code,
          conversation_id: conversationId,
            messages: [
              { role: "system", content: OUTPUT_FORMAT_INSTRUCTION },
              ...(bottom.role_prompt ? [{ role: "system", content: bottom.role_prompt }] : []),
              ...(bottom.asset_ids?.length
                ? [
                    {
                      role: "system",
                      content: `Selected asset public_ids: ${bottom.asset_ids.join(", ")}. Use these assets as context when answering.`,
                    },
                  ]
                : []),
              ...(bottom.files?.length
                ? [
                    {
                      role: "system",
                      content: `Uploaded attachment asset public_ids: ${bottom.files
                        .map((f) => f.public_id)
                        .join(", ")}. Use these attachments as context when answering.`,
                    },
                  ]
                : []),
              ...newMessages.map((m) => ({ role: m.role, content: m.content })),
            ],
          params: {
            ...params,
            ...(isMultiCollab
              ? {
                  channel_key: bottom.channel_key,
                  fallback_enabled: bottom.fallback_enabled,
                  web_search: bottom.web_search,
                  timeout_sec: bottom.timeout_sec,
                  ...(customSelectionEnabled && activeAnswerCodes.length >= 2 && activeSummaryCode
                    ? { answer_model_codes: activeAnswerCodes, summary_model_codes: [activeSummaryCode] }
                    : {}),
                }
              : {}),
            ...(isChatSingle && capWebSearch ? { web_search: bottom.web_search } : {}),
            ...(isChatSingle && capDeepThink ? { deep_think: deepThink } : {}),
            ...(isChatSingle && capDeepThink && typeof reasoningConfig.default_budget === "number"
              ? { reasoning_budget: reasoningConfig.default_budget }
              : {}),
            asset_ids: bottom.asset_ids,
            file_asset_ids: bottom.files.map((f) => f.public_id),
          },
          stream: true,
        }),
      });

      if (!isCurrentRun()) return;
      if (!res.ok) {
        if (res.status === 401) clearClientAuth(authSnapshot);
        const json = await res
          .json()
          .catch(() => ({} as { message?: string; error?: { message?: string }; data?: { conversation_id?: string } }));
        if (!isCurrentRun()) return;
        if (json.data?.conversation_id) {
          setConversationForRun(json.data.conversation_id);
        }
        throw new Error(json.error?.message || json.message || UI_TEXT.requestFailed);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!isCurrentRun()) return;
      updateMessagesForRun((prev) => [...prev, { role: "assistant", content: "" }]);

      let buffer = "";
      const applyDelta = (content: string, reasoning = "") => {
        if (!isCurrentRun()) return;
        receivedReply = true;
        assistantContent += content;
        assistantReasoning += reasoning;
        updateMessagesForRun((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, reasoning_content: assistantReasoning };
          return updated;
        });
      };

      const upsertMmResult = (patch: Partial<MultiModelResult> & { model_code: string }) => {
        if (!isCurrentRun()) return;
        updateMmResultsForRun((prev) => {
          const idx = prev.findIndex((r) => r.model_code === patch.model_code);
          if (idx === -1)
            return [
              ...prev,
              {
                model_code: patch.model_code,
                display_name: patch.display_name || patch.model_code,
                content: patch.content || "",
                icon_url: patch.icon_url,
                error: patch.error,
              },
            ];
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch, content: patch.content ?? next[idx].content };
          return next;
        });
      };

      if (!reader) {
        throw new Error("模型服务没有返回可读取的响应流，请稍后重试。");
      }

      if (reader) {
        while (true) {
          if (!isCurrentRun()) {
            void reader.cancel();
            return;
          }
          const { done, value } = await reader.read();
          if (!isCurrentRun()) {
            void reader.cancel();
            return;
          }
          if (done) break;
          // Reverse proxies may normalize SSE boundaries to CRLF. Normalize
          // them before splitting so a valid upstream answer never remains in
          // the incomplete buffer and appears only after reopening history.
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const evt of events) {
            if (!isCurrentRun()) return;
            let eventType = "";
            let dataStr = "";
            for (const line of evt.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataStr += line.slice(6);
            }
            if (!dataStr) continue;
            if (dataStr === "[DONE]") continue;
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }
            const streamError = data.error;
            if (streamError && typeof streamError === "object") {
              const error = streamError as { message?: unknown };
              throw new Error(typeof error.message === "string" ? error.message : "模型服务返回了错误。");
            }
            if (typeof data.conversation_id === "string" && data.conversation_id) {
              setConversationForRun(data.conversation_id);
            }
            if (eventType === "mm_start") {
              receivedMultiModelEvent = true;
              setMmModeForRun(true);
              setMmTabForRun("answer");
              updateMessagesForRun((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.content.trim()) {
                  return prev.slice(0, -1);
                }
                return prev;
              });
            } else if (eventType === "mm_model_start") {
              receivedMultiModelEvent = true;
              setMmModeForRun(true);
              const code = String(data.model_code || "");
              if (code) {
                upsertMmResult({
                  model_code: code,
                  display_name: typeof data.display_name === "string" ? data.display_name : code,
                  icon_url: typeof data.icon_url === "string" ? data.icon_url : undefined,
                });
              }
            } else if (eventType === "mm_model_delta") {
              receivedMultiModelEvent = true;
              setMmModeForRun(true);
              const code = String(data.model_code || "");
              const content = typeof data.content === "string" ? data.content : "";
              if (code && content) {
                updateMmResultsForRun((prev) => {
                  const idx = prev.findIndex((r) => r.model_code === code);
                  if (idx === -1) return [...prev, { model_code: code, display_name: code, content, icon_url: undefined }];
                  const next = [...prev];
                  next[idx] = { ...next[idx], content: (next[idx].content || "") + content };
                  return next;
                });
              }
            } else if (eventType === "mm_model_done") {
              receivedMultiModelEvent = true;
              setMmModeForRun(true);
              const code = String(data.model_code || "");
              if (code && typeof data.error === "object" && data.error) {
                const errObj = data.error as { code?: string; message?: string };
                upsertMmResult({
                  model_code: code,
                  error: { code: errObj.code || "MODEL_PROVIDER_ERROR", message: errObj.message || "Model error" },
                });
              }
            } else if (eventType === "mm_done") {
              receivedMultiModelEvent = true;
              setMmModeForRun(true);
              if (typeof data.conversation_id === "string" && data.conversation_id) {
                setConversationForRun(data.conversation_id);
              }
              if (typeof data.summary === "string") setMmSummaryForRun(data.summary);
              const items = Array.isArray(data.results) ? (data.results as any[]) : [];
              multiSnapshotContent = JSON.stringify({
                type: "multi_collab",
                summary: typeof data.summary === "string" ? data.summary : "",
                results: items,
              });
              if (Array.isArray(data.results)) {
                updateMmResultsForRun(() =>
                  items
                    .filter((x) => x && typeof x.model_code === "string")
                    .map((x) => ({
                      model_code: String(x.model_code),
                      display_name: String(x.display_name || x.model_code),
                      icon_url: typeof x.icon_url === "string" ? x.icon_url : undefined,
                      content: typeof x.content === "string" ? x.content : "",
                      error: x.error && typeof x.error === "object" ? { code: String(x.error.code || ""), message: String(x.error.message || "") } : undefined,
                    }))
                );
              }
            } else if (eventType === "delta" && typeof data.content === "string") {
              applyDelta(data.content);
            } else if (eventType === "done") {
              if (typeof data.conversation_id === "string" && data.conversation_id) {
                setConversationForRun(data.conversation_id);
              }
            } else if (eventType === "error" || eventType === "mm_error") {
              throw new Error((data.message as string) || "Model error");
            } else if (!eventType && typeof data.content === "string") {
              applyDelta(data.content);
            } else if (!eventType && Array.isArray(data.choices)) {
              const choice = data.choices[0] as { delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown[] } } | undefined;
              const content = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
              const reasoning = typeof choice?.delta?.reasoning_content === "string" ? choice.delta.reasoning_content : "";
              if (content || reasoning) {
                applyDelta(content, reasoning);
              } else if (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0) {
                receivedReply = true;
              }
            }
          }
        }
      }
      if (!isCurrentRun()) return;
      if (!receivedReply && !receivedMultiModelEvent && !assistantContent.trim()) {
        throw new Error("模型没有返回内容，请检查模型配置或模型服务。");
      }
      if (isMultiCollab && multiSnapshotContent) {
        chatContextRef.current = [
          ...chatContextRef.current,
          { role: "assistant", content: multiSnapshotContent },
        ];
      } else if (!isMultiCollab && receivedReply) {
        chatContextRef.current = [
          ...newMessages,
          { role: "assistant", content: assistantContent, reasoning_content: assistantReasoning },
        ];
      }
    } catch (err) {
      if (abortController.signal.aborted || (err as { name?: string })?.name === "AbortError" || !isCurrentRun()) return;
      const msg = publicError(err, "模型服务暂时不可用，请稍后重试。");
      setChatError(msg);
      updateMessagesForRun((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && !last.content) {
          updated[updated.length - 1] = { role: "assistant", content: `[${msg}]` };
        } else if (last?.role === "user") {
          updated.push({ role: "assistant", content: `[${msg}]` });
        }
        return updated;
      });
    } finally {
      if (isCurrentRun()) {
        if (chatAbortRef.current === abortController) chatAbortRef.current = null;
        setStreaming(false);
      }
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (refImages.length >= maxRefImages) {
      alert(t("workspace.maxReferenceImages", { max: maxRefImages }));
      return;
    }
    setUploading(true);
    try {
      const next: RefImage[] = [];
      for (const f of Array.from(files).slice(0, maxRefImages - refImages.length)) {
        const asset = await uploadAsset(f, { name: f.name, kind: "image", asset_type: "prop" });
        next.push({ url: asset.url, name: asset.name || f.name, public_id: asset.public_id });
      }
      setRefImages((prev) => [...prev, ...next].slice(0, maxRefImages));
    } catch (err) {
      alert(publicError(err, t("asset.uploadFailed")));
    } finally {
      setUploading(false);
    }
  };

  const handleMediaTask = async () => {
    if (modelPending) {
      setTaskStatus("failed");
      setTaskError(MODEL_PENDING_MESSAGE);
      setTaskOutput(null);
      setTaskImages([]);
      setTaskVideos([]);
      return;
    }
    if (menuWallet && Number(menuWallet.compute_balance || 0) <= 0) {
      setTaskStatus("failed");
      setTaskError("您的余额不足，请及时充值或购买会员后再试。");
      setTaskOutput(null);
      setTaskImages([]);
      setTaskVideos([]);
      return;
    }
    if (isVideo && videoConfig.prompt_required !== false && !prompt.trim()) {
      alert(t("workspace.enterPrompt"));
      return;
    }
    if (isAudio && audioConfig.prompt_required !== false && !prompt.trim()) {
      alert(t("workspace.enterText"));
      return;
    }
    if (!isVideo && !isAudio && !prompt.trim()) return;
    if (isMiniMaxH3) {
      if (videoMaterialMode === "first_frame" && !videoMedia.first_frame?.url) {
        alert(t("canvas.node.firstFrameRequired"));
        return;
      }
      if (videoMaterialMode === "last_frame" && !videoMedia.last_frame?.url) {
        alert(t("canvas.node.lastFrameRequired"));
        return;
      }
      if (videoMaterialMode === "first_last" && (!videoMedia.first_frame?.url || !videoMedia.last_frame?.url)) {
        alert(t("canvas.node.firstLastFramesRequired"));
        return;
      }
      if (
        videoMaterialMode === "reference" &&
        videoMedia.reference_images.length === 0 &&
        videoMedia.reference_videos.length === 0
      ) {
        alert(t("canvas.node.referenceVisualRequired"));
        return;
      }
    }
    if (isVeoFramePair && !videoMedia.first_frame?.url) {
      alert(t("canvas.node.firstFrameRequired"));
      return;
    }
    if (
      (isVeoReference || isOmniReference) &&
      videoMaterialMode === "reference" &&
      videoMedia.reference_images.length === 0
    ) {
      alert(t("canvas.node.referenceVisualRequired"));
      return;
    }
    // Treat the latest generated image as the context for an image-model
    // follow-up. Explicitly uploaded references always take precedence, and
    // New Task clears taskImages so the user can deliberately start fresh.
    const continuationImages = isImage && refImages.length === 0
      ? taskImages.slice(0, maxRefImages)
      : [];
    const runToken = ++taskRunRef.current;
    if (taskPollRef.current !== null) {
      clearInterval(taskPollRef.current);
      taskPollRef.current = null;
    }
    setTaskStatus("pending");
    setTaskError("");
    setTaskOutput(null);
    setTaskImages([]);
    setTaskVideos([]);
    setTaskProgress(8);
    try {
      const imageParams = isImage
        ? {
            ...buildImageGenerationParams({
              count: imageCount,
              ratio: imageRatio,
              imageSize,
              customWidth: imageCustomWidth,
              customHeight: imageCustomHeight,
            }),
            ...buildLanguageParams(selectedLanguage),
            user_prompt: prompt,
            ...(bottom.role_prompt ? { role_prompt: bottom.role_prompt } : {}),
            ...(bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {}),
          }
        : {};
      const selectedAssets = bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {};
      const selectedReferenceAssets = referenceAssetIds.length ? { reference_asset_ids: referenceAssetIds } : {};
      const taskParams = isVideo
        ? { ...buildVideoTaskParams(videoRequestParams, videoTaskMedia, model.runtime_rule), ...buildLanguageParams(selectedLanguage), user_prompt: prompt, ...selectedAssets, ...selectedReferenceAssets }
        : isAudio
          ? {
              ...buildAudioTaskParams(singleResultAudioParams(params), prompt, audioSecondaryPrompt, model.runtime_rule),
              ...(audioRef?.url ? { reference_audio: audioRef.url } : {}),
              ...selectedAssets,
            }
          : {
            ...params,
            ...imageParams,
            user_prompt: prompt,
            ...(refImages.length
              ? { reference_images: refImages.map((x) => x.url) }
              : continuationImages.length
                ? { reference_images: continuationImages }
                : {}),
            ...selectedReferenceAssets,
          };
      const task = await api<{
        task_no: string;
        status: string;
        error_message?: string;
      }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ model_code: model.code, prompt, params: taskParams }),
      });
      if (taskRunRef.current !== runToken) return;
      setTaskStatus(task.status);
      setTaskError(isFailedStatus(task.status) ? publicText(task.error_message, "模型服务暂时不可用，请稍后重试。") : "");
      setTaskProgress(fallbackProgress(task.status, 8));
      if (isFailedStatus(task.status)) {
        setTaskError(publicText(task.error_message, t("workspace.generationFailed")));
        return;
      }
      const interval = setInterval(async () => {
        try {
          const nextTask = await api<{
            status: string;
            output: Record<string, unknown>;
            error_message?: string;
          }>(`/api/tasks/${task.task_no}`);
          if (taskRunRef.current !== runToken) return;
          setTaskStatus(nextTask.status);
          setTaskError(isFailedStatus(nextTask.status) ? publicText(nextTask.error_message, "模型服务暂时不可用，请稍后重试。") : "");
          api<unknown[]>(`/api/tasks/${task.task_no}/events`)
            .then((events) => {
              if (taskRunRef.current !== runToken) return;
              const progress = latestProgressFromEvents(events);
              if (progress >= 0) setTaskProgress((current) => Math.max(current, progress));
              else setTaskProgress((current) => fallbackProgress(nextTask.status, current));
            })
            .catch(() => {
              if (taskRunRef.current !== runToken) return;
              setTaskProgress((current) => fallbackProgress(nextTask.status, current));
            });
          if (nextTask.status === "succeeded") {
            const media = extractTaskOutput(nextTask.output);
            setTaskOutput(media.videoURLs[0]?.url || media.audioURL || media.imageURLs[0] || null);
            setTaskImages(media.imageURLs);
            setTaskVideos(media.videoURLs);
            setTaskProgress(100);
            clearInterval(interval);
            if (taskPollRef.current === interval) taskPollRef.current = null;
          } else if (isFailedStatus(nextTask.status)) {
            setTaskError(publicText(nextTask.error_message, t("workspace.generationFailed")));
            clearInterval(interval);
            if (taskPollRef.current === interval) taskPollRef.current = null;
          }
        } catch (err) {
          if (taskRunRef.current !== runToken) return;
          setTaskError(publicError(err, "任务状态暂时无法获取，请稍后重试。"));
        }
      }, 2000);
      taskPollRef.current = interval;
    } catch (err) {
      if (taskRunRef.current !== runToken) return;
      const message = publicError(err, t("workspace.submitFailed"));
      setTaskStatus("failed");
      setTaskError(message);
    }
  };

  const submit = () => (isChat ? handleChat() : handleMediaTask());

  const hasConversation = messages.length > 0 || !!taskOutput || taskImages.length > 0 || taskVideos.length > 0 || !!taskStatus;
  const filteredChatModels = chatModels.filter((item) => {
    const keyword = modelSearch.trim().toLowerCase();
    return !keyword || item.display_name.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword);
  });
  const openModelSelector = () => {
    setDraftAnswerCodes(activeAnswerCodes);
    setDraftSummaryCode(activeSummaryCode);
    setModelSearch("");
    setModelSelectionError("");
    setBadgeOpen(true);
  };
  const toggleDraftAnswer = (code: string) => {
    setModelSelectionError("");
    setDraftAnswerCodes((current) => {
      if (current.includes(code)) return current.filter((item) => item !== code);
      if (current.length >= 8) {
        setModelSelectionError(t("channel.answerSelectionHint"));
        return current;
      }
      return [...current, code];
    });
  };
  const applyModelSelection = () => {
    if (draftAnswerCodes.length < 2 || !draftSummaryCode) {
      setModelSelectionError(t("channel.selectionRequired"));
      return;
    }
    setSelectedAnswerCodes(normalizeModelCodes(draftAnswerCodes));
    setSelectedSummaryCode(draftSummaryCode);
    setSelectionChannelKey(bottom.channel_key);
    setCustomSelectionEnabled(true);
    setBadgeOpen(false);
  };

  const isEmptyStudio = messages.length === 0 && !taskOutput && !taskStatus;
  const newWorkspaceLabel = isChat ? ts("新对话") : ts("新项目");
  const historyScopeLabel = isChat ? ts("当前模型对话") : `${modelCategoryLabel} ${ts("生成记录")}`;

  const historyPanel = historyOpen && historyPanelPosition && typeof document !== "undefined" ? createPortal(
    <div
      role="dialog"
      aria-label={t("common.history")}
      data-starai-history
      className="fixed z-[80] flex flex-col overflow-hidden rounded-2xl"
      style={{
        left: historyPanelPosition.left,
        top: historyPanelPosition.top,
        width: historyPanelPosition.width,
        maxHeight: historyPanelPosition.maxHeight,
        border: "1px solid var(--pico-premium-line)",
        background: "var(--pico-premium-bg)",
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-3.5 py-3" style={{ borderBottom: "1px solid var(--pico-premium-line)" }}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{t("common.history")}</div>
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>{historyScopeLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen(false)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition"
          style={{ color: "var(--pico-premium-muted)" }}
          aria-label={t("common.close")}
        >
          <X size={15} />
        </button>
      </div>
      <div
        className="min-h-0 overflow-y-auto overscroll-contain p-2"
        style={{ maxHeight: historyPanelPosition.listMaxHeight }}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight <= 80) void loadMoreHistory();
        }}
      >
        {historyLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs" style={{ color: "var(--pico-premium-muted)" }} role="status">
            <History size={14} className="animate-pulse" />
            <span>{t("common.loading")}</span>
          </div>
        ) : historyError && historyItems.length === 0 ? (
          <div className="px-3 py-6 text-center" role="alert">
            <div className="text-xs leading-5 text-red-500">{historyError}</div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium transition"
              style={{ border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}
            >
              重试
            </button>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs" style={{ color: "var(--pico-premium-muted)" }}>{UI_TEXT.historyEmpty}</div>
        ) : (
          <>
          {historyItems.map((item) => {
            const mediaType = item.mediaType;
            const ItemIcon = item.kind === "chat" ? MessageCircle : mediaType === "video" ? Video : mediaType === "audio" ? Mic : ImageIcon;
            const itemTypeLabel = item.kind === "chat" ? t("nav.chat") : mediaType === "video" ? t("nav.video") : mediaType === "audio" ? t("nav.audio") : t("nav.image");
            return (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                onClick={() => {
                  setHistoryOpen(false);
                  void (item.kind === "chat" ? loadConversation(item.id) : loadTaskHistory(item.id));
                }}
                className="group flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition focus:outline-none"
                style={{ background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgb(0 0 0 / 0.03)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--pico-premium-panel-strong)", color: "var(--pico-premium-muted)" }}>
                  <ItemIcon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" style={{ color: "var(--pico-premium-text)" }}>{item.title || item.id}</span>
                  <span className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-[10px]" style={{ color: "var(--pico-premium-muted)" }}>
                    <span className="truncate">{itemTypeLabel} · {new Date(item.updated_at).toLocaleString()}</span>
                    {item.status ? <span className="shrink-0">{statusLabel(item.status)}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
          {historyLoadingMore ? (
            <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs" style={{ color: "var(--pico-premium-muted)" }} role="status">
              <History size={13} className="animate-pulse" />
              <span>{t("common.loading")}</span>
            </div>
          ) : null}
          {historyError ? (
            <div className="px-3 py-3 text-center">
              <div className="text-xs leading-5 text-red-500">{historyError}</div>
              <button
                type="button"
                onClick={() => void loadMoreHistory()}
                className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium transition"
                style={{ border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}
              >
                重试加载
              </button>
            </div>
          ) : null}
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div
      className={clsx(
        "model-workspace workspace-surface pico-studio-simple flex flex-col h-full min-h-0",
        isEmptyStudio && "pico-studio-empty",
      )}
    >
      {onOpenModelPicker && (
        <div className="pico-mobile-studio-bar lg:hidden flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: "var(--pico-premium-panel)", borderBottom: "1px solid var(--pico-premium-line)" }}>
          <button
            type="button"
            onClick={() => onOpenModelPicker()}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}
            aria-label="Open model picker"
          >
            <ChevronDown size={16} className="rotate-90" />
          </button>
          {onOpenNav && (
            <button
              type="button"
              onClick={onOpenNav}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
          )}
          <div className="flex-1 min-w-0 font-semibold text-sm truncate" style={{ color: "var(--pico-premium-text)" }}>{modelName}</div>
          <Link href="/app/wallet" className="text-xs font-medium shrink-0 tabular-nums" style={{ color: "var(--pico-premium-blue)" }}>
            {menuWallet?.compute_balance?.toFixed(0) ?? "0"}
          </Link>
        </div>
      )}
      {/* Top action bar */}
      <div className="pico-hidden-studio-toolbar pico-pixel-topbar flex items-center justify-between gap-2 px-3 sm:px-5 py-1.5 sm:py-3 shrink-0 flex-wrap max-lg:border-b" style={{ borderColor: "var(--pico-premium-line)" }}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onOpenModelPicker && (
            <div className="pico-studio-mode-switcher flex items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => openInlineModelMenu(activeCreationMode)}
                className="pico-model-switcher"
                title={t("workspace.switchModel")}
              >
                <span className="max-w-[112px] truncate">{modelName}</span>
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </div>
        {!hideWorkspaceAccountActions && <div className="flex items-center gap-2">
        <div className="relative" data-starai-notif>
          <button
            onClick={openNotif}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}
            aria-label={unread > 0 ? `${unread} ${t("notifications.title")}` : t("notifications.title")}
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
            )}
          </button>
          {notifOpen && (
            <div className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 sm:mt-2 sm:w-[320px] top-16 sm:top-auto z-30 max-h-[60vh] overflow-hidden flex flex-col min-w-0 rounded-2xl" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
              <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b" style={{ borderColor: "var(--pico-premium-line)" }}>
                <span className="text-sm font-semibold truncate" style={{ color: "var(--pico-premium-text)" }}>
                  {t("notifications.title")}{unread > 0 ? ` (${unread})` : ""}
                </span>
                {notifItems.some((n) => !n.is_read) && (
                  <button onClick={markAllRead} className="text-[11px] hover:underline shrink-0 ml-2" style={{ color: "var(--pico-premium-blue)" }}>
                    {t("notifications.markAll")}
                  </button>
                )}
              </div>
              <div className="overflow-y-auto overflow-x-hidden p-2 min-h-0 flex-1">
                {notifNeedLogin ? (
                  <div className="text-center text-xs py-6 px-3 break-words" style={{ color: "var(--pico-premium-muted)" }}>
                    {t("notifications.loginHint")}
                  </div>
                ) : notifLoading ? (
                  <div className="text-center text-xs py-6" style={{ color: "var(--pico-premium-muted)" }}>{t("common.loading")}</div>
                ) : notifItems.length === 0 ? (
                  <div className="text-center text-xs py-6 px-3 break-words" style={{ color: "var(--pico-premium-muted)" }}>
                    {t("notifications.empty")}
                    <div className="mt-1 text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>
                      {t("notifications.emptyDesc")}
                    </div>
                  </div>
                ) : (
                  notifItems.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => markNotifRead(n.id)}
                      className="w-full max-w-full text-left px-3 py-2 rounded-xl transition-colors overflow-hidden"
                      style={{ background: n.is_read ? "transparent" : "rgb(37 99 235 / 0.05)" }}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {!n.is_read && (
                          <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />
                        )}
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="text-sm break-words [overflow-wrap:anywhere]" style={{ color: "var(--pico-premium-text)" }}>{notificationTitle(t, n.title, n.type)}</div>
                          <div className="text-[12px] mt-0.5 leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]" style={{ color: "var(--pico-premium-muted)" }}>
                            {n.content}
                          </div>
                          <div className="text-[10px] mt-1" style={{ color: "var(--pico-premium-muted)" }}>
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <UILanguageSelector compact />
        <WorkbenchUserMenu onRecharge={onRecharge} />
        </div>}
      </div>

      {/* Scrollable main */}
      <div className={`flex-1 px-3 sm:px-5 w-full ${hasConversation ? "overflow-y-auto pb-5 sm:pb-6" : "overflow-y-auto max-lg:overflow-y-auto pb-2 sm:pb-3"} min-h-0`}>
        {isEmptyStudio ? null : isChat ? (
          <div className="max-w-[980px] mx-auto space-y-4 py-4">
            {mmMode ? (
              <div className="rounded-2xl p-4" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
                {messages
                  .filter((msg) => msg.role === "user")
                  .map((msg, i) => (
                    <div key={`mm-user-${i}`} className="mb-4 flex justify-end">
                      <div className="max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap" style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel)", color: "var(--pico-premium-text)" }}>
                        {msg.content}
                        <div className="mt-2 flex justify-end">
                          <CopyOutputButton
                            text={msg.content}
                            copied={copiedOutputKey === `mm-user-${i}`}
                            onCopy={() => handleCopyOutput(`mm-user-${i}`, msg.content)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setMmActiveTab("answer")}
                      className="h-8 px-3 rounded-xl text-sm border"
                      style={mmActiveTab === "answer"
                        ? { borderColor: "var(--pico-ch-chat)", color: "var(--pico-premium-text)", background: "rgb(37 99 235 / 0.06)" }
                        : { borderColor: "var(--pico-premium-line)", color: "var(--pico-premium-muted)", background: "var(--pico-premium-panel)" }}
                    >
                      {t("channel.answer")}
                    </button>
                    <button
                      onClick={() => setMmActiveTab("summary")}
                      className="h-8 px-3 rounded-xl text-sm border"
                      style={mmActiveTab === "summary"
                        ? { borderColor: "var(--pico-ch-chat)", color: "var(--pico-premium-text)", background: "rgb(37 99 235 / 0.06)" }
                        : { borderColor: "var(--pico-premium-line)", color: "var(--pico-premium-muted)", background: "var(--pico-premium-panel)" }}
                    >
                      {t("channel.summary")}
                    </button>
                  </div>
                  <div className="flex items-center -space-x-2">
                    {mmResults.slice(0, 8).map((r) => (
                      <div key={r.model_code} className="w-8 h-8 rounded-xl overflow-hidden flex items-center justify-center" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
                        {r.icon_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.icon_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs" style={{ color: "var(--pico-premium-muted)" }}>AI</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {mmActiveTab === "summary" ? (
                  <div className="mt-3 rounded-2xl px-4 py-4" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
                    <RichMarkdown content={mmSummary} emptyText={streaming ? UI_TEXT.summaryGenerating : UI_TEXT.noSummary} />
                    <div className="mt-2 flex items-center justify-end">
                      <CopyOutputButton
                        text={mmSummary}
                        copied={copiedOutputKey === "mm-summary"}
                        onCopy={() => handleCopyOutput("mm-summary", mmSummary)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {mmResults.length === 0 ? (
                      <div className="text-sm px-2 py-6 text-center" style={{ color: "var(--pico-premium-muted)" }}>{UI_TEXT.waitingModel}</div>
                    ) : (
                      mmResults.map((r) => (
                        <div key={r.model_code} className="rounded-2xl p-4" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center" style={{ background: "var(--pico-premium-panel-strong)", border: "1px solid var(--pico-premium-line)" }}>
                              {r.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.icon_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs" style={{ color: "var(--pico-premium-muted)" }}>AI</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate" style={{ color: "var(--pico-premium-text)" }}>{publicText(r.display_name, "未命名模型")}</div>
                              <div className="text-[11px] truncate" style={{ color: "var(--pico-premium-muted)" }}>{publicText(r.model_code, "模型编码不可用")}</div>
                            </div>
                          </div>
                          {r.error ? (
                            <div className="text-sm text-red-600">[{publicText(r.error.message, "模型暂时无法响应")}]</div>
                          ) : (
                            <>
                              <RichMarkdown content={r.content} emptyText={streaming ? UI_TEXT.generating : ""} />
                              <div className="mt-2 flex items-center justify-end">
                                <CopyOutputButton
                                  text={r.content}
                                  copied={copiedOutputKey === `mm-${r.model_code}`}
                                  onCopy={() => handleCopyOutput(`mm-${r.model_code}`, r.content)}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role !== "user" && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: "var(--pico-ch-chat)" }}>
                        AI
                      </div>
                    )}
                    <div
                      className="max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed"
                      style={msg.role === "user"
                        ? { border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel)", color: "var(--pico-premium-text)", whiteSpace: "pre-wrap" }
                        : { border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)", color: "var(--pico-premium-text)" }}
                    >
                      {msg.role === "user" ? (
                        <>
                          {msg.content}
                          <div className="mt-2 flex items-center justify-end">
                            <CopyOutputButton
                              text={msg.content}
                              copied={copiedOutputKey === `msg-${i}`}
                              onCopy={() => handleCopyOutput(`msg-${i}`, msg.content)}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <RichMarkdown content={msg.content} emptyText={streaming && i === messages.length - 1 ? UI_TEXT.thinking : ""} />
                          <div className="mt-2 flex items-center justify-end">
                            <CopyOutputButton
                              text={msg.content}
                              copied={copiedOutputKey === `msg-${i}`}
                              onCopy={() => handleCopyOutput(`msg-${i}`, msg.content)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "var(--pico-premium-line)", color: "var(--pico-premium-text)" }}>
                        U
                      </div>
                    )}
                  </div>
                ))}
                {chatError && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {chatError}
                  </div>
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="max-w-[980px] mx-auto py-4">
            {taskStatus && (
              <div className="rounded-2xl p-5 mb-4 text-sm" style={{ background: "var(--pico-premium-panel)", border: "1px solid var(--pico-premium-line)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span style={{ color: "var(--pico-premium-muted)" }}>{UI_TEXT.taskStatus}:</span>
                    <span className={`ml-1 font-medium ${isFailedStatus(taskStatus) ? "text-red-500" : ""}`} style={isFailedStatus(taskStatus) ? undefined : { color: "var(--pico-premium-text)" }}>{statusLabel(taskStatus)}</span>
                    {isFailedStatus(taskStatus) && taskError ? (
                      <span className="ml-2 break-words text-red-500">{taskError}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--pico-premium-muted)" }}>
                    {isSucceededStatus(taskStatus) && isImage && taskImages.length > 0 && (
                      <span>{taskImages.length} {UI_TEXT.imageUnit}</span>
                    )}
                    {isSucceededStatus(taskStatus) && isVideo && taskVideos.length > 0 && (
                      <span>{taskVideos.length} 个视频</span>
                    )}
                    {!isSucceededStatus(taskStatus) && !isFailedStatus(taskStatus) && (
                      <span>{Math.round(taskProgress)}%</span>
                    )}
                  </div>
                </div>
                {!isSucceededStatus(taskStatus) && !isFailedStatus(taskStatus) && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "var(--pico-premium-panel-strong)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(4, taskProgress))}%`, background: isVideo ? "var(--pico-ch-video)" : isAudio ? "var(--pico-ch-audio)" : "var(--pico-ch-image)" }}
                    />
                  </div>
                )}
              </div>
            )}
            {isVideo && (taskVideos.length > 0 || taskOutput) && (
              <ModelMediaResultGrid type="video" videos={taskVideos.length > 0 ? taskVideos : [{ url: taskOutput || "" }]} />
            )}
            {taskOutput && isAudio && (
              <audio src={taskOutput} controls className="w-full max-w-lg" />
            )}
            {isImage && taskImages.length > 0 && (
              <ModelMediaResultGrid type="image" images={taskImages} />
            )}
            {isImage && taskImages.length === 0 && taskStatus && !isSucceededStatus(taskStatus) && !isFailedStatus(taskStatus) && (
              <ModelMediaPendingGrid type="image" count={imageCount} />
            )}
            {isImage && isSucceededStatus(taskStatus) && taskImages.length === 0 && (
              <div className="rounded-2xl p-5 text-sm text-amber-700 bg-amber-50 border border-amber-100">
                {UI_TEXT.noImageResult}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input section */}
      <div className="pico-universal-composer flex flex-col shrink-0 px-3 sm:px-5 pt-2 max-lg:pt-2 pb-4 sm:pb-6 max-lg:pb-4">
        {isEmptyStudio && !tipsDismissed && (
          <div
            className="mx-auto mb-2.5 flex w-full max-w-[1080px] flex-col items-start gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center"
            style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)" }}
          >
            <ol className="flex flex-1 flex-col gap-1.5 text-xs" style={{ color: "var(--pico-premium-muted)" }}>
              {["先选你要做什么", "再挑一个模型，价格就写在旁边", "写下需求，点生成"].map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: `var(--pico-ch-${activeCreationMode})` }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={dismissTips}
              className="shrink-0 self-end rounded-lg px-3 py-1.5 text-xs sm:self-center"
              style={{ border: "1px solid var(--pico-premium-line-strong)", color: "var(--pico-premium-muted)" }}
            >
              知道了
            </button>
          </div>
        )}
        <div className="pico-workspace-actions relative z-30 mx-auto mb-2.5 w-full max-w-[1080px]">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl px-3 py-2" style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel)" }}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgb(37 99 235 / 0.10)", color: "var(--pico-premium-blue)" }}>
                {isChat ? <MessageCircle size={15} /> : isVideo ? <Video size={15} /> : isAudio ? <Mic size={15} /> : <ImageIcon size={15} />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold" style={{ color: "var(--pico-premium-text)" }}>{modelCategoryLabel}</div>
                <div className="hidden max-w-[260px] truncate text-[10px] sm:block" style={{ color: "var(--pico-premium-muted)" }}>
                  {modelName}
                  {estimatedCostLabel(model) ? <span style={{ opacity: 0.75 }}> · {estimatedCostLabel(model)}</span> : null}
                </div>
              </div>
            </div>
            <div ref={historyAnchorRef} className="relative flex shrink-0 items-center gap-1.5" data-starai-history>
              {onSelectModel && (
                <button
                  type="button"
                  onClick={() => openInlineModelMenu(activeCreationMode)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition"
                  style={{ border: "1px solid var(--pico-premium-line-strong)", background: "var(--pico-premium-panel)", color: "var(--pico-premium-muted)" }}
                >
                  换模型
                </button>
              )}
              <button
                type="button"
                onClick={resetWorkspace}
                disabled={streaming}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "#18181b", color: "#fff" }}
                aria-label={newWorkspaceLabel}
                title={streaming ? "请等待当前对话完成" : newWorkspaceLabel}
              >
                <Plus size={14} />
                <span>{newWorkspaceLabel}</span>
              </button>
              <button
                type="button"
                onClick={openHistory}
                aria-expanded={historyOpen}
                aria-haspopup="dialog"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition"
                style={{ border: "1px solid var(--pico-premium-line-strong)", background: "var(--pico-premium-panel)", color: "var(--pico-premium-muted)" }}
                aria-label={t("common.history")}
              >
                <History size={14} />
                <span>{t("common.history")}</span>
                <ChevronDown size={13} className={clsx("transition-transform", historyOpen && "rotate-180")} />
              </button>
              {historyPanel}
            </div>
          </div>
        </div>
        <div className="pico-cream-composer-wrap w-full max-w-[980px] mx-auto">
          <div className="pico-composer-meta flex items-center justify-between text-xs mb-2 px-1" style={{ color: "var(--pico-premium-muted)" }}>
            <div className="flex items-center gap-1.5">
            <Plus size={12} />
            {t("workspace.quickStart")}
            </div>
            <span className="text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>
              {bottom.role_name ? `Role: ${bottom.role_name}` : ""}
            </span>
          </div>
          {modelPending && (
            <div className="pico-model-pending-warning mb-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs" role="status">
              <span>{MODEL_PENDING_MESSAGE} 可以查看和切换，发布后即可生成。</span>
              <Link href="/app/api-docs" className="shrink-0 font-semibold underline underline-offset-2">查看 Key</Link>
            </div>
          )}
          {menuWallet && Number(menuWallet.compute_balance || 0) <= 0 && (
            <div className="pico-balance-warning mb-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs">
              <span>您的余额不足，请及时充值后再开始创作。</span>
              {onRecharge && (
                <button type="button" onClick={onRecharge} className="shrink-0 font-semibold underline underline-offset-2">
                  去充值
                </button>
              )}
            </div>
          )}
          <div className="soft-input pico-composer-input">
            {onSelectModel && (
              <div className="pico-inline-model-bar" data-pico-inline-picker>
                <button
                  type="button"
                  onClick={() => openInlineModelMenu(activeCreationMode)}
                  className="pico-current-model-button"
                  aria-expanded={modelMenuOpen}
                >
                  <span className="pico-current-model-label">当前模型</span>
                  <span className="truncate">{modelName}</span>
                  <ChevronDown size={14} className={clsx("transition-transform", modelMenuOpen && "rotate-180")} />
                </button>
                {isMultiCollab && (
                  <button
                    type="button"
                    onClick={openModelSelector}
                    className="pico-collab-config-button"
                    title="配置协作模型"
                    aria-label="配置协作模型"
                  >
                    <Settings2 size={15} />
                  </button>
                )}
                {modelMenuOpen && (
                  <div className="pico-inline-model-menu" role="dialog" aria-label="切换模型或工作流">
                    <div className="pico-inline-model-menu-head">
                      <div>
                        <div className="text-sm font-extrabold" style={{ color: "var(--pico-premium-text)" }}>创作控制台</div>
                        <div className="text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>不离开当前页面，直接切换能力</div>
                      </div>
                      <button type="button" className="pico-inline-menu-close" onClick={() => setModelMenuOpen(false)} aria-label="关闭">
                        <X size={15} />
                      </button>
                    </div>
                    <div className="pico-inline-menu-tabs">
                      <button type="button" onClick={() => { setModelMenuTab("models"); setModelMenuCategory("chat"); }} className={clsx(modelMenuTab === "models" && modelMenuCategory === "chat" && "is-active")}>
                        <MessageCircle size={14} /> 对话
                      </button>
                      <button type="button" onClick={() => { setModelMenuTab("models"); setModelMenuCategory("image"); }} className={clsx(modelMenuTab === "models" && modelMenuCategory === "image" && "is-active")}>
                        <ImageIcon size={14} /> 生图
                      </button>
                      <button type="button" onClick={() => { setModelMenuTab("models"); setModelMenuCategory("video"); }} className={clsx(modelMenuTab === "models" && modelMenuCategory === "video" && "is-active")}>
                        <Video size={14} /> 视频
                      </button>
                      <button type="button" onClick={() => { setModelMenuTab("models"); setModelMenuCategory("audio"); }} className={clsx(modelMenuTab === "models" && modelMenuCategory === "audio" && "is-active")}>
                        <Mic size={14} /> 音频
                      </button>
                      {workflows.length > 0 && onSelectWorkflow && (
                        <button type="button" onClick={() => setModelMenuTab("workflows")} className={clsx(modelMenuTab === "workflows" && "is-active")}>
                          <Settings2 size={14} /> 工作流
                        </button>
                      )}
                    </div>
                    <div className="pico-inline-model-list">
                      {modelMenuTab === "models" ? (
                        inlineModels.length > 0 ? inlineModels.map((item) => (
                          <button
                            type="button"
                            key={item.code}
                            onClick={() => {
                              onSelectModel(item.code);
                              setModelMenuOpen(false);
                            }}
                            className={clsx("pico-inline-model-option", item.code === model.code && "is-active")}
                          >
                            <span className="pico-inline-model-icon">
                              {item.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.icon_url} alt="" />
                              ) : (
                                <ModelCategoryIcon category={item.category} />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate text-sm font-bold">{publicText(td(`model.${item.code}.name`, item.display_name), "未命名模型")}</span>
                              <span className="block truncate text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>
                                {!isModelCallable(item) ? modelPendingLabel(item) : publicText(td(`model.${item.code}.description`, item.description || "开始创作"), "开始创作")}
                              </span>
                            </span>
                            {item.code === model.code && <Check size={16} className="shrink-0" style={{ color: "var(--pico-premium-blue)" }} />}
                          </button>
                        )) : (
                          <div className="pico-inline-empty">这个分类暂时没有可用模型。</div>
                        )
                      ) : (
                        workflows.map((workflow) => (
                          <button
                            type="button"
                            key={workflow.code}
                            onClick={() => {
                              onSelectWorkflow?.(workflow.code);
                              setModelMenuOpen(false);
                            }}
                            className="pico-inline-model-option"
                          >
                            <span className="pico-inline-model-icon">{workflow.icon || "✦"}</span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block truncate text-sm font-bold">{publicText(td(`agent.${workflow.code}.name`, workflow.name), "未命名工作流")}</span>
                              <span className="block truncate text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>{publicText(td(`agent.${workflow.code}.description`, workflow.description || "按步骤完成创作"), "按步骤完成创作")}</span>
                            </span>
                            <ArrowUp size={15} className="rotate-90 shrink-0" style={{ color: "var(--pico-premium-blue)" }} />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {isChat ? (
              <div className="px-3 sm:px-4 py-2" style={{ borderBottom: "1px solid var(--pico-premium-line)" }}>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <ChatTopTools value={bottom} onChange={setBottom} />
                    <SchemaForm schema={workbenchInputSchema} values={params} onChange={setParams} placement="top" />
                  </div>
                  <InputToolbarMeta />
                </div>
              </div>
            ) : (
              <div className="px-3 sm:px-4 py-2.5 space-y-3" style={{ borderBottom: "1px solid var(--pico-premium-line)" }}>
                {isImage ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                        <ChatTopTools
                          value={bottom}
                          onChange={setBottom}
                          showUpload={false}
                          referencePickMode
                          referenceImages={refImages}
                          onReferenceImagesChange={setRefImages}
                          maxReferenceImages={maxRefImages}
                        />
                        <SchemaForm schema={workbenchInputSchema} values={params} onChange={setParams} placement="top" />
                      </div>
                      <InputToolbarMeta />
                    </div>
                    {maxRefImages > 0 ? (
                      <div className="scroll-x-only flex flex-nowrap items-center gap-2 w-full h-16">
                        {refImages.map((img, i) => (
                          <div key={img.url} className="relative w-16 h-16 rounded-2xl overflow-hidden shrink-0" style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                              title="Remove reference"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {refImages.length < maxRefImages && (
                          <label className="relative w-20 h-16 rounded-2xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition shrink-0" style={{ borderColor: "var(--pico-premium-line-strong)", background: "var(--pico-premium-panel)" }}>
                            <Plus size={18} style={{ color: "var(--pico-premium-muted)" }} />
                            <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--pico-premium-muted)" }}>{t("common.reference")} {refImages.length}/{maxRefImages}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              multiple
                              className="hidden"
                              disabled={uploading}
                              onChange={(e) => {
                                handleUpload(e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-400 flex items-center">
                        {t("model.referenceUnsupported")}
                      </div>
                    )}
                  </div>
                ) : isVideo ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                        {isFramePairUpload ? (
                          <>
                            <ChatTopTools
                              value={bottom}
                              onChange={setBottom}
                              showUpload={false}
                              showRole={false}
                              referencePickMode
                              referenceImages={veoFirstFrameAssets}
                              onReferenceImagesChange={(images) =>
                                setVideoMedia((prev) => ({ ...prev, first_frame: images[0] || null }))
                              }
                              maxReferenceImages={1}
                              assetLibraryLabel={`${t("video.firstFrame")} · ${t("asset.library")}`}
                            />
                            <ChatTopTools
                              value={bottom}
                              onChange={setBottom}
                              showUpload={false}
                              showRole={isVeoFramePair}
                              referencePickMode
                              referenceImages={veoLastFrameAssets}
                              onReferenceImagesChange={(images) =>
                                setVideoMedia((prev) => ({ ...prev, last_frame: images[0] || null }))
                              }
                              maxReferenceImages={1}
                              assetLibraryLabel={`${t("video.lastFrame")} · ${t("asset.library")}`}
                            />
                            {!isVeoFramePair && maxVideoAssetRefs > 0 ? (
                              <ChatTopTools
                                value={bottom}
                                onChange={setBottom}
                                showUpload={false}
                                referencePickMode
                                referenceImages={videoMedia.reference_images}
                                onReferenceImagesChange={(images) =>
                                  setVideoMedia((prev) => ({ ...prev, reference_images: images }))
                                }
                                maxReferenceImages={maxVideoAssetRefs}
                                assetLibraryLabel={`${t("video.referenceImage")} · ${t("asset.library")}`}
                              />
                            ) : null}
                          </>
                        ) : (
                          <ChatTopTools
                            value={bottom}
                            onChange={setBottom}
                            showUpload={false}
                            referencePickMode
                            referenceImages={videoMedia.reference_images}
                            onReferenceImagesChange={(imgs) =>
                              setVideoMedia((prev) => ({ ...prev, reference_images: imgs }))
                            }
                            maxReferenceImages={maxVideoAssetRefs}
                          />
                        )}
                        <VideoTopControls
                          schema={workbenchInputSchema}
                          values={params}
                          onChange={setParams}
                          videoConfig={videoConfig}
                        />
                      </div>
                      <InputToolbarMeta />
                    </div>
                    {!isEnhancedVideoMaterial && (
                      <VideoUploadArea
                        config={videoUploadConfig}
                        media={videoMedia}
                        onChange={setVideoMedia}
                        mode={videoMaterialMode}
                      />
                    )}
                  </div>
                ) : isAudio ? (
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1 min-h-9 flex-wrap">
                      <AudioTopControls
                        schema={workbenchInputSchema}
                        values={params}
                        onChange={setParams}
                        audioConfig={audioConfig}
                      />
                      {audioConfig.show_upload && (
                        <AudioUploadButton
                          url={audioRef?.url}
                          name={audioRef?.name}
                          onChange={setAudioRef}
                        />
                      )}
                    </div>
                    <InputToolbarMeta />
                  </div>
                ) : (
                  <>
                    <SchemaForm schema={workbenchInputSchema} values={params} onChange={setParams} placement="top" />
                    {hasSchemaFields && (
                      <SchemaForm schema={workbenchInputSchema} values={params} onChange={setParams} placement="default" />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {refImages.map((img, i) => (
                        <div key={img.url} className="relative w-12 h-12 rounded-lg overflow-hidden" style={{ border: "1px solid var(--pico-premium-line)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                          <button
                            onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white flex items-center justify-center rounded-bl"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {refImages.length < maxRefImages && (
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer" style={{ background: "var(--pico-premium-panel-strong)", color: "var(--pico-premium-muted)" }}>
                          <Upload size={14} />
                          {uploading ? "Uploading..." : "Upload"}
                          <span style={{ color: "var(--pico-premium-muted)" }}>{refImages.length}/{maxRefImages}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              handleUpload(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {isSeedance2 && videoMaterialMode === "draft_task" ? (
              <div className="px-3 py-3 sm:px-4">
                <VideoUploadArea
                  config={videoUploadConfig}
                  media={videoMedia}
                  onChange={setVideoMedia}
                  mode={videoMaterialMode}
                  draftTaskId={String(params.draft_task_id || "")}
                  onDraftTaskIdChange={(value) => setParams({ ...params, draft_task_id: value })}
                />
              </div>
            ) : isEnhancedVideoMaterial && videoMaterialMode !== "text" ? (
              <div className="flex flex-col md:flex-row md:items-stretch">
                <div className="w-full min-w-0 px-3 py-3 sm:px-4 md:w-auto md:max-w-[62%] md:flex-none md:pr-1">
                  <VideoUploadArea
                    config={videoUploadConfig}
                    media={videoMedia}
                    onChange={setVideoMedia}
                    mode={videoMaterialMode}
                    portraitAssetId={String(params.portrait_asset_id || "")}
                    portraitAssetType={params.portrait_asset_type === "video" ? "video" : "image"}
                    onPortraitAssetIdChange={(value) => setParams({ ...params, portrait_asset_id: value })}
                    onPortraitAssetTypeChange={(value) => setParams({ ...params, portrait_asset_type: value })}
                  />
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={promptPlaceholder}
                  rows={5}
                  className="min-h-28 min-w-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm placeholder:text-gray-400 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
            ) : isAudio && audioConfig.input_layout === "dual" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-50">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={audioConfig.prompt_hint ? ts(audioConfig.prompt_hint) : t("workspace.placeholder.audio")}
                  rows={5}
                  className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <textarea
                  value={audioSecondaryPrompt}
                  onChange={(e) => setAudioSecondaryPrompt(e.target.value)}
                  placeholder={
                    audioConfig.secondary_prompt_hint ? ts(audioConfig.secondary_prompt_hint) : ts("请输入音乐描述...")
                  }
                  rows={5}
                  className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
            ) : (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={promptPlaceholder}
                rows={isVideo || isAudio ? 4 : 3}
                className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
            <div
              className={
                isMultiCollab
                  ? "flex flex-col gap-2 px-3 sm:px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  : "flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5"
              }
              style={{ borderTop: "1px solid var(--pico-premium-line)" }}
            >
              <div
                className={
                  isMultiCollab
                    ? "w-full min-w-0 scroll-x-only sm:flex-1 sm:overflow-visible"
                    : "flex flex-1 items-center gap-1.5 sm:gap-2 flex-wrap min-w-0"
                }
              >
                {isChatSingle && (
                  <>
                    {capDeepThink && (
                      <button
                        type="button"
                        onClick={() => setDeepThink((enabled) => !enabled)}
                        aria-pressed={deepThink}
                        className="h-9 rounded-xl border px-3 text-sm"
                        style={deepThink
                          ? { borderColor: "var(--pico-premium-text)", color: "var(--pico-premium-text)", background: "var(--pico-premium-panel)" }
                          : { borderColor: "var(--pico-premium-line)", color: "var(--pico-premium-muted)", background: "var(--pico-premium-panel-strong)" }}
                      >
                        {t("workspace.deepThink")}
                      </button>
                    )}
                    {capWebSearch && (
                      <button
                        type="button"
                        onClick={() => setBottom({ ...bottom, web_search: !bottom.web_search })}
                        className="h-9 px-3 rounded-xl border text-sm"
                        style={bottom.web_search
                          ? { borderColor: "var(--pico-premium-text)", color: "var(--pico-premium-text)", background: "var(--pico-premium-panel)" }
                          : { borderColor: "var(--pico-premium-line)", color: "var(--pico-premium-muted)", background: "var(--pico-premium-panel-strong)" }}
                      >
                        Web search
                      </button>
                    )}
                  </>
                )}
                {isImage && (
                  <>
                    <ImageGenerationToolbar
                      count={imageCount}
                      onCountChange={setImageCount}
                      ratio={imageRatio}
                      onRatioChange={(value) => {
                        setImageRatio(value);
                        setImageCustomWidth("");
                        setImageCustomHeight("");
                      }}
                      imageSize={imageSize}
                      onImageSizeChange={setImageSize}
                      customWidth={imageCustomWidth}
                      customHeight={imageCustomHeight}
                      onCustomWidthChange={setImageCustomWidth}
                      onCustomHeightChange={setImageCustomHeight}
                      onCustomSizeChange={(width, height) => {
                        setImageCustomWidth(width);
                        setImageCustomHeight(height);
                      }}
                    />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                )}
                {isVideo && (
                  <>
                    <VideoOptionToolbar
                      schema={workbenchInputSchema}
                      values={params}
                      onChange={setParams}
                      videoConfig={videoConfig}
                    />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                )}
                {isAudio && (
                  <>
                    <AudioOptionToolbar
                      schema={workbenchInputSchema}
                      values={params}
                      onChange={setParams}
                      audioConfig={audioConfig}
                    />
                  </>
                )}
              </div>
              <div className={isMultiCollab ? "flex items-center justify-between gap-2 w-full sm:w-auto shrink-0" : "shrink-0"}>
              <button
                onClick={submit}
                disabled={
                  streaming ||
                  modelPending ||
                  (isVideo
                    ? videoConfig.prompt_required !== false && !prompt.trim()
                    : isAudio
                      ? audioConfig.prompt_required !== false && !prompt.trim()
                      : !prompt.trim())
                }
                title={modelPending ? MODEL_PENDING_MESSAGE : undefined}
                className="h-9 rounded-lg px-4 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 transition shrink-0 whitespace-nowrap"
                style={{ background: "#18181b", color: "#fff" }}
              >
                {menuWallet && Number(menuWallet.compute_balance || 0) <= 0 ? (
                  <>余额不足，去充值</>
                ) : (
                  <>
                    <ArrowUp size={16} />
                    生成
                    {(() => {
                      const cost = estimatedCostLabel(model);
                      return cost ? <span style={{ opacity: 0.75 }}>· 预计 {cost}</span> : null;
                    })()}
                  </>
                )}
              </button>
              </div>
            </div>
          </div>
          {isEmptyStudio && EXAMPLE_PROMPTS[activeCreationMode as "chat" | "image" | "video"] && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--pico-premium-line)" }}>
              <h2 className="mb-2.5 text-sm font-medium" style={{ color: "var(--pico-premium-text)" }}>
                第一次来？试试这三个
              </h2>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {EXAMPLE_PROMPTS[activeCreationMode as "chat" | "image" | "video"].map((example) => (
                  <div
                    key={example}
                    className="flex flex-col gap-2.5 rounded-lg p-3"
                    style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel)" }}
                  >
                    <p className="flex-1 text-xs leading-relaxed" style={{ color: "var(--pico-premium-muted)" }}>{example}</p>
                    <button
                      type="button"
                      onClick={() => setPrompt(example)}
                      className="self-end rounded-lg px-2.5 py-1 text-[11px]"
                      style={{ border: "1px solid var(--pico-premium-line-strong)", color: "var(--pico-premium-text)" }}
                    >
                      填进输入框
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {isMultiCollab && badgeOpen && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => setBadgeOpen(false)}>
              <div role="dialog" aria-modal="true" className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl" style={{ background: "var(--pico-premium-bg)", border: "1px solid var(--pico-premium-line)" }} onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--pico-premium-line)" }}>
                  <div>
                    <div className="text-base font-bold" style={{ color: "var(--pico-premium-text)" }}>{t("channel.customizeModels")}</div>
                    <div className="mt-1 text-xs" style={{ color: "var(--pico-premium-muted)" }}>{t("channel.selectionDescription")}</div>
                  </div>
                  <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)", color: "var(--pico-premium-muted)" }} onClick={() => setBadgeOpen(false)} aria-label={t("common.close")}>
                    <X size={16} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                  <input
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder={t("channel.searchModels")}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ border: "1px solid var(--pico-premium-line)", background: "var(--pico-premium-panel-strong)", color: "var(--pico-premium-text)" }}
                  />

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{t("channel.answerModels")}</div>
                        <div className="mt-0.5 text-xs" style={{ color: "var(--pico-premium-muted)" }}>{t("channel.answerSelectionHint")}</div>
                      </div>
                      <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: "rgb(37 99 235 / 0.10)", color: "var(--pico-premium-blue)" }}>{draftAnswerCodes.length}/8</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {filteredChatModels.map((item) => {
                        const checked = draftAnswerCodes.includes(item.code);
                        return (
                          <button
                            key={`answer-${item.code}`}
                            type="button"
                            onClick={() => toggleDraftAnswer(item.code)}
                            className="flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition"
                            style={checked
                              ? { borderColor: "var(--pico-premium-text)", background: "rgb(0 0 0 / 0.04)" }
                              : { borderColor: "var(--pico-premium-line)", background: "var(--pico-premium-panel)" }}
                          >
                            <BadgeCircle badge={{ code: item.code, icon: item.icon_url, label: publicText(item.display_name, "未命名模型") }} size={34} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{publicText(item.display_name, "未命名模型")}</div>
                              <div className="truncate text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>{publicText(item.code, "模型编码不可用")}</div>
                            </div>
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                              style={checked
                                ? { borderColor: "var(--pico-premium-text)", background: "var(--pico-premium-text)", color: "#fff" }
                                : { borderColor: "var(--pico-premium-line-strong)" }}
                            >{checked ? <Check size={13} /> : null}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="mb-2">
                      <div className="text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{t("channel.summaryModels")}</div>
                      <div className="mt-0.5 text-xs" style={{ color: "var(--pico-premium-muted)" }}>{t("channel.summarySelectionHint")}</div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {filteredChatModels.map((item) => {
                        const checked = draftSummaryCode === item.code;
                        return (
                          <button
                            key={`summary-${item.code}`}
                            type="button"
                            onClick={() => { setDraftSummaryCode(item.code); setModelSelectionError(""); }}
                            className="flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition"
                            style={checked
                              ? { borderColor: "var(--pico-premium-text)", background: "rgb(0 0 0 / 0.04)" }
                              : { borderColor: "var(--pico-premium-line)", background: "var(--pico-premium-panel)" }}
                          >
                            <BadgeCircle badge={{ code: item.code, icon: item.icon_url, label: publicText(item.display_name, "未命名模型") }} size={34} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold" style={{ color: "var(--pico-premium-text)" }}>{publicText(item.display_name, "未命名模型")}</div>
                              <div className="truncate text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>{publicText(item.code, "模型编码不可用")}</div>
                            </div>
                            <span
                              className="h-5 w-5 shrink-0 rounded-full border-[5px]"
                              style={checked ? { borderColor: "var(--pico-premium-text)", background: "#fff" } : { borderColor: "var(--pico-premium-line-strong)", background: "transparent" }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {filteredChatModels.length === 0 && <div className="rounded-xl border border-dashed py-8 text-center text-sm" style={{ borderColor: "var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}>{t("channel.unconfigured")}</div>}
                  {modelSelectionError && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{modelSelectionError}</div>}
                </div>

                <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--pico-premium-line)" }}>
                  <button type="button" onClick={() => setBadgeOpen(false)} className="rounded-xl px-4 py-2 text-sm" style={{ border: "1px solid var(--pico-premium-line)", color: "var(--pico-premium-muted)" }}>{t("common.cancel")}</button>
                  <button type="button" onClick={applyModelSelection} disabled={draftAnswerCodes.length < 2 || !draftSummaryCode} className="rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "#18181b", color: "#fff" }}>{t("channel.useCombination")}</button>
                </div>
              </div>
            </div>
      )}

    </div>
  );
}
