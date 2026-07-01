import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { Mesh } from "@/components/app-shell/mesh";
import { clashDisplay, generalSans, jetbrainsMono } from "./fonts/fonts";

export const metadata: Metadata = {
  title: "Order Entry System",
  description: "Order entry & 7-stage operations tracking",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${generalSans.variable} ${clashDisplay.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body>
        <Mesh />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
