"use client";

import { AudioLines, Box, Image as ImageIcon, MessageSquare, Video, Workflow } from "lucide-react";

/**
 * Line icons for the model/agent categories, used wherever a model has no
 * `icon_url` of its own.
 *
 * These replace the emoji that used to sit in those slots. Emoji render in the
 * OS font, so they were the one part of the UI that ignored the design system
 * entirely — different shape, weight and colour on every platform, and full
 * colour on a palette that is otherwise white plus one channel colour.
 *
 * The colour is the channel colour and nothing else. `multi_collab` maps to the
 * flow channel (slate) rather than getting a sixth hue: there are five channels,
 * and a colour in this UI means "which channel", never "which card".
 * Kept in sync with `ch.*` in tailwind.config.ts and `--pico-ch-*` in globals.css.
 */
const CATEGORY_ICONS = {
  chat: { Icon: MessageSquare, color: "#2563eb" },
  multi_collab: { Icon: Workflow, color: "#475569" },
  image: { Icon: ImageIcon, color: "#059669" },
  video: { Icon: Video, color: "#7c3aed" },
  audio: { Icon: AudioLines, color: "#ea580c" },
} as const;

export function ModelCategoryIcon({
  category,
  className = "h-4 w-4",
}: {
  category?: string | null;
  className?: string;
}) {
  // Unknown categories get a neutral outline rather than a stand-in glyph, so a
  // new category added on the server side never renders as a decorative mark.
  const entry = CATEGORY_ICONS[(category ?? "") as keyof typeof CATEGORY_ICONS];
  const Icon = entry?.Icon ?? Box;
  return (
    <Icon
      className={className}
      strokeWidth={1.75}
      style={{ color: entry?.color ?? "var(--ink-soft, #9a9aa2)" }}
      aria-hidden
    />
  );
}
