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

type Tab = "email" | "account";
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
  const { site_name, image_captcha_enabled, email_otp_login_enabled, terms_title, terms_content, privacy_title, privacy_content } = useSiteBranding();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("account");
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [step, setStep] = useState<"form" | "set_password">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isNewUser, setIsNewUser] = useState(false);
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
  // The email OTP tab depends on a working outbound mailer, so it is opt-in and
  // defaults to hidden — the opposite of the captcha flag above.
  const rawEmailOtpEnabled = email_otp_login_enabled as unknown;
  const emailOtpEnabled =
    rawEmailOtpEnabled === true ||
    rawEmailOtpEnabled === 1 ||
    String(rawEmailOtpEnabled).toLowerCase() === "true";

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
    setStep("form");
    setAccountMode("login");
    setPassword("");
    setConfirmPwd("");
    setEmailCode("");
    setReferralCode("");
    setCaptchaInput("");
    setAgreed(false);
    setIsNewUser(false);
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
    setTab("account");
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (captchaEnabled && tab === "account") {
      loadCaptcha();
    } else {
      setCaptchaId("");
      setCaptchaSvg("");
      setCaptchaInput("");
    }
  }, [open, captchaEnabled, loadCaptcha, tab]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async () => {
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
        setEmailCode(res.debug_code);
        setError(t("login.debugCode", { code: res.debug_code }));
      }
    } catch (err) {
      setError(publicError(err, t("login.sendFailed")));
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError(t("login.agreeRequired"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User; needs_set_password?: boolean; is_new_user?: boolean }>("/api/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code: emailCode, referral_code: referralCode.trim() }),
      });
      setAuth(res.token, res.user);
      if (res.needs_set_password) {
        setIsNewUser(!!res.is_new_user);
        setStep("set_password");
      } else {
        if (res.is_new_user) window.localStorage.setItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY, "1");
        onClose();
        router.push("/app");
      }
    } catch (err) {
      setError(publicError(err, t("login.verifyFailed")));
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
    if (captchaEnabled && !captchaInput.trim()) return setError(t("login.enterCaptcha"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          referral_code: referralCode.trim(),
          captcha_id: captchaId,
          captcha_code: captchaInput,
        }),
      });
      setAuth(res.token, res.user);
      // Freshly registered users should not be greeted by a forced announcement,
      // matching what the email OTP path does for is_new_user.
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

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return setError(t("login.passwordMin"));
    if (password !== confirmPwd) return setError(t("login.passwordMismatch"));
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/set-password", { method: "POST", body: JSON.stringify({ password }) });
      if (isNewUser) window.localStorage.setItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY, "1");
      onClose();
      router.push("/app");
    } catch (err) {
      setError(publicError(err, t("login.setPasswordFailed")));
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
          ) : step === "set_password" ? (
            <>
              <div className="pico-login-brand-strip"><span className="pico-login-brand-mark">{siteName.slice(0, 1).toUpperCase()}</span><span>{siteName}</span></div>
              <Dialog.Title className="mb-1 text-xl font-bold">{t("login.setPassword")}</Dialog.Title>
              <Dialog.Description className="mb-6 text-sm text-gray-500">
                {isNewUser ? t("login.setPasswordDescNew") : t("login.setPasswordDesc")}
              </Dialog.Description>
              <form onSubmit={submitPassword} className="space-y-4">
                <input type="password" placeholder={t("login.newPassword")} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                <input type="password" placeholder={t("login.confirmPassword")} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                {error && <p className="text-sm text-danger">{error}</p>}
                <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                  {loading ? t("common.saving") : t("login.finish")}
                </button>
                <button type="button" onClick={() => { onClose(); router.push("/app"); }} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
                  {t("login.later")}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="pico-login-brand-strip"><span className="pico-login-brand-mark">{siteName.slice(0, 1).toUpperCase()}</span><span>{siteName}</span></div>
              <Dialog.Title className="mb-1 text-xl font-bold">{t("login.title", { site: siteName })}</Dialog.Title>
              <Dialog.Description className="mb-6 text-sm text-gray-500">
                {emailOtpEnabled ? t("login.desc") : t("login.descAccountOnly")}
              </Dialog.Description>
              <div className="pico-login-capabilities" aria-label="tuna 创作能力">
                <span>对话</span><span>生图</span><span>视频</span><span>音频</span><span>工作流</span>
              </div>
              {emailOtpEnabled && (
                <div className="mb-6 flex gap-2">
                  {[
                    { key: "email" as const, label: t("login.emailTab") },
                    { key: "account" as const, label: t("login.accountTab") },
                  ].map((item) => (
                    <button key={item.key} type="button" onClick={() => { setTab(item.key); setError(""); if (captchaEnabled && item.key === "account") loadCaptcha(); }} className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${tab === item.key ? "bg-primary text-dark" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {emailOtpEnabled && tab === "email" ? (
                <form onSubmit={verifyEmail} className="space-y-4">
                  <input type="email" placeholder={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  <div className="flex gap-2">
                    <input type="text" placeholder={t("login.emailCode")} value={emailCode} onChange={(e) => setEmailCode(e.target.value)} required maxLength={6} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                    <button type="button" disabled={loading || countdown > 0} onClick={sendCode} className="shrink-0 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {countdown > 0 ? `${countdown}s` : t("login.getCode")}
                    </button>
                  </div>
                  <input type="text" placeholder={t("login.referral")} value={referralCode} onChange={(e) => setReferralCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-gray-500">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                    <span>
                      {t("login.agreePrefix")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("terms"); }} className="mx-0.5 text-primary hover:underline">{t("login.terms")}</button>
                      {t("login.and")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("privacy"); }} className="mx-0.5 text-primary hover:underline">{t("login.privacy")}</button>
                    </span>
                  </label>
                  {error && <p className="text-sm text-danger">{error}</p>}
                  <button type="submit" disabled={loading || !agreed} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                    {loading ? t("login.verifying") : t("login.submit")}
                  </button>
                  <p className="text-center text-[11px] text-gray-400">{t("login.firstHint")}</p>
                </form>
              ) : (
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
              )}

            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
