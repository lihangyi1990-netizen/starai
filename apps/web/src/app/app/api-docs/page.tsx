"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { publicError, publicText } from "@/lib/publicText";
import { useI18n } from "@/i18n/I18nProvider";
import { useSiteBranding } from "@/components/SiteBrand";

type ApiTokenProtocol = "universal" | "openai" | "anthropic" | "gemini";

interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  protocol?: ApiTokenProtocol;
  product_code?: string;
  model_scopes?: string[];
  token?: string;
  status: string;
  created_at: string;
}

interface ApiKeyProduct {
  code: string;
  name: string;
  description: string;
  provider: string;
  model_scopes?: string[];
  models?: ApiKeyProductModel[];
  model_count: number;
}

interface ApiKeyProductModel {
  code: string;
  display_name: string;
  category: string;
}

type ClientFormat = "openai" | "anthropic" | "gemini";
type ScopeMode = "provider" | "models";

const CLIENT_FORMATS: Array<{ code: ClientFormat; label: string; header: string; suffix: string; description: string }> = [
  { code: "openai", label: "OpenAI 兼容", header: "Authorization: Bearer TUNA_API_KEY", suffix: "/v1", description: "适合对话、生图、视频、音频和大多数 SDK。" },
  { code: "anthropic", label: "Claude 兼容", header: "x-api-key: TUNA_API_KEY", suffix: "/v1", description: "用于支持 Messages 格式的已发布模型。" },
  { code: "gemini", label: "Gemini 兼容", header: "x-goog-api-key: TUNA_API_KEY", suffix: "/v1beta", description: "用于支持 generateContent 格式的已发布模型。" },
];

function maskToken(token?: string, prefix?: string) {
  if (token) return `${token.slice(0, 14)}${"•".repeat(18)}${token.slice(-6)}`;
  return `${prefix || "sk-pico-"}${"•".repeat(12)}`;
}

function protocolLabel(protocol?: ApiTokenProtocol) {
  if (protocol === "anthropic") return "Claude 兼容";
  if (protocol === "gemini") return "Gemini 兼容";
  if (protocol === "openai") return "OpenAI 兼容";
  return "统一格式";
}

function displayProductName(name?: string) {
  return publicText(name?.replace(/^PICO\b/i, "tuna"), "tuna Key");
}

export default function ApiManagementPage() {
  const { ts } = useI18n();
  const { site_base_url } = useSiteBranding();
  const [origin, setOrigin] = useState("");
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [products, setProducts] = useState<ApiKeyProduct[]>([]);
  const [productCode, setProductCode] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("provider");
  const [selectedModelScopes, setSelectedModelScopes] = useState<string[]>([]);
  const [clientFormat, setClientFormat] = useState<ClientFormat>("openai");
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [copied, setCopied] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const loadTokens = () => api<{ items: ApiToken[] }>("/api/api-tokens").then((result) => setTokens(result.items || []));
  const loadProducts = () => api<{ items: ApiKeyProduct[] }>("/api/api-token-products").then((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    setProducts(items);
    setProductCode((current) => current && items.some((item) => item.code === current) ? current : (items.find((item) => item.code !== "pico-all")?.code || items.find((item) => item.code === "pico-all")?.code || items[0]?.code || ""));
  });

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([loadProducts(), loadTokens()]).catch(() => setMessage(ts("暂时无法读取 API Key，请刷新后重试。")));
  }, [ts]);

  const siteAddress = useMemo(() => publicText(site_base_url || origin || "https://your-tuna-domain.com", origin || "https://your-tuna-domain.com").replace(/\/+$/, ""), [origin, site_base_url]);
  const selectedProduct = products.find((item) => item.code === productCode);
  const availableModels = useMemo<ApiKeyProductModel[]>(() => {
    if (!selectedProduct) return [];
    if (Array.isArray(selectedProduct.models) && selectedProduct.models.length > 0) return selectedProduct.models;
    return (selectedProduct.model_scopes || []).filter((code) => code !== "*").map((code) => ({ code, display_name: code, category: "chat" }));
  }, [selectedProduct]);
  const selectedFormat = CLIENT_FORMATS.find((item) => item.code === clientFormat) || CLIENT_FORMATS[0];
  const apiAddress = `${siteAddress}${selectedFormat.suffix}`;

  useEffect(() => {
    const available = new Set(availableModels.map((model) => model.code));
    setSelectedModelScopes((current) => current.filter((code) => available.has(code)));
  }, [availableModels]);

  useEffect(() => {
    // The fallback catalog product has no provider boundary. Require an
    // explicit model selection for it, including on the first async load.
    if (selectedProduct?.code === "pico-all" && scopeMode !== "models") {
      setScopeMode("models");
      setSelectedModelScopes([]);
    }
  }, [scopeMode, selectedProduct?.code]);

  const selectProduct = (code: string) => {
    setProductCode(code);
    setScopeMode(code === "pico-all" ? "models" : "provider");
    setSelectedModelScopes([]);
  };

  const toggleModelScope = (code: string) => {
    setSelectedModelScopes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const selectedScopeLabel = scopeMode === "models"
    ? `${selectedModelScopes.length} 个指定模型`
    : selectedProduct?.code === "pico-all" ? "全部已发布模型" : `${publicText(selectedProduct?.provider, "厂商")} 全部模型`;

  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => current === id ? "" : current), 1400);
    } catch {
      setMessage(ts("复制失败，请手动复制。"));
    }
  };

  const createToken = async () => {
    if (!selectedProduct) {
      setMessage("当前没有已发布的模型产品，请先在 tuna 后台设置用户售价并发布模型。");
      return;
    }
    if (scopeMode === "models" && selectedModelScopes.length === 0) {
      setMessage(selectedProduct.code === "pico-all" ? "请至少选择一个具体模型。" : "请至少选择一个模型，或切换为厂商全部模型。");
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const result = await api<{ token: string }>("/api/api-tokens", {
        method: "POST",
        body: JSON.stringify({
          name: tokenName.trim() || `${selectedProduct.name} · ${selectedScopeLabel}`,
          protocol: "universal",
          product_code: selectedProduct.code,
          ...(scopeMode === "models" ? { model_scopes: selectedModelScopes } : {}),
        }),
      });
      setNewToken(result.token);
      setNewProductName(displayProductName(selectedProduct.name));
      setTokenName("");
      await loadTokens();
    } catch (error) {
      setMessage(publicError(error, ts("生成失败，请稍后重试。")));
    } finally {
      setCreating(false);
    }
  };

  const deleteToken = async (id: number) => {
    try {
      await api(`/api/api-tokens/${id}`, { method: "DELETE" });
      await loadTokens();
    } catch (error) {
      setMessage(publicError(error, ts("删除失败，请稍后重试。")));
    }
  };

  return (
    <div className="pico-api-page page-container flex-1 overflow-y-auto page-padding py-6 sm:py-10">
      <div className="pico-api-page-inner">
        <header className="pico-api-hero">
          <span className="pico-api-hero-icon"><KeyRound size={26} /></span>
          <div>
            <p>TUNA API</p>
            <h1>API Key</h1>
            <span>按厂商或具体模型授权 API Key；账号凭据由平台安全保管，绝不暴露上游密钥。</span>
          </div>
        </header>

        <section className="pico-api-card pico-api-key-card">
          <div className="pico-api-card-title"><span className="pico-api-step">1</span><div><h2>生成调用 Key</h2><p>模型产品来自当前 tuna 目录，列表会随可用模型更新和管理员发布状态变化。</p></div></div>
          {products.length === 0 ? (
            <div className="pico-api-empty">暂时没有可售模型，请稍后再试或联系平台管理员。</div>
          ) : (
            <div className="pico-api-protocol-grid" role="radiogroup" aria-label="模型产品">
              {products.map((item) => (
                <button key={item.code} type="button" role="radio" aria-checked={productCode === item.code} className={productCode === item.code ? "is-active" : ""} onClick={() => selectProduct(item.code)}>
                  <span>{item.code === "pico-all" ? "模型目录 · 需指定模型" : `${publicText(item.provider, "其他服务")} · ${item.model_count} 个模型`}</span>
                  <strong>{displayProductName(item.name)}</strong>
                  <small>{publicText(item.description, "可调用的已发布模型集合")}</small>
                </button>
              ))}
            </div>
          )}
          {selectedProduct && <div className="pico-api-scope-panel">
            <div className="pico-api-product-title"><strong>授权范围</strong><span>生成后只能调用这里选择的模型，服务端会再次校验。</span></div>
            <div className="pico-api-scope-toggle" role="radiogroup" aria-label="API Key 模型权限范围">
              {selectedProduct.code !== "pico-all" && <button type="button" role="radio" aria-checked={scopeMode === "provider"} className={scopeMode === "provider" ? "is-active" : ""} onClick={() => { setScopeMode("provider"); setSelectedModelScopes([]); }}>
                <strong>厂商全部模型</strong>
                <small>{`${publicText(selectedProduct.provider, "当前厂商")} 的 ${availableModels.length} 个模型`}</small>
              </button>}
              <button type="button" role="radio" aria-checked={scopeMode === "models"} className={scopeMode === "models" ? "is-active" : ""} onClick={() => setScopeMode("models")}>
                <strong>指定模型</strong>
                <small>只授权你勾选的模型</small>
              </button>
            </div>
            {scopeMode === "models" && <div className="pico-api-model-picker" aria-label="选择模型">
              {availableModels.length === 0 ? <p className="pico-api-empty">当前产品没有可选择的模型。</p> : availableModels.map((model) => (
                <label key={model.code} className={selectedModelScopes.includes(model.code) ? "is-selected" : ""}>
                  <input type="checkbox" checked={selectedModelScopes.includes(model.code)} onChange={() => toggleModelScope(model.code)} />
                  <span><strong>{model.display_name || model.code}</strong><code>{model.code}</code></span>
                </label>
              ))}
            </div>}
            <div className="pico-api-universal-note"><strong>当前范围：{selectedScopeLabel}</strong><span>调用格式（OpenAI、Claude 或 Gemini）与模型权限分开计算；每个新 Key 都必须绑定厂商或具体模型。</span></div>
          </div>}
          <div className="pico-api-generate-row pico-api-generate-row-spaced"><input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="例如：我的网站（可选）" aria-label="API Key 名称" /><button type="button" onClick={createToken} disabled={creating || !selectedProduct || (scopeMode === "models" && selectedModelScopes.length === 0)}>{creating ? "生成中…" : <><Plus size={17} />生成 TUNA Key</>}</button></div>
          {newToken && <div className="pico-api-new-key"><div><strong>{newProductName || "TUNA Key"} · 已生成</strong><code>{maskToken(newToken)}</code><span>完整 Key 只显示这一次，请立即复制保存。</span></div><button type="button" onClick={() => copy(newToken, "new")}>{copied === "new" ? <Check size={17} /> : <Copy size={17} />}{copied === "new" ? "已复制" : "复制 Key"}</button></div>}
        </section>

        <section className="pico-api-card pico-api-address-card">
          <div className="pico-api-card-title"><span className="pico-api-step">2</span><div><h2>调用地址</h2><p>选择客户端格式只会改变地址后缀和请求头，不会改变 Key 的模型权限。</p></div></div>
          <div className="pico-api-protocol-grid pico-api-integration-grid" role="radiogroup" aria-label="客户端格式">{CLIENT_FORMATS.map((item) => <button key={item.code} type="button" role="radio" aria-checked={clientFormat === item.code} className={clientFormat === item.code ? "is-active" : ""} onClick={() => setClientFormat(item.code)}><span>{item.label}</span><strong>{item.suffix}</strong><small>{item.description}</small></button>)}</div>
          <div className="pico-api-address-row"><Link2 size={18} /><input value={apiAddress} readOnly aria-label="tuna API 调用地址" /><button type="button" onClick={() => copy(apiAddress, "address")}>{copied === "address" ? <Check size={16} /> : <Copy size={16} />}{copied === "address" ? "已复制" : "复制地址"}</button></div>
          <div className="pico-api-header-row"><span>请求头</span><code>{selectedFormat.header}</code><button type="button" onClick={() => copy(selectedFormat.header, "header")} aria-label="复制请求头">{copied === "header" ? <Check size={16} /> : <Copy size={16} />}</button></div>
        </section>

        <section className="pico-api-card pico-api-guide-card">
          <div className="pico-api-card-title"><span className="pico-api-step">3</span><div><h2>怎么使用</h2><p>把上面的地址和 Key 填入你的客户端；模型名使用模型广场里显示的编码。</p></div></div>
          <div className="pico-api-guide-grid"><div><strong>对话</strong><code>POST /v1/chat/completions</code></div><div><strong>生图</strong><code>POST /v1/images/generations</code></div><div><strong>视频</strong><code>POST /v1/videos</code></div><div><strong>音频</strong><code>POST /v1/audio/speech</code></div></div>
          <p className="pico-api-guide-tip">只有已发布且有权限的模型会接受请求；余额、模型权限和计费由 tuna 统一校验。</p>
        </section>

        <section className="pico-api-card pico-api-existing-keys">
          <div className="pico-api-card-title"><span className="pico-api-step">4</span><div><h2>已有 Key</h2><p>{tokens.length ? `你已有 ${tokens.length} 个 Key。` : "还没有生成过 tuna Key。"}</p></div></div>
          {tokens.length === 0 ? <div className="pico-api-empty">生成第一个 Key 后，它会显示在这里。</div> : <div className="pico-api-key-list">{tokens.map((token) => { const tokenProduct = products.find((item) => item.code === token.product_code); const scopes = token.model_scopes || []; const scopeText = scopes.includes("*") ? "全部已发布模型" : scopes.length > 0 ? `${scopes.length} 个指定模型：${scopes.slice(0, 3).join("、")}${scopes.length > 3 ? "…" : ""}` : "权限信息不可用"; return <div key={token.id} className="pico-api-key-row"><div><span className="pico-api-key-protocol">{displayProductName(tokenProduct?.name || token.product_code || "tuna Key")} · {protocolLabel(token.protocol)}</span><strong>{token.name || "未命名 Key"}</strong><code>{maskToken(token.token, token.prefix)}</code><small className="pico-api-key-scope">{scopeText}</small><small className="pico-api-key-once">完整 Key 只在创建成功时显示一次</small></div><div className="pico-api-key-actions">{token.token ? <button type="button" onClick={() => copy(token.token || "", String(token.id))} aria-label="复制 API Key">{copied === String(token.id) ? <Check size={16} /> : <Copy size={16} />}</button> : <span className="pico-api-key-locked" title="出于安全原因，完整 Key 不会再次返回">仅创建时可复制</span>}<button type="button" onClick={() => deleteToken(token.id)} aria-label="删除 API Key"><Trash2 size={16} /></button></div></div>; })}</div>}
        </section>
        {message && <p className="pico-api-message" role="status">{message}</p>}
      </div>
    </div>
  );
}
