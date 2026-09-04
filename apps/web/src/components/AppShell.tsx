"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  KeyRound,
  LibraryBig,
  Settings,
  Sparkles,
  WalletCards,
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
import { ModelWorkspace, isModelCallable } from "./workbench/ModelWorkspace";
import { AgentWorkspace } from "./workbench/AgentWorkspace";
import { InfiniteCanvasWorkspace } from "./workbench/InfiniteCanvasWorkspace";
import { ModelPlaza } from "./workbench/ModelPlaza";
import { ModeTabs, type WorkbenchMode } from "./workbench/ModeTabs";
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

/**
 * Which creation mode a catalog row belongs to. Mirrors the `matchesMode`
 * filter used when auto-selecting a model, so the mode strip cannot highlight
 * a mode that would not in fact select the current model.
 */
function modeOfModel(model: Model): CreationMode {
  if (isChatModel(model)) return "chat";
  if (model.category === "image" || model.category === "video") return model.category;
  if (isStandaloneAudioModel(model)) return "audio";
  return "chat";
}

function navClass(active: boolean) {
  return clsx("pico-premium-rail-item", active && "is-active");
}

/**
 * Shown while the catalog is still resolving, or when the selected mode has no
 * publishable model. Mode selection lives in the strip above this view, so this
 * component reflects the chosen mode instead of offering a second, competing
 * set of mode buttons.
 */
function StudioUnavailable({
  mode,
  models,
  onOpenPlaza,
  onRecharge,
  balance,
  catalogError,
}: {
  mode: WorkbenchMode;
  models: Model[];
  onOpenPlaza: () => void;
  onRecharge: () => void;
  balance?: number;
  catalogError?: string;
}) {
  const { td } = useI18n();
  const [draft, setDraft] = useState("");
  const modeModels = models.filter((item) =>
    mode === "chat" ? isChatModel(item) : mode === "audio" ? isStandaloneAudioModel(item) : item.category === mode,
  );
  const balanceKnown = typeof balance === "number";
  const balanceLow = balanceKnown && balance <= 0;
  const placeholder =
    mode === "image"
      ? td("landing.placeholder.image", "描述你想要的画面，越具体越好")
      : mode === "video"
        ? td("landing.placeholder.video", "描述镜头、动作和时长")
        : mode === "audio"
          ? td("landing.placeholder.audio", "写下要念的文字，或描述一段音乐")
          : td("landing.placeholder.chat", "今天想聊点什么？");

  // Colors come from the shell's own tokens rather than Tailwind's palette so
  // this view follows `.pico-premium-shell` when it is converted to the light
  // Style A palette. See the note on that rule in globals.css.
  const line = "1px solid var(--pico-premium-line)";

  return (
    <section className="mx-auto w-full max-w-[880px] px-5 py-10 sm:py-14" aria-label={td("workbench.title", "创作台")}>
      <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]" style={{ color: "var(--pico-premium-text)" }}>
        {td("workbench.empty.title", "从写下你想要的东西开始")}
      </h1>
      <p className="mt-3 text-sm leading-[1.8]" style={{ color: "var(--pico-premium-muted)" }}>
        {td("workbench.empty.desc", "上面选好模式，这里写需求。需要选的参数会在选定模型后出现。")}
      </p>

      <div className="mt-7 rounded-lg" style={{ border: line }}>
        <button
          type="button"
          onClick={onOpenPlaza}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          style={{ borderBottom: line }}
        >
          <span className="min-w-0">
            <span className="block text-[11px]" style={{ color: "var(--pico-premium-muted)" }}>
              {td("workbench.currentModel", "当前模型")}
            </span>
            <span className="block truncate text-sm font-medium" style={{ color: "var(--pico-premium-text)" }}>
              {publicText(
                modeModels[0]?.display_name,
                models.length
                  ? td("workbench.pickPublished", "选择已发布模型")
                  : td("workbench.loadingModel", "正在读取模型"),
              )}
            </span>
          </span>
          <span className="shrink-0 rounded-lg px-3 py-1.5 text-xs" style={{ border: line, color: "var(--pico-premium-muted)" }}>
            {td("workbench.change", "更换")}
          </span>
        </button>

        <div className="px-4 pt-4">
          <label className="sr-only" htmlFor="studio-draft">
            {td("workbench.draftLabel", "写下你的需求")}
          </label>
          <textarea
            id="studio-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            disabled={!modeModels.length}
            rows={5}
            className="w-full resize-none rounded-lg px-3.5 py-3 text-sm leading-[1.8] focus:outline-none disabled:cursor-not-allowed"
            style={{
              border: line,
              background: "var(--pico-premium-panel)",
              color: "var(--pico-premium-text)",
            }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-xs" style={{ color: "var(--pico-premium-muted)" }}>
            {models.length
              ? td("workbench.catalogReady", "已准备 {count} 个模型，选择后即可开始创作。", { count: models.length })
              : publicText(catalogError, td("workbench.catalogLoading", "正在读取模型目录。"))}
          </span>
          <button
            type="button"
            onClick={onOpenPlaza}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ border: line, color: "var(--pico-premium-muted)" }}
          >
            {td("workbench.browseModels", "浏览全部模型")}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3" style={{ border: line }}>
        <div className="min-w-0">
          <strong className="block text-sm font-medium" style={{ color: "var(--pico-premium-text)" }}>
            {!balanceKnown
              ? td("workbench.balance.unknown", "余额状态正在读取")
              : balanceLow
                ? td("workbench.balance.low", "算力余额不足")
                : td("workbench.balance.ready", "算力余额已就绪")}
          </strong>
          <span className="mt-1 block text-xs leading-6" style={{ color: "var(--pico-premium-muted)" }}>
            {!balanceKnown
              ? td("workbench.balance.unknownHint", "登录后会自动显示余额；生成前会再次校验。")
              : balanceLow
                ? td("workbench.balance.lowHint", "请先充值再开始创作。")
                : td("workbench.balance.readyHint", "生成前会自动校验余额，按已发布模型的售价扣费。")}
          </span>
        </div>
        <button
          type="button"
          onClick={onRecharge}
          className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--pico-premium-blue)" }}
        >
          {td("workbench.recharge", "去充值")}
        </button>
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
    // Prefer a callable (enabled + published) model for auto-selection so a
    // disabled/pending catalog entry that merely sorts first — e.g. an
    // internal test model — never becomes the default landing view. A model
    // opened by explicit code (selectedModelCode/gallery link) is unaffected;
    // this only governs the fallback when nothing is selected yet.
    const candidates = models.filter(matchesMode);
    const preferred = candidates.find(isModelCallable) || candidates[0];
    setActiveModelCode(preferred?.code || models[0]?.code);
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
      // Keep `?mode=` on the URL. Pushing a bare `/app` let the auto-select
      // effect re-pick the first model in the whole catalog, so returning to
      // the workbench from the plaza could silently change what you were making.
      router.push(requestedMode ? `/app?mode=${requestedMode}` : "/app");
      return;
    }
    if (target === "agents") {
      setActiveAgentCode((current) => current || agents[0]?.code || INFINITE_CANVAS_CODE);
      router.push("/app?section=workflows");
      return;
    }
    router.push("/app?section=plaza");
  }, [agents, requestedMode, router]);

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

  /**
   * Mode switching keeps the mode in the URL. `openStudio("models")` pushes a
   * bare `/app`, which silently drops `?mode=` and sends the auto-select effect
   * back to whichever model the catalog listed first — one of the ways users
   * lost track of what they were making.
   */
  const openMode = useCallback((mode: WorkbenchMode) => {
    if (mode === "flow") {
      setSection("agents");
      setActiveAgentCode((current) => current || agents[0]?.code || INFINITE_CANVAS_CODE);
      router.push("/app?section=workflows");
      return;
    }
    setSection("models");
    setActiveAgentCode(undefined);
    router.push(`/app?mode=${mode}`);
  }, [agents, router]);

  const activeMode: WorkbenchMode =
    section === "agents" ? "flow" : requestedMode || (activeModel ? modeOfModel(activeModel) : "chat");

  const showModeTabs = isWorkbench && section !== "gallery";

  const modeCounts = useMemo(() => {
    // While the catalog is still loading every count would be zero, which would
    // render every mode as unavailable. Report "unknown" instead.
    if (modelsLoading) return undefined;
    return {
      chat: models.filter(isChatModel).length,
      image: models.filter((model) => model.category === "image").length,
      video: models.filter((model) => model.category === "video").length,
      audio: models.filter(isStandaloneAudioModel).length,
      flow: agents.length,
    };
  }, [agents.length, models, modelsLoading]);

  const desktopRail = (
    <aside className="pico-premium-rail" aria-label={t("nav.pageNav")}>
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
    </aside>
  );

  const mobileDock = (
    <nav className="pico-premium-mobile-dock" aria-label={t("nav.pageNav")}>
      <button type="button" className={navClass(isWorkbench && section === "models")} onClick={() => openStudio("models")}><Sparkles size={18} /><span>{t("nav.short.workspace")}</span></button>
      <button type="button" className={navClass(isWorkbench && section === "agents")} onClick={() => openStudio("agents")}><Workflow size={18} /><span>{t("category.workflow")}</span></button>
      <button type="button" className={navClass(isWorkbench && section === "gallery")} onClick={() => openStudio("gallery")}><LibraryBig size={18} /><span>{t("nav.models")}</span></button>
      <Link href="/app/settings" className={navClass(pathname.startsWith("/app/settings") || pathname.startsWith("/app/wallet") || pathname.startsWith("/app/api-docs"))}><Settings size={18} /><span>{t("nav.short.settings")}</span></Link>
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
            mode={activeMode}
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
      <header className="pico-premium-topbar">
        <div className="pico-premium-wordmark">
          <span>{brandName}</span>
          <small>{isWorkbench ? "AI STUDIO" : pageTitle}</small>
        </div>
        <div className="pico-premium-topbar-meta">
          <Link href="/app/wallet" className="pico-premium-balance" title={t("nav.wallet")}>
            <span>{t("common.compute")}</span>
            <strong>{wallet?.compute_balance?.toFixed(2) ?? "0.00"}</strong>
          </Link>
          {isWorkbench && <button type="button" onClick={() => setShowRecharge(true)} className="pico-premium-recharge">{t("common.recharge")}</button>}
          <span className="pico-premium-user-name">{user?.nickname || user?.email || `${brandName} ${ts("用户")}`}</span>
          <WorkbenchTopActions onRecharge={!isWorkbench ? () => setShowRecharge(true) : undefined} />
        </div>
      </header>
      {desktopRail}
      <main className="pico-premium-main">
        {/* Mode is the first decision, so it sits between the topbar and the
            workspace rather than inside it — visible at every breakpoint and on
            every model. The plaza is a catalog view and has its own filters. */}
        {showModeTabs && (
          <ModeTabs active={activeMode} counts={modeCounts} onSelect={openMode} className="shrink-0 px-2 sm:px-4" />
        )}
        <div className={clsx("pico-premium-content", isWorkbench && "is-studio", showModeTabs && "has-mode-tabs")}>
          {isWorkbench ? studioContent() : children}
        </div>
      </main>
      {mobileDock}
      <RechargeModal
        open={showRecharge}
        onClose={() => setShowRecharge(false)}
        onSuccess={() => api<Wallet>("/api/wallet").then(setWallet)}
      />
    </div>
  );
}
