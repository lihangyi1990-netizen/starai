"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { publicError } from "@/lib/publicText";
import type { Model } from "@starai/shared-types";
import { ModelWorkspace } from "@/components/workbench/ModelWorkspace";

export default function ModelDetailPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setModel(null);
    setError("");
    if (!code) return () => controller.abort();
    api<Model>(`/api/models/${encodeURIComponent(code)}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setModel(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(publicError(cause, "模型暂时无法加载"));
      });
    return () => controller.abort();
  }, [code]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-gray-400">模型不存在或暂时不可用</p>
          <p className="mt-2 max-w-md text-xs text-gray-500">{error}</p>
          <button type="button" onClick={() => router.push("/app")} className="mt-5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
            返回创作台
          </button>
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        加载中...
      </div>
    );
  }

  return <ModelWorkspace model={model} />;
}
