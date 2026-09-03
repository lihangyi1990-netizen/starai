"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminBrand } from "@/components/AdminBrand";
import { adminApi, setAdminSession } from "@/lib/api";

export default function AdminHandoffPage() {
  const router = useRouter();
  const [status, setStatus] = useState("正在验证后台入口…");

  useEffect(() => {
    let cancelled = false;
    const code = new URLSearchParams(window.location.search).get("code")?.trim() || "";
    if (!code) {
      setStatus("后台入口代码缺失，请从 tuna 设置页重新进入。");
      return () => {
        cancelled = true;
      };
    }
    adminApi<{ token: string; email: string; role?: string }>("/handoff/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then((result) => {
        if (cancelled) return;
        setAdminSession({ token: result.token, email: result.email, role: result.role });
        router.replace("/admin/dashboard");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "后台入口无效或已过期，请重新进入。");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-[#f3f5f9] px-4 py-8 text-gray-950">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-6xl items-center justify-center">
        <div className="w-full max-w-[440px] rounded-[28px] border border-gray-200/80 bg-white p-7 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8">
          <div className="mb-7 text-left">
            <AdminBrand
              badgeClassName="h-12 w-12 rounded-2xl"
              titleClassName="text-xl font-bold tracking-tight text-gray-950"
              subtitle="tuna 管理后台"
              subtitleClassName="mt-1 text-sm text-gray-500"
            />
          </div>
          <p className="text-sm text-gray-600" role="status" aria-live="polite">{status}</p>
        </div>
      </div>
    </div>
  );
}
