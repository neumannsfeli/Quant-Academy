import type { Metadata, Viewport } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Quant Academy", template: "%s · Quant Academy" },
  description: "Learn it here. Prove it cold. Know when you are ready — interview preparation for quant trading and research roles.",
};

export const viewport: Viewport = { themeColor: "#0a0c10", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
