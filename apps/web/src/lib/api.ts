const configuredApiURL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/+$/, "");

// Prefer the Next same-origin proxy for local browser sessions. Direct
// requests from :3000 to :8080 are fragile in embedded browsers; explicit
// non-local production URLs continue to work unchanged.
const isLocalApiURL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(configuredApiURL);
const useSameOriginAPI =
  typeof window !== "undefined" &&
  isLocalApiURL &&
  window.location.port !== "8080";
const API_URL = useSameOriginAPI ? "" : configuredApiURL;

/**
 * Keep the client-side auth hint in sync with the HttpOnly server session.
 * Protected requests can outlive a session (for example after a deploy or a
 * token revocation), so consumers must not keep rendering an authenticated
 * shell after the API has explicitly returned 401.
 */
export const AUTH_EXPIRED_EVENT = "starai:auth-expired";

export type ClientAuthSnapshot = {
  legacyToken: string;
  sessionMarker: boolean;
  generation: number;
};

let clientAuthGeneration = 0;

function readClientAuthSnapshot(): ClientAuthSnapshot {
  if (typeof window === "undefined") return { legacyToken: "", sessionMarker: false, generation: clientAuthGeneration };
  try {
    return {
      legacyToken: window.localStorage.getItem("token") || "",
      sessionMarker: window.localStorage.getItem("starai_session") === "1",
      generation: clientAuthGeneration,
    };
  } catch {
    return { legacyToken: "", sessionMarker: false, generation: clientAuthGeneration };
  }
}

export function clientAuthSnapshot(): ClientAuthSnapshot {
  return readClientAuthSnapshot();
}

// Auth state changes are recorded separately from localStorage values so a
// logout followed immediately by a new login cannot reuse an indistinguishable
// marker while an older request is still in flight.
export function noteClientAuthChange() {
  clientAuthGeneration += 1;
}

export function clearClientAuth(snapshot?: ClientAuthSnapshot) {
  if (typeof window === "undefined") return;
  // A request started before login/logout can finish with 401 after the
  // browser has already moved to a different session. Never let that stale
  // response clear the newer session state.
  if (snapshot) {
    const current = readClientAuthSnapshot();
    if (
      current.legacyToken !== snapshot.legacyToken ||
      current.sessionMarker !== snapshot.sessionMarker ||
      current.generation !== snapshot.generation
    ) return;
  }
  clientAuthGeneration += 1;
  try {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("starai_session");
    window.localStorage.removeItem("user");
  } catch {
    // Privacy-mode storage can throw; the in-memory store still receives the
    // event below and can clear its own state.
  }
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

function shouldSynchronizeUnauthorized(path: string) {
  const pathname = path.split("?", 1)[0];
  // These routes are intentionally public. A rejected password or an
  // unavailable public catalog must not invalidate an otherwise valid user
  // session in another part of the application.
  return ![
    "/api/auth/",
    "/api/models",
    "/api/model-categories",
    "/api/api-docs",
    "/api/system-configs/public",
    "/api/payment/config",
    "/api/announcements",
    "/api/gallery",
    "/api/agents",
    "/api/home/",
    "/api/channel-presets",
    "/api/role-templates",
  ].some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function notifyUnauthorized(status: number, path: string, snapshot?: ClientAuthSnapshot) {
  if (status === 401 && shouldSynchronizeUnauthorized(path)) clearClientAuth(snapshot);
}

async function readJSON(res: Response): Promise<Record<string, any>> {
  const raw = await res.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { message: raw };
  }
}

function responseError(res: Response, json: Record<string, any>, path: string, snapshot?: ClientAuthSnapshot) {
  notifyUnauthorized(res.status, path, snapshot);
  const message = typeof json.message === "string" && json.message.trim() ? json.message : "请求失败";
  const error = new Error(message);
  // Preserve the status for callers that need to distinguish auth failures
  // without exposing the response object itself.
  (error as Error & { status?: number }).status = res.status;
  return error;
}

/**
 * Resolve the browser-facing admin app once for all entry points. The API
 * gateway URL can be an internal Docker address, so it must never be used as
 * the link a user's browser follows.
 */
export function getAdminRootURL(): string {
  const configured = (process.env.NEXT_PUBLIC_ADMIN_URL || "").trim().replace(/\/+$/, "");
  const fallback =
    typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:3001`
      : typeof window !== "undefined"
        ? `${window.location.origin}/admin`
        : "/admin";
  const root = configured || fallback;
  return /\/admin$/i.test(root) ? root : `${root}/admin`;
}

export function getAdminHandoffURL(code: string): string {
  return `${getAdminRootURL()}/handoff?code=${encodeURIComponent(code)}`;
}

export function hasUserSession() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("starai_session") === "1" || !!localStorage.getItem("token");
  } catch {
    return false;
  }
}

export function legacyAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const snapshot = readClientAuthSnapshot();
  // Login responses establish an HttpOnly cookie. Sending a stale bearer
  // alongside it makes the server choose the stale credential and can produce
  // intermittent 401s immediately after login.
  return snapshot.sessionMarker || !snapshot.legacyToken ? {} : { Authorization: `Bearer ${snapshot.legacyToken}` };
}

function localeHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  let locale = "zh-CN";
  try {
    locale = localStorage.getItem("site_locale") || locale;
  } catch {
    // Ignore storage failures and use the default locale.
  }
  return { "X-Locale": locale, "Accept-Language": locale };
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const authSnapshot = readClientAuthSnapshot();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...localeHeaders(),
    ...legacyAuthHeaders(),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  const json = await readJSON(res);
  if (!res.ok) throw responseError(res, json, path, authSnapshot);
  return json.data as T;
}

/**
 * Fetch localized content with the locale captured by the React render that
 * started the request. Reading localStorage inside api() alone is not enough:
 * an older request may finish after a language switch and overwrite the newer
 * result. Callers should also pass an AbortSignal when the locale can change.
 */
export function apiForLocale<T>(
  path: string,
  locale: string,
  options: RequestInit = {}
): Promise<T> {
  return api<T>(path, {
    ...options,
    headers: {
      "X-Locale": locale,
      "Accept-Language": locale,
      ...(options.headers as Record<string, string>),
    },
  });
}

export async function uploadFile(file: File): Promise<string> {
  const authSnapshot = readClientAuthSnapshot();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  const json = await readJSON(res);
  if (!res.ok) throw responseError(res, { message: json.message || "上传失败" }, "/api/upload", authSnapshot);
  return json.data.url as string;
}

export async function uploadAsset(
  file: File,
  meta?: { name?: string; description?: string; kind?: string; asset_type?: string }
): Promise<{ public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number }> {
  const authSnapshot = readClientAuthSnapshot();
  const form = new FormData();
  form.append("file", file);
  if (meta?.name) form.append("name", meta.name);
  if (meta?.description) form.append("description", meta.description);
  if (meta?.kind) form.append("kind", meta.kind);
  if (meta?.asset_type) form.append("asset_type", meta.asset_type);
  const res = await fetch(`${API_URL}/api/assets/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  const json = await readJSON(res);
  if (!res.ok) throw responseError(res, { message: json.message || "上传失败" }, "/api/assets/upload", authSnapshot);
  return json.data as { public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number };
}

export async function listAssets(params: { q?: string; tag?: string; kind?: string; type?: string; page?: number; page_size?: number } = {}) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.tag) sp.set("tag", params.tag);
  if (params.kind) sp.set("kind", params.kind);
  if (params.type) sp.set("type", params.type);
  if (params.page) sp.set("page", String(params.page));
  if (params.page_size) sp.set("page_size", String(params.page_size));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  return api<{ items: any[]; total: number }>(`/api/assets${suffix}`);
}

export async function deleteAsset(publicId: string) {
  return api<null>(`/api/assets/${encodeURIComponent(publicId)}`, { method: "DELETE" });
}

export async function listRoles() {
  return api<{ items: any[] }>("/api/roles");
}

export async function createRole(payload: { name: string; description?: string; system_prompt: string; icon_url?: string; is_default?: boolean }) {
  return api(`/api/roles`, { method: "POST", body: JSON.stringify(payload) });
}

export async function listRoleTemplates() {
  return api<{ items: any[] }>("/api/role-templates");
}

export async function listChannelPresets() {
  return api<{ items: any[] }>("/api/channel-presets");
}

export { API_URL };
