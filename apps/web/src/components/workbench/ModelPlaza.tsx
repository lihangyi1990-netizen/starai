"use client";

import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { ModelCategoryIcon } from "./CategoryIcon";
import type { Model } from "@starai/shared-types";
import { publicText } from "@/lib/publicText";
import { CATEGORY_TAG, isStandaloneAudioModel } from "./categoryMeta";

type PlazaCategory = "all" | "chat" | "image" | "video" | "audio";

const PLAZA_CATEGORIES: Array<{ code: PlazaCategory; label: string }> = [
  { code: "all", label: "全部" },
  { code: "chat", label: "对话" },
  { code: "image", label: "生图" },
  { code: "video", label: "视频" },
  { code: "audio", label: "音频" },
];

function compactNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number >= 100 ? number.toFixed(0) : number >= 1 ? number.toFixed(2) : number.toFixed(4);
}

function tokenPrice(rule: Record<string, unknown>, key: string) {
  const perMillion = compactNumber(rule[`${key}_per_m`]);
  if (perMillion) return perMillion;
  const perToken = Number(rule[key]);
  return Number.isFinite(perToken) && perToken > 0 ? compactNumber(perToken * 1_000_000) : null;
}

/**
 * A model is callable only after both switches are on: the operator has
 * enabled it and PICO has validated/published a retail price for a model
 * materialized in the platform catalog. Keep this predicate in the plaza in
 * lockstep with the composer so the table never promises an unavailable
 * request.
 */
function isPublished(model: Model) {
  if (model.is_enabled === false) return false;
  const rule = model.price_rule as unknown as Record<string, unknown> | undefined;
  const status = String(rule?.pico_pricing_status || "").trim().toLowerCase();
  // Legacy/manual models predate the publication marker and retain their
  // historical enabled behaviour. Any explicit non-published marker is a
  // server-owned pending state, regardless of whether the DTO includes the
  // catalog_source metadata.
  return !status || status === "published";
}

function priceSummary(model: Model) {
  if (!isPublished(model)) return "待管理员定价";
  const rule = model.price_rule as unknown as Record<string, unknown> | undefined;
  if (!rule) return "按实际调用计费";

  const unit = typeof rule.currency === "string" && rule.currency.trim() ? rule.currency.trim() : "算力";
  switch (rule.billing_type) {
    case "per_token": {
      const input = tokenPrice(rule, "input_price");
      const output = tokenPrice(rule, "output_price");
      return input || output ? `入 ${input || "-"} / 出 ${output || "-"} ${unit}/百万 Token` : "按 Token 计费";
    }
    case "per_image": {
      const value = compactNumber(rule.unit_price);
      return value ? `${value} ${unit}/张` : "按图片计费";
    }
    case "per_request": {
      const value = compactNumber(rule.unit_price);
      return value ? `${value} ${unit}/次` : "按次计费";
    }
    case "per_second": {
      const value = compactNumber(rule.unit_price);
      return value ? `${value} ${unit}/秒` : "按时长计费";
    }
    default:
      return "按生成参数计费";
  }
}

/**
 * Older model DTOs may not carry provider metadata. Prefer the explicit field
 * when available, then use conservative model-id hints for presentation.
 * Routing still uses the untouched model `code`.
 */
function providerLabel(model: Model) {
  const explicit = publicText((model as Model & { provider?: string }).provider, "");
  if (explicit) return explicit;
  const source = `${model.code} ${model.display_name} ${(model.tags || []).join(" ")}`.toLowerCase();
  const matches: Array<[string, string]> = [
    ["anthropic", "Claude"],
    ["claude", "Claude"],
    ["grok", "Grok"],
    ["xai", "Grok"],
    ["gemini", "Gemini"],
    ["google", "Gemini"],
    ["seedance", "Seedance"],
    ["bytedance", "Seedance"],
    ["volcengine", "Seedance"],
    ["kling", "Kling"],
    ["runway", "Runway"],
    ["pika", "Pika"],
    ["veo", "Veo"],
    ["sora", "Sora"],
    ["qwen", "Qwen"],
    ["dashscope", "Qwen"],
    ["deepseek", "DeepSeek"],
    ["kimi", "Kimi"],
    ["moonshot", "Kimi"],
    ["minimax", "MiniMax"],
    ["mistral", "Mistral"],
    ["glm", "智谱 GLM"],
    ["zhipu", "智谱 GLM"],
    ["openai", "OpenAI"],
    ["gpt-", "OpenAI"],
    ["codex-", "OpenAI"],
    ["dall-e", "OpenAI"],
  ];
  return matches.find(([hint]) => source.includes(hint))?.[1] || "其他";
}

export function ModelPlaza({
  models,
  onSelectModel,
  loading = false,
  error = "",
}: {
  models: Model[];
  onSelectModel: (code: string) => void;
  loading?: boolean;
  error?: string;
}) {
  const [category, setCategory] = useState<PlazaCategory>("all");
  const [query, setQuery] = useState("");
  const creatableCount = useMemo(() => models.filter(isPublished).length, [models]);
  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return models.filter((model) => {
      const matchesCategory =
        category === "all" ||
        (category === "chat"
          ? model.category === "chat" || model.category === "multi_collab"
          : category === "audio"
            ? isStandaloneAudioModel(model)
            : model.category === category);
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;
      return `${model.display_name} ${model.description || ""} ${model.code} ${(model.tags || []).join(" ")}`.toLowerCase().includes(normalizedQuery);
    });
  }, [category, models, query]);

  return (
    <section className="pico-model-plaza flex-1 min-h-0 overflow-y-auto" aria-label="模型广场">
      <div className="pico-model-plaza-inner">
        <header className="pico-model-plaza-hero">
          <span className="pico-model-plaza-sparkle"><Sparkles size={19} /></span>
          <div>
            <p className="pico-model-plaza-kicker">TUNA MODEL PLAZA</p>
            <h1>模型广场</h1>
            <p>像表格一样查看全部模型、能力和对用户售价；未定价模型会保留在目录中等待启用。</p>
          </div>
          <span className="pico-model-plaza-count">共 {models.length} 个 · 可创作 {creatableCount}</span>
        </header>

        <div className="pico-model-plaza-controls">
          <div className="pico-model-plaza-categories" role="tablist" aria-label="模型类型">
            {PLAZA_CATEGORIES.map((item) => (
              <button
                key={item.code}
                type="button"
                role="tab"
                aria-selected={category === item.code}
                className={category === item.code ? "is-active" : ""}
                onClick={() => setCategory(item.code)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="pico-model-plaza-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型、模型编码或能力" />
          </label>
        </div>

        <div className="pico-model-plaza-table-wrap" tabIndex={0} aria-label="模型列表，可横向滚动">
          <table className="pico-model-plaza-table">
            <thead>
              <tr>
                <th scope="col">模型</th>
                <th scope="col">厂商</th>
                <th scope="col">类型</th>
                <th scope="col">能力说明</th>
                <th scope="col">参考价格</th>
                <th scope="col">状态</th>
                <th scope="col"><span className="sr-only">开始创作</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((model) => {
                const tag = CATEGORY_TAG[model.category];
                const available = isPublished(model);
                return (
                  <tr key={model.code} className={available ? undefined : "is-pending"}>
                    <td>
                      <div className="pico-model-plaza-model-cell">
                        <span className="pico-model-plaza-icon">
                          {model.icon_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={model.icon_url} alt="" />
                          ) : (
                            <ModelCategoryIcon category={model.category} />
                          )}
                        </span>
                        <span>
                          <strong>{publicText(model.display_name, "未命名模型")}</strong>
                          <code>{publicText(model.code, "模型编码不可用")}</code>
                        </span>
                      </div>
                    </td>
                    <td><span className="pico-model-plaza-provider">{providerLabel(model)}</span></td>
                    <td><span className="pico-model-plaza-type">{tag?.label || model.category}</span></td>
                    <td className="pico-model-plaza-description">{publicText(model.description, "准备好开始创作。")}</td>
                    <td className="pico-model-plaza-price"><strong>{priceSummary(model)}</strong></td>
                    <td>
                      <span className={available ? "pico-model-plaza-status is-ready" : "pico-model-plaza-status is-pending"}>
                        {available ? "已开放" : "待定价"}
                      </span>
                    </td>
                    <td className="pico-model-plaza-action">
                      <button
                        type="button"
                        disabled={!available}
                        title={available ? "在创作框中使用此模型" : "管理员设置对用户售价并启用后即可使用"}
                        onClick={() => {
                          if (available) onSelectModel(model.code);
                        }}
                      >
                        {available ? "开始创作" : "暂不可用"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleModels.length === 0 && (
            <div className="pico-model-plaza-empty" role={loading || error ? "status" : undefined} aria-live={loading || error ? "polite" : undefined}>
              {loading ? "正在读取模型目录…" : error ? publicText(error, "模型目录暂时不可用，请稍后重试。") : "没有找到符合条件的模型。"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
