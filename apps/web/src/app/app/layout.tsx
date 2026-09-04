"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { ForcedAnnouncementModal } from "@/components/ForcedAnnouncementModal";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const selectedModelCode = pathname.startsWith("/app/models/")
    ? pathname.split("/").pop()
    : undefined;
  const selectedAgentCode = pathname.startsWith("/app/agents/")
    ? pathname.split("/").pop()
    : undefined;

  useEffect(() => {
    // Style A is a single light palette. `.pico-premium-shell` used to force a
    // dark chrome regardless of this class, so the two never agreed: a visitor
    // on a light-mode OS got light component internals inside a dark shell.
    // Now the shell is light, so `.dark` must be off — otherwise every
    // `dark:` variant in the workbench renders light text on a white surface.
    //
    // Returning users may still have `theme: "dark"` in localStorage from the
    // old toggle (removed from WorkbenchUserMenu), so remove the class
    // explicitly rather than merely stopping to add it.
    //
    // To restore a dual theme: tokenize the literal colours in the
    // `.pico-premium-shell` region of globals.css, add a `.dark
    // .pico-premium-shell` block redeclaring the tokens, then bring the toggle
    // back. Flipping this line alone is not enough.
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <>
      <AppShell selectedModelCode={selectedModelCode} selectedAgentCode={selectedAgentCode}>{children}</AppShell>
      <ForcedAnnouncementModal />
    </>
  );
}
