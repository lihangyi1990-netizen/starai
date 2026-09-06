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
  { code: "chat", label: "\u5bf9\u8bdd", labelKey: "mode.chat" },
  { code: "image", label: "\u751f\u56fe", labelKey: "mode.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "mode.video" },
  { code: "audio", label: "\u97f3\u9891", labelKey: "mode.audio" },
] as const;

export const CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  chat: { label: "\u5bf9\u8bdd", labelKey: "mode.chat", className: "bg-blue-50 text-blue-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-slate-100 text-slate-600" },
  image: { label: "\u751f\u56fe", labelKey: "mode.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "mode.video", className: "bg-purple-50 text-purple-600" },
  audio: { label: "\u97f3\u9891", labelKey: "mode.audio", className: "bg-orange-50 text-orange-600" },
};

export const AGENT_CATEGORIES = [
  { code: "all", label: "\u5168\u90e8", labelKey: "nav.all" },
  { code: "image", label: "\u751f\u56fe", labelKey: "mode.image" },
  { code: "video", label: "\u89c6\u9891", labelKey: "mode.video" },
  { code: "tool", label: "\u5de5\u5177", labelKey: "category.tool" },
  { code: "api", label: "API", labelKey: "category.api" },
] as const;

export const AGENT_CATEGORY_TAG: Record<string, { label: string; labelKey: string; className: string }> = {
  image: { label: "\u751f\u56fe", labelKey: "mode.image", className: "bg-emerald-50 text-emerald-600" },
  video: { label: "\u89c6\u9891", labelKey: "mode.video", className: "bg-purple-50 text-purple-600" },
  multi_collab: { label: "\u591a\u6a21\u578b", labelKey: "category.multiCollab", className: "bg-slate-100 text-slate-600" },
  api: { label: "API", labelKey: "category.api", className: "bg-slate-100 text-slate-600" },
  tool: { label: "\u5de5\u5177", labelKey: "category.tool", className: "bg-slate-100 text-slate-600" },
  workflow: { label: "\u901a\u7528", labelKey: "category.workflow", className: "bg-slate-100 text-slate-600" },
};

/**
 * Agent banner treatment.
 *
 * This used to be seven hue themes (amber/rose/violet/sky/emerald/fuchsia/comic),
 * each with a `from-... via-... to-white` gradient wash. Two problems: the
 * `gradient` field had no reader anywhere in the app, so those classes were dead;
 * and the remaining hue was chosen per agent, which meant a colour in this UI
 * could mean either "which channel" or "which agent". It now only means the first.
 *
 * The keys are kept because `display_config.theme` rows in the database still
 * carry them - they all resolve to the same neutral treatment, so an existing row
 * keeps working and simply stops tinting the banner.
 */
const NEUTRAL_AGENT_THEME = {
  iconBg: "bg-ink text-white",
  pill: "bg-sunk text-ink-mid",
  accent: "text-ink",
};

export const AGENT_THEMES: Record<string, { iconBg: string; pill: string; accent: string }> = {
  amber: NEUTRAL_AGENT_THEME,
  rose: NEUTRAL_AGENT_THEME,
  violet: NEUTRAL_AGENT_THEME,
  sky: NEUTRAL_AGENT_THEME,
  emerald: NEUTRAL_AGENT_THEME,
  fuchsia: NEUTRAL_AGENT_THEME,
  comic: NEUTRAL_AGENT_THEME,
};
