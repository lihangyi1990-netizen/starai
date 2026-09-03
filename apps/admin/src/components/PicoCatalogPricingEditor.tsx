"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";

type PriceRule = Record<string, unknown>;

export interface PicoCatalogPricingModel {
  id: number;
  code: string;
  display_name: string;
  category: string;
  is_enabled: boolean;
  price_rule: PriceRule;
  new_api_extra_params?: Record<string, unknown>;
}

interface Props {
  model: PicoCatalogPricingModel;
  onSaved: (model: PicoCatalogPricingModel) => void;
}

type BillingType = "per_token" | "per_image" | "per_request" | "per_second" | "dynamic";

const BILLING_LABELS: Record<BillingType, string> = {
  per_token: "按 Token（每 100 万）",
  per_image: "按图片",
  per_request: "按请求",
  per_second: "按秒",
  dynamic: "动态计费（保留策略）",
};

const BILLING_TYPES = Object.keys(BILLING_LABELS) as BillingType[];

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function initialBillingType(model: PicoCatalogPricingModel): BillingType {
  const current = String(model.price_rule?.billing_type || "").trim().toLowerCase() as BillingType;
  return BILLING_TYPES.includes(current) ? current : model.category === "chat" ? "per_token" : "per_request";
}

function initialTokenPrice(rule: PriceRule, key: "input_price_per_m" | "output_price_per_m") {
  if (rule[key] !== undefined) return numberValue(rule[key]);
  const legacyKey = key === "input_price_per_m" ? "input_price" : "output_price";
  return numberValue(rule[legacyKey]) * 1_000_000;
}

function hasCatalogSource(model: PicoCatalogPricingModel) {
  return String(model.new_api_extra_params?.catalog_source || "").trim().toLowerCase() === "sub2api";
}

function pricingStatus(model: PicoCatalogPricingModel) {
  const sourceStatus = String(model.new_api_extra_params?.catalog_status || "").trim().toLowerCase();
  if (sourceStatus && sourceStatus !== "active") return "目录已移除";
  const priced = String(model.price_rule?.pico_pricing_status || "pending").trim().toLowerCase() === "published";
  if (!priced) return "待设置售价";
  return model.is_enabled ? "已发布" : "已定价，未发布";
}

function pricingStatusClass(status: string) {
  if (status === "已发布") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "目录已移除") return "border-gray-200 bg-gray-100 text-gray-500";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function PicoCatalogPricingEditor({ model, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [billingType, setBillingType] = useState<BillingType>(() => initialBillingType(model));
  const [unitPrice, setUnitPrice] = useState(() => numberValue(model.price_rule?.unit_price));
  const [inputPrice, setInputPrice] = useState(() => initialTokenPrice(model.price_rule || {}, "input_price_per_m"));
  const [outputPrice, setOutputPrice] = useState(() => initialTokenPrice(model.price_rule || {}, "output_price_per_m"));
  const [fallbackCost, setFallbackCost] = useState(() => numberValue(model.price_rule?.fallback_cost));
  const [currency, setCurrency] = useState(() => String(model.price_rule?.currency || "算力"));
  const [enabled, setEnabled] = useState(model.is_enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sourceActive = String(model.new_api_extra_params?.catalog_status || "").trim().toLowerCase() === "active";
  const status = useMemo(() => pricingStatus(model), [model]);

  useEffect(() => {
    if (open) return;
    const rule = model.price_rule || {};
    setBillingType(initialBillingType(model));
    setUnitPrice(numberValue(rule.unit_price));
    setInputPrice(initialTokenPrice(rule, "input_price_per_m"));
    setOutputPrice(initialTokenPrice(rule, "output_price_per_m"));
    setFallbackCost(numberValue(rule.fallback_cost));
    setCurrency(String(rule.currency || "算力"));
    setEnabled(model.is_enabled);
    setError("");
  }, [model, open]);

  if (!hasCatalogSource(model)) return null;

  const save = async () => {
    setSaving(true);
    setError("");
    const current = { ...(model.price_rule || {}) } as PriceRule;
    const next: PriceRule = {
      ...current,
      billing_type: billingType,
      currency: currency.trim() || "算力",
    };
    if (billingType === "per_token") {
      next.input_price_per_m = Math.max(0, inputPrice);
      next.output_price_per_m = Math.max(0, outputPrice);
      delete next.input_price;
      delete next.output_price;
    } else if (billingType === "dynamic") {
      next.fallback_cost = Math.max(0, fallbackCost);
    } else {
      next.unit_price = Math.max(0, unitPrice);
      delete next.input_price;
      delete next.output_price;
      delete next.input_price_per_m;
      delete next.output_price_per_m;
    }
    try {
      const updated = await adminApi<PicoCatalogPricingModel>(`/models/${model.id}/pico-pricing`, {
        method: "PATCH",
        body: JSON.stringify({ price_rule: next, is_enabled: enabled }),
      });
      onSaved(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存 Tuna 售价失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "rounded-lg border px-2.5 py-1 text-xs transition",
          pricingStatusClass(status),
          "hover:brightness-95",
        ].join(" ")}
        title="只设置 Tuna 面向用户的售价，不会修改上游网关的账号、渠道或成本配置"
      >
        Tuna 售价 · {status}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => !saving && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`pico-pricing-title-${model.id}`}
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={`pico-pricing-title-${model.id}`} className="text-lg font-semibold text-gray-900">
                  Tuna 用户售价
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  {model.display_name} · {model.code}
                </p>
              </div>
              <button type="button" disabled={saving} onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-gray-700">
                关闭
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs leading-5 text-blue-800">
              这里设置的是 Tuna 向用户收取的价格。上游网关的账号池、渠道成本和负载均衡独立管理，不会被这里的保存操作修改。
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
                计费方式
                <select className="rounded-lg border px-3 py-2 text-sm text-gray-800" value={billingType} onChange={(event) => setBillingType(event.target.value as BillingType)}>
                  {BILLING_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {BILLING_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>

              {billingType === "per_token" ? (
                <>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    输入价 / 100 万 Token
                    <input type="number" min="0" step="0.0001" className="rounded-lg border px-3 py-2 text-sm" value={inputPrice} onChange={(event) => setInputPrice(numberValue(event.target.value))} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    输出价 / 100 万 Token
                    <input type="number" min="0" step="0.0001" className="rounded-lg border px-3 py-2 text-sm" value={outputPrice} onChange={(event) => setOutputPrice(numberValue(event.target.value))} />
                  </label>
                </>
              ) : billingType === "dynamic" ? (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
                  最低 / 兜底售价
                  <input type="number" min="0" step="0.01" className="rounded-lg border px-3 py-2 text-sm" value={fallbackCost} onChange={(event) => setFallbackCost(numberValue(event.target.value))} />
                  <span className="text-[11px] text-gray-400">动态策略字段会保留，仅更新兜底售价。</span>
                </label>
              ) : (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
                  每次用户售价
                  <input type="number" min="0" step="0.01" className="rounded-lg border px-3 py-2 text-sm" value={unitPrice} onChange={(event) => setUnitPrice(numberValue(event.target.value))} />
                </label>
              )}

              <label className="flex flex-col gap-1 text-xs text-gray-600">
                计价单位
                <input className="rounded-lg border px-3 py-2 text-sm" value={currency} onChange={(event) => setCurrency(event.target.value)} placeholder="算力" />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
                <input type="checkbox" checked={enabled} disabled={!sourceActive} onChange={(event) => setEnabled(event.target.checked)} />
                发布到前台和 API
              </label>
            </div>

            {!sourceActive && <p className="mt-3 text-xs text-amber-700">该模型已不在 Sub2API 当前目录中，暂不能发布。</p>}
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                取消
              </button>
              <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
                {saving ? "保存中…" : "保存 Tuna 售价"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
