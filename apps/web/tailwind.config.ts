import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: "#12D6A3",
        secondary: "#4F7CFF",
        accent: "#FFB020",
        danger: "#FF4D4F",
        dark: "#080D16",
        surface: "#F6F8FC",

        // Style A ("素白通道色"). Neutral surfaces + 1px lines carry the
        // structure; see design-concept/APP-SPEC.md.
        ink: {
          DEFAULT: "#18181B",
          mid: "#52525B",
          soft: "#9A9AA2",
        },
        line: {
          DEFAULT: "#E8E8EA",
          firm: "#D4D4D8",
        },
        sunk: "#FAFAFA",

        // Channel colors: one stable hue per creation mode, used site-wide as
        // the ONLY color semantics. Small-area identifiers only (3px bars,
        // icons, active states) — never large fills.
        ch: {
          chat: "#2563EB",
          image: "#059669",
          video: "#7C3AED",
          audio: "#EA580C",
          flow: "#475569",
        },
      },
    },
  },
  plugins: [],
};
export default config;
