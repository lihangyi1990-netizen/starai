"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FileText, Film, Image as ImageIcon, Music } from "lucide-react";
import { listAssets } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export type MentionAsset = {
  public_id: string;
  name: string;
  url: string;
  kind: string;
  asset_type?: string;
};

const KIND_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  doc: FileText,
};

/**
 * Lightweight `@` mention list for the asset library. Anchored above the
 * composer instead of using the ChatTopTools modal so that typing keeps
 * filtering the list.
 */
export default function AssetMentionPopover({
  open,
  query,
  kinds,
  onSelect,
  onClose,
  activeIndex,
  onActiveIndexChange,
  onItemsChange,
}: {
  open: boolean;
  query: string;
  /** Restrict the listing; omit to list every kind. */
  kinds?: string[];
  onSelect: (asset: MentionAsset) => void;
  onClose: () => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onItemsChange: (items: MentionAsset[]) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<MentionAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const singleKind = kinds && kinds.length === 1 ? kinds[0] : undefined;

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await listAssets({ q: q || undefined, kind: singleKind, page_size: 20 });
        const raw = Array.isArray(res?.items) ? res.items : [];
        const next: MentionAsset[] = raw
          .map((a: any) => ({
            public_id: String(a?.public_id || ""),
            name: String(a?.name || a?.public_id || ""),
            url: String(a?.url || ""),
            kind: String(a?.kind || "image").toLowerCase(),
            asset_type: a?.asset_type ? String(a.asset_type) : undefined,
          }))
          .filter((a: MentionAsset) => a.public_id && a.url)
          .filter((a: MentionAsset) => !kinds || kinds.includes(a.kind));
        setItems(next);
      } catch {
        // Unauthenticated or offline: stay out of the way instead of
        // interrupting the user mid-sentence.
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [kinds, singleKind]
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(query), 200);
    return () => window.clearTimeout(timer);
  }, [open, query, load]);

  useEffect(() => {
    if (!open) setItems([]);
  }, [open]);

  useEffect(() => {
    onItemsChange(items);
  }, [items, onItemsChange]);

  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const kindLabel = useMemo(
    () => (kind: string) => {
      if (kind === "image") return t("asset.image");
      if (kind === "video") return t("asset.video");
      if (kind === "doc") return t("asset.doc");
      if (kind === "audio") return t("canvas.kind.audio");
      return t("common.asset");
    },
    [t]
  );

  const typeLabel = useMemo(
    () => (type?: string) => {
      if (type === "role") return t("asset.role");
      if (type === "scene") return t("asset.scene");
      if (type === "prop") return t("asset.prop");
      return "";
    },
    [t]
  );

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-2 right-2 z-50 mb-2 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl sm:left-4 sm:right-auto sm:w-[22rem] dark:border-white/10 dark:bg-gray-900"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 border-b border-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
        <BookOpen size={13} className="shrink-0" />
        <span className="truncate">{t("asset.mentionHint")}</span>
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {loading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-gray-400">{t("common.loading")}</div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-gray-400">
            {query ? t("asset.mentionEmpty") : t("asset.noAssets")}
          </div>
        )}
        {items.map((item, index) => {
          const Icon = KIND_ICON[item.kind] || BookOpen;
          const type = typeLabel(item.asset_type);
          return (
            <button
              key={item.public_id}
              type="button"
              data-mention-index={index}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => onSelect(item)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                index === activeIndex ? "bg-gray-50 dark:bg-white/5" : ""
              }`}
            >
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-lg border border-gray-100 object-cover dark:border-white/10"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-400 dark:border-white/10 dark:bg-white/5">
                  <Icon size={14} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{item.name}</span>
                <span className="block truncate text-[11px] text-gray-400">
                  {kindLabel(item.kind)}
                  {type ? ` · ${type}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-full border-t border-gray-50 px-3 py-1.5 text-[11px] text-gray-400 dark:border-white/5"
      >
        Esc
      </button>
    </div>
  );
}
