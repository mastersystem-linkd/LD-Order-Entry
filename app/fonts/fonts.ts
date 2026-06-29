import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";

// Atelier type system (UI spec §3). Self-hosted Fontshare files for the two
// brand faces; JetBrains Mono from Google for tabular figures. No Inter/Roboto.

// UI / body — General Sans 400/500/600.
export const generalSans = localFont({
  src: [
    { path: "./GeneralSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./GeneralSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./GeneralSans-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

// Display — Clash Display 500/600 (page titles, the grand-total figure).
export const clashDisplay = localFont({
  src: [
    { path: "./ClashDisplay-Medium.woff2", weight: "500", style: "normal" },
    { path: "./ClashDisplay-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["General Sans", "system-ui", "sans-serif"],
});

// Numeric — JetBrains Mono with tabular figures (applied via the .num utility).
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
