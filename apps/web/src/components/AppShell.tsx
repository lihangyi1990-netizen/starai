"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Image,
  KeyRound,
  LibraryBig,
  MessageCircle,
  Mic,
  Settings,
  Sparkles,
  WalletCards,
  Video,
  Workflow,
} from "lucide-react";
import { clsx } from "clsx";
import type { Model, Wallet } from "@starai/shared-types";
import { useAuthStore } from "@/store/auth";
import { api, apiForLocale } from "@/lib/api";
import { publicText } from "@/lib/publicText";
import { useI18n } from "@/i18n/I18nProvider";
import { useSiteBranding } from "./SiteBrand";
import { RechargeModal } from "./RechargeModal";
import { WorkbenchTopActions } from "./WorkbenchTopActions";
import { ModelWorkspace } from "./workbench/ModelWorkspace";
import { AgentWorkspace } from "./workbench/AgentWorkspace";
import { InfiniteCanvasWorkspace } from "./workbench/InfiniteCanvasWorkspace";
import { ModelPlaza } from "./workbench/ModelPlaza";
import { isStandaloneAudioModel } from "./workbench/categoryMeta";

type StudioSection = "models" | "agents" | "gallery";
type CreationMode = "chat" | "image" | "video" | "audio";

function QueryStateBridge({
  onChange,
}: {
  onChange: (section: string | null, mode: CreationMode | null) => void;
}) {
  const params = useSearchParams();
  const section = params.get("section");
  const rawMode = params.get("mode");
  const mode: CreationMode | null = rawMode === "chat" || rawMode === "image" || rawMode === "video" || rawMode === "audio" ? rawMode : null;

  useEffect(() => {
    onChange(section, mode);
  }, [mode, onChange, section]);

  return null;
}

interface AgentItem {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  nodes: { id: string; name: string }[];
}

interface AppShellProps {
  children: ReactNode;
  selectedModelCode?: string;
  selectedAgentCode?: string;
}

const INFINITE_CANVAS_CODE = "infinite_canvas";
const VIRAL_REMAKE_CODE = "viral_remake";
const VIDEO_REMAKE_CODE = "video_remake";

function isChatModel(model: Model) {
  return model.category === "chat" || model.category === "multi_collab";
}

function navClass(active: boolean) {
  return clsx("pico-premium-rail-item", active && "is-active");
}

function StudioUnavailable({
  models,
  onOpenPlaza,
  onRecharge,
  balance,
  catalogError,
}: {
  models: Model[];
  onOpenPlaza: () => void;
  onRecharge: () => void;
  balance?: number;
  catalogError?: string;
}) {
  const [mode, setMode] = useState<"chat" | "image" | "video" | "audio">("chat");
  const [draft, setDraft] = useState("");
  const modes = [
    { key: "chat" as const, label: "对话", icon: MessageCircle },
    { key: "image" as const, label: "生图", icon: Image },
    { key: "video" as const, label: "视频", icon: Video },
    { key: "audio" as const, label: "音频", icon: Mic },
  ];
  const modeModels = models.filter((item) => mode === "chat" ? isChatModel(item) : mode === "audio" ? isStandaloneAudioModel(item) : item.category === mode);
  const balanceKnown = typeof balance === "number";
  const balanceLow = balanceKnown && balance <= 0;

  return (
    <section className="pico-premium-unavailable" aria-label="tuna 创作台">
      <div className="pico-premium-unavailable-intro">
        <p>TUNA AI STUDIO</p>
        <h1>从一个对话框开始创作</h1>
        <span>对话、生图、视频和音频都在这里完成。</span>
      </div>
      <div className="pico-premium-unavailable-composer">
        <div className="pico-premium-unavailable-modes">
          {modes.map(({ key, label, icon: Icon }) => (
            <button key={label} type="button" className={mode === key ? "is-active" : ""} onClick={() => setMode(key)}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="pico-premium-unavailable-model"
          onClick={onOpenPlaza}
          aria-label="打开模型广场选择模型"
        >
          <span>当前模型</span>
          <strong>{publicText(modeModels[0]?.display_name, models.length ? "选择已发布模型" : "正在读取模型")}</strong>
        </button>
        <textarea
          className="pico-premium-unavailable-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="请输入你想创作的内容..."
          aria-label="创作内容"
          disabled={!modeModels.length}
          rows={5}
        />
        <div className="pico-premium-unavailable-footer">
          <span>{models.length ? `已准备 ${models.length} 个模型，选择后即可开始创作。` : publicText(catalogError, "正在读取模型目录。")}</span>
          <button type="button" onClick={onOpenPlaza}>查看模型广场</button>
        </div>
      </div>
      <div className={clsx("pico-premium-balance-alert", balanceKnown && !balanceLow && "is-ready")}>
        <div><strong>{!balanceKnown ? "余额状态正在读取" : balanceLow ? "您的余额不足" : "算力余额已就绪"}</strong><span>{!balanceKnown ? "登录后会自动显示余额；生成前会再次校验。" : balanceLow ? "请及时充值或购买会员后再开始创作。" : "生成前会自动校验余额，消费按已发布模型的用户售价计算。"}</span></div>
        <button type="button" onClick={onRecharge}>去充值</button>
      </div>
    </section>
  );
}

/** The app uses one stable frame; account pages and studio views share its material. */
export function AppShell({ children, selectedModelCode, selectedAgentCode }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, t, ts } = useI18n();
  const { site_name } = useSiteBranding();
  const brandName = site_name || "tuna";
  const { user, hydrate } = useAuthStore();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [activeModelCode, setActiveModelCode] = useState<string | undefined>(selectedModelCode);
  const [activeModel, setActiveModel] = useState<Model | null>(null);
  const [mountedModels, setMountedModels] = useState<Record<string, Model>>({});
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [activeAgentCode, setActiveAgentCode] = useState<string | undefined>(selectedAgentCode);
  const [section, setSection] = useState<StudioSection>(selectedAgentCode ? "agents" : "models");
  const [showRecharge, setShowRecharge] = useState(false);
  const [requestedSection, setRequestedSection] = useState<string | null>(null);
  const [requestedMode, setRequestedMode] = useState<CreationMode | null>(null);

  const handleQueryState = useCallback((nextSection: string | null, nextMode: CreationMode | null) => {
    setRequestedSection(nextSection);
    setRequestedMode(nextMode);
    // A history transition can keep the component mounted because the
    // pathname remains `/app`. Reset the workflow selection explicitly when
    // the URL no longer asks for a workflow or plaza view.
    if (pathname === "/app" && !nextSection && !selectedAgentCode && !selectedModelCode) {
      setActiveAgentCode(undefined);
      setSection("models");
    }
  }, [pathname, selectedAgentCode, selectedModelCode]);

  const isWorkbench =
    pathname === "/app" ||
    pathname === "/app/gallery" ||
    pathname === "/app/agents" ||
    pathname.startsWith("/app/models/") ||
    pathname.startsWith("/app/agents/");
  // Keep the complete model catalog visible in the selector. Pending models
  // are rendered with a clear status and blocked until an operator publishes
  // a retail price.
  const creatableModels = useMemo(() => models, [models]);
  const pageTitle =
    pathname.startsWith("/app/api-docs")
      ? "API Key"
      : pathname.startsWith("/app/wallet")
        ? t("nav.wallet")
        : pathname.startsWith("/app/settings")
          ? t("nav.settings")
          : t("nav.workspace");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!user) {
      setWallet(null);
      return;
    }
    api<Wallet>("/api/wallet").then(setWallet).catch(() => setWallet(null));
  }, [user]);

  useEffect(() => {
    if (!isWorkbench) return;
    setModelsLoading(true);
    setModelsError("");
    const controller = new AbortController();
    const timeoutID = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      setModelsError("模型目录响应超时，请稍后重试。");
      setModelsLoading(false);
      controller.abort();
    }, 10000);
    apiForLocale<Model[]>("/api/models", locale, { signal: controller.signal })
      .then((items) => setModels(Array.isArray(items) ? items : []))
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setModels([]);
          setModelsError("暂时无法读取模型目录，请稍后重试。");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutID);
        if (!controller.signal.aborted) setModelsLoading(false);
      });
    return () => {
      window.clearTimeout(timeoutID);
      controller.abort();
    };
  }, [isWorkbench, locale]);

  useEffect(() => {
    if (!isWorkbench) return;
    const controller = new AbortController();
    apiForLocale<{ items: AgentItem[] }>("/api/agents", locale, { signal: controller.signal })
      .then((result) => setAgents(Array.isArray(result?.items) ? result.items : []))
      .catch((error) => {
        if (error?.name !== "AbortError") setAgents([]);
      });
    return () => controller.abort();
  }, [isWorkbench, locale]);

  useEffect(() => {
    if (selectedModelCode) {
      setSection("models");
      setActiveModelCode(selectedModelCode);
      setActiveAgentCode(undefined);
    }
  }, [selectedModelCode]);

  useEffect(() => {
    if (selectedAgentCode) {
      setSection("agents");
      setActiveAgentCode(selectedAgentCode);
      setActiveModelCode(undefined);
      setActiveModel(null);
    }
  }, [selectedAgentCode]);

  useEffect(() => {
    if (!isWorkbench) return;
    if (pathname === "/app/gallery") {
      setSection("gallery");
      return;
    }
    if (pathname === "/app/agents") {
      setSection("agents");
      setActiveAgentCode((current) => current || agents[0]?.code || INFINITE_CANVAS_CODE);
      return;
    }
    if (requestedSection === "plaza") {
      setSection("gallery");
      return;
    }
    if (requestedSection === "workflows") {
      setSection("agents");
      setActiveAgentCode((current) => current || agents[0]?.code || INFINITE_CANVAS_CODE);
      return;
    }
    if (!selectedAgentCode && !selectedModelCode) setSection("models");
  }, [agents, isWorkbench, pathname, requestedSection, selectedAgentCode, selectedModelCode]);

  useEffect(() => {
    if (!isWorkbench || section !== "models" || !models.length) return;
    const matchesMode = (model: Model) => {
      if (requestedMode === "chat") return isChatModel(model);
      if (requestedMode === "image" || requestedMode === "video") return model.category === requestedMode;
      if (requestedMode === "audio") return isStandaloneAudioModel(model);
      return true;
    };
    const selected = models.find((model) => model.code === activeModelCode);
    if (selected && matchesMode(selected)) return;
    setActiveModelCode(models.find(matchesMode)?.code || models[0]?.code);
  }, [activeModelCode, isWorkbench, models, requestedMode, section]);

  useEffect(() => {
    if (!activeModelCode) {
      setActiveModel(null);
      return;
    }
    const fallback = models.find((model) => model.code === activeModelCode) || null;
    const controller = new AbortController();
    apiForLocale<Model>(`/api/models/${encodeURIComponent(activeModelCode)}`, locale, { signal: controller.signal })
      .then((model) => setActiveModel(model || fallback))
      .catch((error) => {
        if (error?.name !== "AbortError") setActiveModel(fallback);
      });
    return () => controller.abort();
  }, [activeModelCode, locale, models]);

  useEffect(() => {
    if (!activeModel) return;
    setMountedModels((current) => ({ ...current, [activeModel.code]: activeModel }));
  }, [activeModel]);

  const openStudio = useCallback((target: StudioSection) => {
    setSection(target);
    if (target === "models") {
      setActiveAgentCode(undefined);
      router.push("/app");
      return;
    }
    if (target === "agents") {
      setActiveAgentCode((current) => current || agents[0]?.code || INFINITE_CANVAS_CODE);
      router.push("/app?section=workflows");
      return;
    }
    router.push("/app?section=plaza");
  }, [agents, router]);

  const selectInlineModel = useCallback((code: string) => {
    const selected = models.find((model) => model.code === code);
    if (!selected) return;
    setActiveModelCode(code);
    setActiveAgentCode(undefined);
    setSection("models");
    router.replace("/app");
  }, [models, router]);

  const selectWorkflow = useCallback((code: string) => {
    setActiveAgentCode(code);
    setActiveModelCode(undefined);
    setActiveModel(null);
    setSection("agents");
    router.replace("/app?section=workflows");
  }, [router]);

  const desktopRail = (
    <aside className="pico-premium-rail" aria-label={t("nav.pageNav")}>
      <div className="pico-premium-rail-logo" aria-label={brandName}>{brandName.slice(0, 1).toUpperCase()}</div>
      <div className="pico-premium-rail-actions">
        <button type="button" className={navClass(isWorkbench && section === "models")} onClick={() => openStudio("models")}>
          <Sparkles size={19} /><span>{t("nav.workspace")}</span>
        </button>
        <button type="button" className={navClass(isWorkbench && section === "agents")} onClick={() => openStudio("agents")}>
          <Workflow size={19} /><span>{t("category.workflow")}</span>
        </button>
        <button type="button" className={navClass(isWorkbench && section === "gallery")} onClick={() => openStudio("gallery")}>
          <LibraryBig size={19} /><span>{t("nav.models")}</span>
        </button>
        <span className="pico-premium-rail-divider" />
        <Link href="/app/api-docs" className={navClass(pathname.startsWith("/app/api-docs"))}>
          <KeyRound size={19} /><span>API Key</span>
        </Link>
        <Link href="/app/wallet" className={navClass(pathname.startsWith("/app/wallet"))}>
          <WalletCards size={19} /><span>{t("nav.wallet")}</span>
        </Link>
        <Link href="/app/settings" className={navClass(pathname.startsWith("/app/settings"))}>
          <Settings size={19} /><span>{t("nav.settings")}</span>
        </Link>
      </div>
      <div className="pico-premium-rail-account">
        <Link href="/app/wallet" className="pico-premium-balance" title={t("nav.wallet")}>
          <span>{t("common.compute")}</span>
          <strong>{wallet?.compute_balance?.toFixed(2) ?? "0.00"}</strong>
        </Link>
        <Link href="/app/settings" className="pico-premium-account-avatar" aria-label={t("nav.settings")}>
          {(user?.nickname || user?.email || "P").slice(0, 1).toUpperCase()}
        </Link>
      </div>
    </aside>
  );

  const mobileDock = (
    <nav className="pico-premium-mobile-dock" aria-label={t("nav.pageNav")}>
      <button type="button" className={navClass(isWorkbench && section === "models")} onClick={() => openStudio("models")}><Sparkles size={18} /><span>{t("nav.short.workspace")}</span></button>
      <button type="button" className={navClass(isWorkbench && section === "agents")} onClick={() => openStudio("agents")}><Workflow size={18} /><span>{t("category.workflow")}</span></button>
      <button type="button" className={navClass(isWorkbench && section === "gallery")} onClick={() => openStudio("gallery")}><LibraryBig size={18} /><span>{t("nav.models")}</span></button>
      <Link href="/app/api-docs" className={navClass(pathname.startsWith("/app/api-docs"))}><KeyRound size={18} /><span>API</span></Link>
      <Link href="/app/wallet" className={navClass(pathname.startsWith("/app/wallet"))}><WalletCards size={18} /><span>{t("nav.short.wallet")}</span></Link>
      <Link href="/app/settings" className={navClass(pathname.startsWith("/app/settings"))}><Settings size={18} /><span>{t("nav.short.settings")}</span></Link>
    </nav>
  );

  const renderAgentWorkspace = (workflowCode: string) => {
    if (workflowCode === INFINITE_CANVAS_CODE) return <InfiniteCanvasWorkspace key={workflowCode} authenticated={Boolean(user)} />;
    if (workflowCode === VIRAL_REMAKE_CODE) {
      return <InfiniteCanvasWorkspace key={workflowCode} authenticated={Boolean(user)} workflowCode={VIRAL_REMAKE_CODE} initialTemplateID="viral-remake" />;
    }
    if (workflowCode === VIDEO_REMAKE_CODE) {
      return <InfiniteCanvasWorkspace key={workflowCode} authenticated={Boolean(user)} workflowCode={VIDEO_REMAKE_CODE} initialTemplateID="video-remake" />;
    }
    return <AgentWorkspace key={workflowCode} code={workflowCode} />;
  };

  const studioContent = () => {
    const workflowCode = activeAgentCode || (section === "agents" ? agents[0]?.code || INFINITE_CANVAS_CODE : "");
    const catalogMessage = modelsError || (modelsLoading ? "正在读取模型目录…" : undefined);
    const openModels = Object.values(mountedModels);
    if (activeModel && !mountedModels[activeModel.code]) openModels.push(activeModel);
    // Keep every opened model and workflow studio mounted across model switches
    // and plaza visits. Their conversation state, generation polling, prompt
    // drafts, media selections, and canvas nodes all live in these components.
    return (
      <>
        {section === "gallery" && (
          <ModelPlaza models={models} onSelectModel={selectInlineModel} loading={modelsLoading} error={modelsError} />
        )}
        {openModels.map((mountedModel) => {
          const active = section === "models" && mountedModel.code === activeModelCode;
          return (
            <div key={`${user?.public_id || "guest"}:${mountedModel.code}`} className={active ? "pico-studio-pane" : "hidden"} aria-hidden={!active}>
              <ModelWorkspace
                model={mountedModel}
                conversationScope={user?.public_id || "guest"}
                models={creatableModels}
                workflows={agents}
                onSelectModel={selectInlineModel}
                onSelectWorkflow={selectWorkflow}
                onOpenModelPicker={() => undefined}
                onRecharge={() => setShowRecharge(true)}
                hideWorkspaceAccountActions
              />
            </div>
          );
        })}
        {section === "models" && !activeModel && (
          // Keep the complete composer visible while the catalog request is
          // pending. A slow catalog must not replace the app with a blank view.
          <StudioUnavailable
            models={models}
            catalogError={catalogMessage}
            balance={wallet?.compute_balance}
            onOpenPlaza={() => openStudio("gallery")}
            onRecharge={() => setShowRecharge(true)}
          />
        )}
        {workflowCode && (
          <div className={section === "agents" ? "contents" : "hidden"} aria-hidden={section !== "agents"}>
            {renderAgentWorkspace(workflowCode)}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="pico-premium-shell">
      <Suspense fallback={null}>
        <QueryStateBridge onChange={handleQueryState} />
      </Suspense>
      <main className="pico-premium-main">
        <header className="pico-premium-topbar">
          <div className="pico-premium-wordmark">
            <span>{brandName}</span>
            <small>{isWorkbench ? "AI STUDIO" : pageTitle}</small>
          </div>
          <div className="pico-premium-topbar-meta">
            {isWorkbench && <button type="button" onClick={() => setShowRecharge(true)} className="pico-premium-recharge">{t("common.recharge")}</button>}
            <span className="pico-premium-user-name">{user?.nickname || user?.email || `${brandName} ${ts("用户")}`}</span>
            <WorkbenchTopActions onRecharge={!isWorkbench ? () => setShowRecharge(true) : undefined} />
          </div>
        </header>
        <div className={clsx("pico-premium-content", isWorkbench && "is-studio")}>{isWorkbench ? studioContent() : children}</div>
      </main>
      {desktopRail}
      {mobileDock}
      <RechargeModal
        open={showRecharge}
        onClose={() => setShowRecharge(false)}
        onSuccess={() => api<Wallet>("/api/wallet").then(setWallet)}
      />
    </div>
  );
}
