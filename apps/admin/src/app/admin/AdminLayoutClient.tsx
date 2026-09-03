"use client";

import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The handoff page must exchange its one-time code before an admin session
  // exists; wrapping it in AdminShell would redirect it back to login first.
  if (pathname === "/admin/login" || pathname === "/admin/handoff") return <>{children}</>;
  return <AdminShell>{children}</AdminShell>;
}
