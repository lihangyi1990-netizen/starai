import type { Model } from "@starai/shared-types";

type AudioCapabilityModel = Pick<Model, "category" | "code" | "display_name" | "tags" | "runtime_rule"> & {
  /** Optional public metadata supplied by newer API catalog versions. */
  audio_capable?: boolean;
  new_api_endpoint?: string;
  request_mode?: string;
};

function isTruthyFlag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function hasAudioValue(value: unknown): boolean {
  if (typeof value === "string") return /^(audio|tts|speech|voice|music|suno|whisper|transcri\w*|eleven|fish[\s._-]?speech|cosyvoice)$/i.test(value.trim());
  if (Array.isArray(value)) return value.some((item) => hasAudioValue(item));
  return false;
}

/**
 * Audio is a capability view rather than a mutually exclusive model type.
 * Keep this predicate deliberately explicit so a video model that merely
 * carries an audio track is not advertised as a standalone audio generator.
 */
export function isAudioCapableModel(model?: Partial<AudioCapabilityModel> | null): boolean {
  if (!model) return false;

  const category = String(model.category || "").trim().toLowerCase();
  const requestMode = String(model.request_mode || "").trim().toLowerCase();
  const name = `${model.code || ""} ${model.display_name || ""}`.toLowerCase();
  // A video model whose name mentions audio is describing an embedded
  // soundtrack, not a standalone audio generator. Keep the check symmetric
  // so both `video-with-audio` and `audio-video` are excluded.
  if (name.includes("video") && name.includes("audio")) return false;

  const runtime = (model.runtime_rule || {}) as Record<string, unknown>;
  const upstream = (runtime.upstream || {}) as Record<string, unknown>;
  const endpoint = String(model.new_api_endpoint || upstream.endpoint || "").trim().toLowerCase();
  const videoTransport = category === "video" || requestMode === "video" || /(^|\/)videos?(\/|$)/.test(endpoint);

  if (category === "audio" || isTruthyFlag(model.audio_capable) || requestMode === "audio") return true;

  const audioRule = runtime.audio;
  // Video runtime rules may carry an `audio` block solely for soundtrack
  // handling. Do not treat that UI/config block as an independent generator.
  if (!videoTransport && (audioRule === true || (audioRule && typeof audioRule === "object" && !Array.isArray(audioRule)))) return true;

  const capabilities = (runtime.capabilities || {}) as Record<string, unknown>;
  for (const key of ["audio", "audio_generation", "audio_output", "tts", "voice_generation", "music_generation"]) {
    if (isTruthyFlag(capabilities[key])) return true;
  }
  for (const key of ["modalities", "output_modalities", "response_modalities"]) {
    if (hasAudioValue(capabilities[key]) || hasAudioValue(runtime[key])) return true;
  }

  if (/(^|\/)audio(\/|$)/.test(endpoint)) return true;

  const tags = Array.isArray(model.tags) ? model.tags : [];
  if (tags.some((tag) => /^(audio|tts|speech|voice|music|suno|whisper|transcri\w*|eleven|fish[\s._-]?speech|cosyvoice)$/i.test(String(tag).trim()))) return true;

  const explicitName = /(^|[-_. ])(audio|audio-preview|realtime|tts|speech|voice|music|suno|whisper|transcri[a-z]*|eleven|fish[-_. ]?speech|cosyvoice)([-_. ]|$)/.test(name);
  return explicitName;
}

/**
 * Return only models that have a standalone asynchronous audio transport.
 * Chat models can advertise audio input/output capabilities while still
 * requiring the chat-completions flow; sending those rows through the audio
 * task UI produces an unusable composer and history endpoint.
 */
export function isStandaloneAudioModel(model?: Partial<AudioCapabilityModel> | null): boolean {
  if (!model) return false;
  const category = String(model.category || "").trim().toLowerCase();
  const requestMode = String(model.request_mode || "").trim().toLowerCase();
  if (category === "audio" || requestMode === "audio") return true;

  const runtime = (model.runtime_rule || {}) as Record<string, unknown>;
  const upstream = (runtime.upstream || {}) as Record<string, unknown>;
  const endpoint = String(model.new_api_endpoint || upstream.endpoint || "").trim().toLowerCase();
  // An explicit audio endpoint is enough for catalog rows whose older DTO did
  // not include request_mode. Video transports and chat-only rows stay out.
  if (category === "video" || requestMode === "video" || /(^|\/)videos?(\/|$)/.test(endpoint)) return false;
  return /(^|\/)audio(\/|$)/.test(endpoint);
}

export const CATEGORIES = [
  { code: "all", label: "\u5168\u90e8", labelKey: "nav.all" },
  { code: "chat", label: "\u804a\u5929", labelKey: "nav.chat" },
  { code: "image", label: "\u56fe\u7247", labelKey: "nav.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "nav.video" },
  { code: "audio", label: "\u97f3\u9891", labelKey: "nav.audio" },
] as const;

export const CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  chat: { label: "\u804a\u5929", labelKey: "nav.chat", className: "bg-blue-50 text-blue-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-indigo-50 text-indigo-600" },
  image: { label: "\u56fe\u7247", labelKey: "nav.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "nav.video", className: "bg-purple-50 text-purple-600" },
  audio: { label: "\u97f3\u9891", labelKey: "nav.audio", className: "bg-orange-50 text-orange-600" },
};

export const MODEL_ICONS: Record<string, string> = {
  chat: "\u{1F4AC}",
  multi_collab: "\u{1F916}",
  image: "\u{1F5BC}\uFE0F",
  video: "\u{1F3AC}",
  audio: "\u{1F3B5}",
};

export const AGENT_CATEGORIES = [
  { code: "all", label: "\u5168\u90e8", labelKey: "nav.all" },
  { code: "image", label: "\u56fe\u7247", labelKey: "nav.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "nav.video" },
  { code: "tool", label: "\u5de5\u5177", labelKey: "category.tool" },
  { code: "api", label: "API", labelKey: "category.api" },
] as const;

export const AGENT_CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  image: { label: "\u56fe\u7247", labelKey: "nav.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "nav.video", className: "bg-purple-50 text-purple-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-indigo-50 text-indigo-600" },
  api: { label: "API", labelKey: "category.api", className: "bg-sky-50 text-sky-600" },
  tool: { label: "\u5de5\u5177", labelKey: "category.tool", className: "bg-amber-50 text-amber-600" },
  workflow: { label: "\u901a\u7528", labelKey: "category.workflow", className: "bg-gray-100 text-gray-500" },
};

// Hero gradient themes for the agent workspace banner.
export const AGENT_THEMES: Record<string, { gradient: string; iconBg: string; pill: string; accent: string }> = {
  amber: {
    gradient: "from-amber-50 via-orange-50 to-white",
    iconBg: "bg-amber-100 text-amber-600",
    pill: "bg-amber-100/70 text-amber-700",
    accent: "text-amber-600",
  },
  rose: {
    gradient: "from-rose-50 via-pink-50 to-white",
    iconBg: "bg-rose-100 text-rose-600",
    pill: "bg-rose-100/70 text-rose-700",
    accent: "text-rose-600",
  },
  violet: {
    gradient: "from-violet-50 via-purple-50 to-white",
    iconBg: "bg-violet-100 text-violet-600",
    pill: "bg-violet-100/70 text-violet-700",
    accent: "text-violet-600",
  },
  sky: {
    gradient: "from-sky-50 via-blue-50 to-white",
    iconBg: "bg-sky-100 text-sky-600",
    pill: "bg-sky-100/70 text-sky-700",
    accent: "text-sky-600",
  },
  emerald: {
    gradient: "from-emerald-50 via-teal-50 to-white",
    iconBg: "bg-emerald-100 text-emerald-600",
    pill: "bg-emerald-100/70 text-emerald-700",
    accent: "text-emerald-600",
  },
  fuchsia: {
    gradient: "from-fuchsia-50 via-pink-50 to-white",
    iconBg: "bg-fuchsia-100 text-fuchsia-600",
    pill: "bg-fuchsia-100/70 text-fuchsia-700",
    accent: "text-fuchsia-600",
  },
  comic: {
    gradient: "from-cyan-50 via-violet-50 to-white",
    iconBg: "bg-cyan-100 text-cyan-700",
    pill: "bg-cyan-100/70 text-cyan-700",
    accent: "text-cyan-600",
  },
};

export const FEATURE_CARDS = [
  {
    titleKey: "workspace.feature.multiView.title",
    descKey: "workspace.feature.multiView.desc",
    icon: "\u{1F310}",
    color: "bg-amber-50 text-amber-600",
  },
  {
    titleKey: "workspace.feature.fusion.title",
    descKey: "workspace.feature.fusion.desc",
    icon: "\u2728",
    color: "bg-purple-50 text-purple-600",
  },
  {
    titleKey: "workspace.feature.parallel.title",
    descKey: "workspace.feature.parallel.desc",
    icon: "\u26A1",
    color: "bg-blue-50 text-blue-600",
  },
  {
    titleKey: "workspace.feature.quality.title",
    descKey: "workspace.feature.quality.desc",
    icon: "\u{1F6E1}\uFE0F",
    color: "bg-pink-50 text-pink-600",
  },
];
