import { create } from "zustand";
import type { User } from "@starai/shared-types";
import { API_URL, AUTH_EXPIRED_EVENT, noteClientAuthChange } from "@/lib/api";

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  hydrate: () => void;
  validateSession: () => Promise<boolean>;
}

let validationInFlight: Promise<boolean> | null = null;
let authRevision = 0;

type AuthError = Error & { status?: number };

async function fetchCurrentUser(legacyToken: string): Promise<User> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;
  const response = await fetch(`${API_URL}/api/me`, { credentials: "include", headers });
  const raw = await response.text();
  let payload: { data?: unknown; message?: string } = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as { data?: unknown; message?: string };
    } catch {
      payload = { message: raw };
    }
  }
  if (!response.ok) {
    const error = new Error(typeof payload.message === "string" && payload.message.trim() ? payload.message : "会话已失效") as AuthError;
    error.status = response.status;
    throw error;
  }
  return payload.data as User;
}

function clearStoredAuth() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("starai_session");
    localStorage.removeItem("user");
  } catch {
    // Ignore storage failures; the Zustand state is still authoritative for
    // the current tab.
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  setAuth: (token, user) => {
    authRevision += 1;
    noteClientAuthChange();
    // Allow a post-login validation to start immediately; any older request
    // remains harmless because its captured revision no longer matches.
    validationInFlight = null;
    if (typeof window !== "undefined") {
      try {
        // Login responses set an HttpOnly cookie. Keep the old token argument
        // out of storage so stale bearer credentials cannot override it.
        localStorage.removeItem("token");
        localStorage.setItem("starai_session", "1");
        localStorage.setItem("user", JSON.stringify(user));
      } catch {
        // The in-memory state remains usable when storage is blocked.
      }
    }
    set({ token: "session", user });
  },
  logout: () => {
    authRevision += 1;
    noteClientAuthChange();
    validationInFlight = null;
    void fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    clearStoredAuth();
    set({ token: null, user: null });
  },
  hydrate: () => {
    if (typeof window === "undefined") return;
    let token: string | null = null;
    let session = false;
    let userStr: string | null = null;
    try {
      token = localStorage.getItem("token");
      session = localStorage.getItem("starai_session") === "1";
      userStr = localStorage.getItem("user");
    } catch {
      // Storage can be unavailable in privacy mode. The server-side cookie can
      // still authenticate the user, so continue with /api/me below.
    }
    if ((session || token) && userStr) {
      try {
        const parsed = JSON.parse(userStr) as User;
        // A stale or hand-edited local value must not prevent the app shell from
        // mounting. Keep only records that look like the API's user object.
        if (!parsed || typeof parsed !== "object" || typeof parsed.public_id !== "string") {
          throw new Error("invalid stored user");
        }
        set({ token: session ? "session" : token, user: parsed });
      } catch {
        authRevision += 1;
        clearStoredAuth();
        set({ token: null, user: null });
      }
    }
    // Local storage is only a render hint. Always confirm the HttpOnly cookie
    // (including when the local marker was lost) so the app can recover a valid
    // server session and discard an expired one.
    void get().validateSession();
  },
  validateSession: async () => {
    if (typeof window === "undefined") return false;
    if (validationInFlight) return validationInFlight;
    let legacyToken = "";
    try {
      // Once the login response has established the HttpOnly cookie, do not
      // let an old bearer token take precedence during session validation.
      legacyToken = localStorage.getItem("starai_session") === "1" ? "" : localStorage.getItem("token") || "";
    } catch {
      // Continue with a cookie-only request.
    }
    const requestRevision = authRevision;
    const request = fetchCurrentUser(legacyToken)
      .then((user) => {
        if (!user || typeof user.public_id !== "string") throw new Error("invalid session response");
        // A login/logout completed while this request was in flight. Its result
        // belongs to the old session and must not overwrite the new state.
        if (authRevision !== requestRevision) return Boolean(get().user);
        try {
          const currentLegacyToken = localStorage.getItem("token") || "";
          const currentSessionMarker = localStorage.getItem("starai_session") === "1";
          if (legacyToken && currentLegacyToken === legacyToken && !currentSessionMarker) {
            // A legacy bearer session has no way to mint a cookie from /me;
            // retain it so protected requests remain authenticated.
            localStorage.setItem("token", legacyToken);
            localStorage.removeItem("starai_session");
            localStorage.setItem("user", JSON.stringify(user));
            set({ token: legacyToken, user });
          } else {
            localStorage.setItem("starai_session", "1");
            localStorage.setItem("user", JSON.stringify(user));
            set({ token: "session", user });
          }
        } catch {
          set({ token: legacyToken || "session", user });
        }
        return true;
      })
      .catch((error) => {
        const status = (error as AuthError)?.status;
        if (authRevision !== requestRevision) return Boolean(get().user);
        // Keep local state intact for transient network/server errors so a
        // brief outage does not log the user out.
        if (status === 401) {
          authRevision += 1;
          clearStoredAuth();
          set({ token: null, user: null });
        }
        return false;
      })
      .finally(() => {
        if (validationInFlight === request) validationInFlight = null;
      });
    validationInFlight = request;
    return request;
  },
}));

// Keep every mounted component in the same auth state when api() observes a
// revoked/expired server session, including changes made in another tab.
if (typeof window !== "undefined") {
  const clearInMemoryAuth = () => {
    authRevision += 1;
    noteClientAuthChange();
    clearStoredAuth();
    useAuthStore.setState({ token: null, user: null });
  };
  window.addEventListener(AUTH_EXPIRED_EVENT, clearInMemoryAuth);
  window.addEventListener("storage", (event) => {
    if (event.key === "starai_session" && event.newValue === null) clearInMemoryAuth();
  });
}
