"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, LogOut, ShieldCheck } from "lucide-react";
import { api, getAdminHandoffURL } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuthStore } from "@/store/auth";
import type { User } from "@starai/shared-types";

interface AdminHandoffStatus {
  available: boolean;
  email?: string;
  role?: string;
  sub2api_url?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const { locale: currentLocale, languages: uiLanguages, setLocale: setUILocale, t, ts } = useI18n();
  const [profile, setProfile] = useState<User | null>(null);
  const [nickname, setNickname] = useState("");
  const [locale, setLocale] = useState(currentLocale);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdErr, setPwdErr] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const [loggingOut, setLoggingOut] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminHandoffStatus | null>(null);
  const [openingAdmin, setOpeningAdmin] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");

  const loginMethodLabel = (provider?: string) => {
    switch ((provider || "email").toLowerCase()) {
      case "google":
        return ts("谷歌");
      case "github":
        return "GitHub";
      default:
        return ts("注册用户");
    }
  };

  useEffect(() => {
    api<User>("/api/me").then((u) => {
      setProfile(u);
      setNickname(u.nickname || "");
      setLocale(u.locale || currentLocale || "zh-CN");
    });
    api<AdminHandoffStatus>("/api/admin/handoff/status").then((result) => setAdminAccess(result?.available ? result : null)).catch(() => setAdminAccess(null));
  }, [currentLocale]);

  const openAdmin = async () => {
    if (openingAdmin) return;
    setOpeningAdmin(true);
    setAdminMsg("");
    try {
      const result = await api<{ code: string }>("/api/admin/handoff", { method: "POST" });
      window.location.assign(getAdminHandoffURL(result.code));
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : "后台入口暂时不可用，请稍后重试");
      setOpeningAdmin(false);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg("");
    try {
      const u = await api<User>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname, locale }),
      });
      setProfile(u);
      setUILocale(u.locale || locale, { persistUser: false });
      try {
        const raw = localStorage.getItem("user");
        if (raw) {
          const merged = { ...JSON.parse(raw), nickname: u.nickname, locale: u.locale };
          localStorage.setItem("user", JSON.stringify(merged));
        }
      } catch {
        /* ignore */
      }
      setProfileMsg(t("settings.saved"));
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    setPwdMsg("");
    setPwdErr("");
    try {
      await api("/api/me/change-password", {
        method: "POST",
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      setPwdMsg(ts("密码修改成功"));
      setOldPwd("");
      setNewPwd("");
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : ts("修改失败"));
    } finally {
      setSavingPwd(false);
    }
  };

  const doLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    logout();
    router.replace("/");
  };

  return (
    <div className="pico-premium-account-page pico-premium-settings-page flex-1 overflow-y-auto page-padding py-6 sm:py-8 page-container max-w-2xl dark:bg-gray-950">
      <h1 className="text-2xl font-bold mb-6">{t("settings.title")}</h1>

      <section className="soft-card p-6 mb-6">
        <h2 className="font-semibold mb-4">{t("settings.profile")}</h2>
        <form onSubmit={saveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
            <div className="text-sm text-gray-500">{t("settings.accountId")}</div>
            <div className="text-right text-sm font-medium text-gray-800 dark:text-gray-100">{loginMethodLabel(profile?.auth_provider)}</div>
            <div className="min-w-0 truncate font-mono text-sm text-gray-700 dark:text-gray-200" title={profile?.public_id || ""}>{profile?.public_id || "—"}</div>
            <div className="min-w-0 truncate text-right text-sm text-gray-700 dark:text-gray-200" title={profile?.email || ""}>{profile?.email || "—"}</div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("settings.nickname")}</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("common.language")}</label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {uiLanguages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.flag} {item.name}
                </option>
              ))}
            </select>
          </div>
          {profileMsg && <p className="text-primary text-sm md:col-span-2">{profileMsg}</p>}
          <button
            type="submit"
            disabled={savingProfile}
            className="px-6 py-2.5 rounded-xl bg-primary text-dark font-semibold text-sm disabled:opacity-50 md:col-span-2"
          >
            {savingProfile ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      <section className="soft-card p-6">
        <h2 className="font-semibold mb-4">{ts("修改密码")}</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <input
            type="password"
            placeholder={ts("原密码")}
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <input
            type="password"
            placeholder={ts("新密码（至少 6 位）")}
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {pwdErr && <p className="text-danger text-sm">{pwdErr}</p>}
          {pwdMsg && <p className="text-primary text-sm">{pwdMsg}</p>}
          <button
            type="submit"
            disabled={savingPwd || !oldPwd || !newPwd}
            className="px-6 py-2.5 rounded-xl bg-gray-900 text-white font-semibold text-sm disabled:opacity-50"
          >
            {savingPwd ? ts("提交中...") : ts("修改密码")}
          </button>
        </form>
      </section>

      <section className="soft-card p-6 mt-6">
        <h2 className="font-semibold">{ts("API 密钥")}</h2>
        <p className="mt-1 text-sm text-gray-500">在 API 管理中按厂商或具体模型创建 Key，权限会随已发布模型目录更新。</p>
        <Link href="/app/api-docs" className="mt-4 inline-flex rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white">
          前往 API 管理
        </Link>
      </section>

      {adminAccess && (
        <section className="soft-card mt-6 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><ShieldCheck size={18} /></span>
              <div className="min-w-0">
                <h2 className="font-semibold">管理员后台</h2>
                <p className="mt-1 truncate text-sm text-gray-500">{adminAccess.email} · {adminAccess.role === "super_admin" ? "超级管理员" : "运营管理员"}</p>
                <p className="mt-1 text-xs text-gray-400">使用一次性安全入口进入后台，不会在前端保存管理员密码。</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {adminAccess.role === "super_admin" && adminAccess.sub2api_url && (
                <a
                  href={adminAccess.sub2api_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-100"
                  title="打开独立的 Sub2API 管理后台"
                >
                  Sub2API 管理后台<ArrowUpRight size={16} />
                </a>
              )}
              <button type="button" onClick={openAdmin} disabled={openingAdmin} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-dark disabled:cursor-not-allowed disabled:opacity-50">
                {openingAdmin ? "正在打开…" : "进入后台"}<ArrowUpRight size={16} />
              </button>
            </div>
          </div>
          {adminMsg && <p className="mt-3 text-sm text-red-300" role="status">{adminMsg}</p>}
        </section>
      )}

      <section className="pico-settings-danger soft-card mt-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">退出当前账号</h2>
            <p className="mt-1 text-sm text-gray-500">退出后需要重新使用邮箱和密码登录。</p>
          </div>
          <button
            type="button"
            onClick={doLogout}
            disabled={loggingOut}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut size={16} />
            {loggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </section>
    </div>
  );
}
