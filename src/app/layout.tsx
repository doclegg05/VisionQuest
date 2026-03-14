import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "VisionQuest — SPOKES Program Portal",
  description: "Your journey to self-sufficiency starts here. AI-powered goal coaching for workforce development.",
  applicationName: "VisionQuest",
  icons: {
    icon: "/spokes-logo.png",
    shortcut: "/spokes-logo.png",
    apple: "/spokes-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#10253e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${sora.variable} antialiased`}>
        {/* Skip to main content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                     focus:rounded-full focus:bg-[var(--ink-strong)] focus:px-4 focus:py-2
                     focus:text-sm focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
