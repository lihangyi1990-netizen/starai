"use client";

import { useI18n } from "@/i18n/I18nProvider";

export type AgentDisplayStep = {
  icon?: string;
  title: string;
  subtitle?: string;
  tags?: string[];
};

// `gradient` used to be here too, holding `from-… via-… to-white` classes. It had
// no reader anywhere in the app, so the classes were dead; see AGENT_THEMES in
// categoryMeta.ts for why the per-agent hue went with it.
export type AgentLandingTheme = {
  iconBg: string;
  pill: string;
  accent: string;
};

export function AgentLanding({
  workflowIcon,
  workflowName,
  workflowDescription,
  heroTags,
  features,
  activeIndex,
  onSelect,
  theme,
  generationType,
  compactOnMobile = false,
}: {
  workflowIcon: string;
  workflowName: string;
  workflowDescription: string;
  heroTags: string[];
  features: AgentDisplayStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  theme: AgentLandingTheme;
  generationType: "image" | "video";
  compactOnMobile?: boolean;
}) {
  const { ts } = useI18n();
  const translatedHeroTags = heroTags.map((tag) => ts(tag));
  const safeFeatures = features.length
    ? features
    : [
        { icon: "🔍", title: ts("智能分析"), subtitle: ts("理解你的创作意图与商品卖点") },
        { icon: "✅", title: ts("方案确认"), subtitle: ts("生成前可确认提示词和创作方向") },
        { icon: generationType === "video" ? "🎬" : "🖼️", title: generationType === "video" ? ts("视频生成") : ts("图片生成"), subtitle: ts("按选定场景输出可用素材") },
      ];
  const active = safeFeatures[Math.min(activeIndex, safeFeatures.length - 1)] || safeFeatures[0];
  const activeTags = active.tags?.length ? active.tags : translatedHeroTags.slice(0, 4);
  return (
    <div className={`agent-landing-shell scrollbar-none flex min-h-0 flex-col justify-start overflow-y-auto overscroll-contain py-1 ${compactOnMobile ? "min-h-[420px] flex-none sm:min-h-0 sm:flex-1" : "flex-1"}`}>
      <div className="shrink-0 -translate-y-1 pt-0 text-center sm:-translate-y-2 sm:pt-1 lg:pt-2">
        <div className={"mb-1.5 inline-flex items-center gap-2 rounded-full border border-white/60 px-3 py-1 text-[11px] font-semibold dark:border-white/10 sm:px-4 sm:text-xs " + theme.pill}>
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          {generationType === "video" ? ts("视频智能体") : ts("图片智能体")}
        </div>
        <div className="flex items-center justify-center gap-3">
          <div className={"flex h-9 w-9 items-center justify-center rounded-lg text-xl shadow-sm sm:h-11 sm:w-11 sm:text-2xl " + theme.iconBg}>{workflowIcon}</div>
          <h1 title={workflowName} className="max-w-[min(78vw,960px)] truncate text-xl font-black tracking-normal text-gray-900 dark:text-white sm:text-3xl">{workflowName}</h1>
        </div>
        {workflowDescription && <p className="mx-auto mt-2 max-w-2xl px-3 text-xs leading-5 text-gray-500 dark:text-gray-300 sm:text-sm">{workflowDescription}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:mt-3 sm:gap-2">
          {translatedHeroTags.map((tag, index) => (
            <span key={`${tag}-${index}`} title={tag} className="max-w-[180px] truncate rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[11px] text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:px-3 sm:py-1 sm:text-xs">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className={`agent-showcase min-h-0 shrink-0 items-center sm:pt-4 lg:pt-2 ${compactOnMobile ? "pt-3" : "pt-4"}`}>
        <div className="agent-feature-list mx-auto w-full max-w-[300px] gap-3">
          {safeFeatures.slice(0, 4).map((item, index) => {
            const selected = activeIndex === index;
            return (
              <button
                key={`${item.title}-${index}`}
                type="button"
                onClick={() => onSelect(index)}
                className={
                  "group box-border w-full min-w-0 max-w-full overflow-hidden rounded-lg border p-4 text-left transition duration-300 dark:hover:shadow-black/30 " +
                  (selected ? "border-blue-300 bg-white dark:border-blue-500/40 dark:bg-white/10" : "border-gray-200 bg-white hover:border-blue-200 hover:bg-white dark:border-white/10 dark:bg-transparent dark:hover:border-blue-500/25 dark:hover:bg-blue-500/5")
                }
              >
                <div className="flex items-center gap-3">
                  <div className={"flex h-10 w-10 items-center justify-center rounded-lg text-lg transition duration-300 " + (selected ? theme.iconBg : "bg-sunk text-ink-mid")}>
                    {item.icon || "•"}
                  </div>
                  <div className="min-w-0">
                    <div title={item.title} className="truncate text-sm font-bold text-gray-900 dark:text-white">{item.title}</div>
                    {item.subtitle && <div title={item.subtitle} className="mt-1 truncate text-xs text-gray-400">{item.subtitle}</div>}
                  </div>
                  {selected ? <span className="ml-auto text-blue-600">›</span> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className={`agent-feature-card group mx-auto flex w-full max-w-[640px] flex-col justify-center overflow-hidden rounded-lg border border-blue-300/70 bg-white p-4 transition duration-300 dark:border-blue-500/30 dark:bg-transparent dark:shadow-black/30 dark:hover:bg-blue-500/[0.04] sm:min-h-[260px] sm:p-5 lg:min-h-[280px] lg:p-6 ${compactOnMobile ? "min-h-[210px] max-h-[240px]" : "min-h-[230px] max-h-[280px]"}`}>
          <div className="mb-4 flex items-center justify-between gap-3 lg:mb-5">
            <span className="rounded-lg bg-blue-600/10 px-3 py-2 text-sm font-black text-blue-700 dark:text-blue-200">{String(Math.min(activeIndex + 1, safeFeatures.length)).padStart(2, "0")}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
              {generationType === "video" ? ts("支持视频生成链路") : ts("支持图片生成链路")}
            </span>
          </div>
          <div className="flex items-start gap-4 lg:gap-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sunk text-2xl text-ink transition duration-300 sm:h-14 sm:w-14 lg:h-16 lg:w-16">
              {active.icon || workflowIcon}
            </div>
            <div className="min-w-0">
              <h2 title={active.title} className="line-clamp-2 text-lg font-black tracking-normal text-gray-900 dark:text-white sm:text-xl lg:text-2xl">{active.title}</h2>
              <p title={active.subtitle || undefined} className="mt-2 line-clamp-3 max-w-[470px] text-xs leading-6 text-gray-500 dark:text-gray-300 sm:text-sm lg:mt-4 lg:leading-7">
                {active.subtitle || ts("输入商品、素材或创意需求，系统会自动理解目标场景、生成策略和输出参数。")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 lg:mt-5">
                {activeTags.map((tag, index) => (
                  <span key={`${tag}-${index}`} title={tag} className="max-w-[170px] truncate rounded-lg bg-blue-600/10 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-2 lg:mt-5">
            {safeFeatures.slice(0, 4).map((feature, index) => (
              <button
                key={`${feature.title}-${index}`}
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`${ts("切换到")} ${feature.title}`}
                className={(index === activeIndex ? "h-3 w-9 bg-blue-600" : "h-3 w-3 bg-gray-300/70 hover:bg-blue-300 dark:bg-white/20 dark:hover:bg-blue-300/70") + " rounded-full transition-all duration-300"}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
