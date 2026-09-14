"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getAdminHandoffURL } from "@/lib/api";
import { publicError } from "@/lib/publicText";
import { useAuthStore } from "@/store/auth";
import type { User } from "@starai/shared-types";
import { SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY } from "@/components/ForcedAnnouncementModal";
import { useI18n } from "@/i18n/I18nProvider";
import { useSiteBranding } from "./SiteBrand";

interface Props {
  open: boolean;
  onClose: () => void;
}

type AccountMode = "login" | "register";
type LegalDoc = "terms" | "privacy";

// `pico-login-modal` is deliberately NOT in this list: globals.css defines that
// class twice (a cream one, then a dark-purple arcade one that wins), and both
// predate Style A. `pico-premium-login-modal` is the only skin hook now, and it
// is light — see the block above its rules in globals.css.
const LOGIN_MODAL_CLASS =
  "pico-premium-login-modal modal-shell fixed left-1/2 top-1/2 z-50 mx-0 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl";

const LEGAL_MODAL_CLASS =
  "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-2xl";


function CaptchaRow({
  captchaSvg,
  captchaInput,
  onCaptchaInputChange,
  onRefresh,
}: {
  captchaSvg: string;
  captchaInput: string;
  onCaptchaInputChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div
        className="flex h-10 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        dangerouslySetInnerHTML={captchaSvg ? { __html: captchaSvg } : undefined}
      />
      <input
        type="text"
        placeholder={t("login.captcha")}
        value={captchaInput}
        onChange={(e) => onCaptchaInputChange(e.target.value)}
        required
        className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
      />
      <button type="button" onClick={onRefresh} className="shrink-0 px-2 text-xs text-gray-500 hover:text-primary">
        {t("login.refresh")}
      </button>
    </div>
  );
}

function LegalModal({
  doc,
  title,
  content,
  onClose,
}: {
  doc: LegalDoc | null;
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!doc) return null;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
        <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-lg px-2 py-1 text-xl leading-none text-ink-soft hover:text-ink">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-5 py-5" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="whitespace-pre-wrap break-words text-sm leading-7 text-ink-mid">
          {content.trim() || t("login.legalEmpty")}
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-sunk px-5 py-4 text-right">
        <button type="button" onClick={onClose} className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
          {t("common.gotIt")}
        </button>
      </div>
    </>
  );
}

export function LoginModal({ open, onClose }: Props) {
  const { site_name, image_captcha_enabled, terms_title, terms_content, privacy_title, privacy_content } = useSiteBranding();
  const { t } = useI18n();
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const { setAuth } = useAuthStore();
  const router = useRouter();
  const rawImageCaptchaEnabled = image_captcha_enabled as unknown;
  const captchaEnabled = !(
    rawImageCaptchaEnabled === false ||
    rawImageCaptchaEnabled === 0 ||
    String(rawImageCaptchaEnabled).toLowerCase() === "false"
  );

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await api<{ id: string; image_svg: string }>("/api/auth/captcha");
      setCaptchaId(res.id);
      setCaptchaSvg(res.image_svg);
      setCaptchaInput("");
    } catch {
      setError(t("login.captchaLoadFailed"));
    }
  }, [t]);

  const resetForm = useCallback(() => {
    setAccountMode("login");
    setPassword("");
    setConfirmPwd("");
    setRegisterCode("");
    setReferralCode("");
    setCaptchaInput("");
    setAgreed(false);
    setError("");
    setCountdown(0);
  }, []);

  useEffect(() => {
    if (!open) {
      setLegalDoc(null);
      return;
    }
    resetForm();
    const fromURL = new URLSearchParams(window.location.search).get("referral_code") || "";
    setReferralCode(fromURL.replace(/\D/g, "").slice(0, 6));
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (captchaEnabled) {
      loadCaptcha();
    } else {
      setCaptchaId("");
      setCaptchaSvg("");
      setCaptchaInput("");
    }
  }, [open, captchaEnabled, loadCaptcha]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Registration-only: the code proves the registrant owns the mailbox. The
  // backend refuses to issue codes for addresses that already have an account.
  const sendRegisterCode = async () => {
    if (!email.trim()) return setError(t("login.enterEmail"));
    if (!agreed) return setError(t("login.agreeRequired"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ debug_code?: string }>("/api/auth/email/send-code", {
        method: "POST",
        body: JSON.stringify({ email, captcha_id: captchaId, captcha_code: captchaInput }),
      });
      setCountdown(60);
      if (res.debug_code) {
        setRegisterCode(res.debug_code);
        setError(t("login.debugCode", { code: res.debug_code }));
      }
    } catch (err) {
      setError(publicError(err, t("login.sendFailed")));
    } finally {
      setLoading(false);
    }
  };

  const accountLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaInput.trim()) return setError(t("login.enterCaptcha"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token?: string; user?: User; admin?: boolean; admin_handoff_code?: string }>("/api/auth/login/password", {
        method: "POST",
        body: JSON.stringify({ email, password, captcha_id: captchaId, captcha_code: captchaInput }),
      });
      if (res.admin_handoff_code) {
        onClose();
        window.location.assign(getAdminHandoffURL(res.admin_handoff_code));
        return;
      }
      if (!res.token || !res.user) throw new Error("登录响应无效，请稍后重试");
      setAuth(res.token, res.user);
      onClose();
      router.push("/app");
    } catch (err) {
      setError(publicError(err, t("login.loginFailed")));
      if (captchaEnabled) loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const accountRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError(t("login.agreeRequired"));
    if (password.length < 6) return setError(t("login.passwordMin"));
    if (password !== confirmPwd) return setError(t("login.passwordMismatch"));
    if (registerCode.trim().length !== 6) return setError(t("login.registerCodeRequired"));
    if (captchaEnabled && !captchaInput.trim()) return setError(t("login.enterCaptcha"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_code: registerCode.trim(),
          referral_code: referralCode.trim(),
          captcha_id: captchaId,
          captcha_code: captchaInput,
        }),
      });
      setAuth(res.token, res.user);
      window.localStorage.setItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY, "1");
      onClose();
      router.push("/app");
    } catch (err) {
      setError(publicError(err, t("login.registerFailed")));
      if (captchaEnabled) loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const siteName = site_name || "tuna";
  const legalTitle = legalDoc === "privacy" ? privacy_title || t("login.privacy") : terms_title || t("login.terms");
  const legalContent = legalDoc === "privacy" ? privacy_content || "" : terms_content || "";

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className={legalDoc ? LEGAL_MODAL_CLASS : LOGIN_MODAL_CLASS}>
          {legalDoc ? (
            <LegalModal doc={legalDoc} title={legalTitle} content={legalContent} onClose={() => setLegalDoc(null)} />
          ) : (
            <>
              <div className="pico-login-brand-strip"><span className="pico-login-brand-mark">{siteName.slice(0, 1).toUpperCase()}</span><span>{siteName}</span></div>
              <Dialog.Title className="mb-1 text-xl font-bold">{t("login.title", { site: siteName })}</Dialog.Title>
              <Dialog.Description className="mb-6 text-sm text-gray-500">
                {t("login.descAccountOnly")}
              </Dialog.Description>
              <div className="pico-login-capabilities" aria-label="tuna 创作能力">
                <span>对话</span><span>生图</span><span>视频</span><span>音频</span><span>工作流</span>
              </div>
              <form onSubmit={accountMode === "register" ? accountRegister : accountLogin} className="space-y-4">
                <div className="flex gap-2">
                  {[
                    { key: "login" as const, label: t("login.loginTab") },
                    { key: "register" as const, label: t("login.registerTab") },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setAccountMode(item.key);
                        setError("");
                        setPassword("");
                        setConfirmPwd("");
                        if (captchaEnabled) loadCaptcha();
                      }}
                      className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${accountMode === item.key ? "bg-primary text-dark" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <input type="email" placeholder={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                <input type="password" placeholder={t("login.password")} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                {accountMode === "register" && (
                  <>
                    <input type="password" placeholder={t("login.confirmPassword")} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                    <div className="flex gap-2">
                      <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder={t("login.enterRegisterCode")} value={registerCode} onChange={(e) => setRegisterCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required maxLength={6} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                      <button type="button" disabled={loading || countdown > 0} onClick={sendRegisterCode} className="shrink-0 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        {countdown > 0 ? `${countdown}s` : t("login.getCode")}
                      </button>
                    </div>
                    <p className="-mt-2 text-[11px] text-gray-400">{t("login.registerCodeHint")}</p>
                    <input type="text" placeholder={t("login.referral")} value={referralCode} onChange={(e) => setReferralCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  </>
                )}
                {captchaEnabled && <CaptchaRow captchaSvg={captchaSvg} captchaInput={captchaInput} onCaptchaInputChange={setCaptchaInput} onRefresh={loadCaptcha} />}
                {accountMode === "register" && (
                  <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-gray-500">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                    <span>
                      {t("login.agreePrefix")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("terms"); }} className="mx-0.5 text-primary hover:underline">{t("login.terms")}</button>
                      {t("login.and")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("privacy"); }} className="mx-0.5 text-primary hover:underline">{t("login.privacy")}</button>
                    </span>
                  </label>
                )}
                {error && <p className="text-sm text-danger">{error}</p>}
                <button type="submit" disabled={loading || (accountMode === "register" && !agreed)} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                  {loading
                    ? accountMode === "register" ? t("login.registering") : t("login.loading")
                    : accountMode === "register" ? t("login.register") : t("login.login")}
                </button>
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
