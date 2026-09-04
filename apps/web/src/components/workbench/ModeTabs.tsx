"use client";

import { Boxes, Headphones, ImageIcon, MessageCircle, Play } from "lucide-react";
import { clsx } from "clsx";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * The workbench previously had no mode selector: users landed on whichever
 * model the catalog happened to return first and could not tell that image,
 * video and audio generation existed at all. Mode is the product's primary
 * axis — "what do I want to make" precedes "which model" — so it gets a
 * permanent strip directly above the composer.
 *
 * Naming and channel colors are authoritative here and must match the landing
 * page: 对话 / 生图 / 视频 / 音频 / 工作流. Do not reintroduce 「聊天」or
 * 「图片」as synonyms (see design-concept/APP-SPEC.md).
 *
 * Colors come from the `--pico-premium-*` / `--pico-ch-*` tokens on
 * `.pico-premium-shell` rather than Tailwind's palette, so this strip follows
 * the shell when it is converted to the light Style A palette instead of
 * needing a second edit.
 */
export type WorkbenchMode = "chat" | "image" | "video" | "audio" | "flow";

const MODE_CHANNEL: Record<WorkbenchMode, string> = {
  chat: "var(--pico-ch-chat)",
  image: "var(--pico-ch-image)",
  video: "var(--pico-ch-video)",
  audio: "var(--pico-ch-audio)",
  flow: "var(--pico-ch-flow)",
};

const MODE_ICON: Record<WorkbenchMode, typeof MessageCircle> = {
  chat: MessageCircle,
  image: ImageIcon,
  video: Play,
  audio: Headphones,
  flow: Boxes,
};

export function ModeTabs({
  active,
  counts,
  onSelect,
  className,
}: {
  active: WorkbenchMode;
  /**
   * Number of usable models (or workflows, for `flow`) per mode. A mode with
   * nothing published is shown as unavailable rather than letting the click
   * land on an empty workspace.
   */
  counts?: Partial<Record<WorkbenchMode, number>>;
  onSelect: (mode: WorkbenchMode) => void;
  className?: string;
}) {
  const { td } = useI18n();
  const modes: { key: WorkbenchMode; label: string }[] = [
    { key: "chat", label: td("mode.chat", "对话") },
    { key: "image", label: td("mode.image", "生图") },
    { key: "video", label: td("mode.video", "视频") },
    { key: "audio", label: td("mode.audio", "音频") },
    { key: "flow", label: td("mode.flow", "工作流") },
  ];

  return (
    // These controls change the route (`/app?mode=…`) rather than swapping an
    // in-place panel, so this is navigation. A `tablist` would promise a
    // `tabpanel` relationship via aria-controls that does not exist here.
    <nav
      aria-label={td("workbench.modeLabel", "选择创作模式")}
      className={clsx("flex overflow-x-auto", className)}
      style={{ borderBottom: "1px solid var(--pico-premium-line)" }}
    >
      {modes.map(({ key, label }) => {
        const Icon = MODE_ICON[key];
        const isActive = key === active;
        const count = counts?.[key];
        // `undefined` means "not counted yet" — only an explicit zero disables.
        const unavailable = count === 0;
        const channel = MODE_CHANNEL[key];
        return (
          <button
            key={key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            disabled={unavailable}
            title={unavailable ? td("workbench.modeEmpty", "这个模式暂时没有可用模型") : undefined}
            onClick={() => onSelect(key)}
            className={clsx(
              "flex shrink-0 items-center gap-2 px-4 py-3 text-sm transition-colors",
              isActive && "font-medium",
              unavailable && "cursor-not-allowed",
            )}
            style={{
              borderBottom: `2px solid ${isActive ? channel : "transparent"}`,
              color: isActive
                ? "var(--pico-premium-text)"
                : unavailable
                  ? "var(--pico-premium-line-strong)"
                  : "var(--pico-premium-muted)",
            }}
          >
            <Icon size={16} strokeWidth={1.5} style={isActive ? { color: channel } : undefined} />
            {label}
            {typeof count === "number" && count > 0 && (
              <span className="tabular-nums text-xs" style={{ color: "var(--pico-premium-muted)" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
