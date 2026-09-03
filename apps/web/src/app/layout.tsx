import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { TunaSwimmer } from "@/components/TunaSwimmer";

export const metadata: Metadata = {
  title: "tuna",
  description: "把 AI 变简单的创作工作台",
  icons: {
    icon: "/site-icon",
    shortcut: "/site-icon",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <I18nProvider>{children}</I18nProvider>
        <TunaSwimmer />
      </body>
    </html>
  );
}
