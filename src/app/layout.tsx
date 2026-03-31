import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Manrope, Sora } from "next/font/google";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { getThemeFromCookie, THEME_COOKIE } from "@/lib/theme";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const nonce = headerStore.get("x-csp-nonce") ?? "";
  const cookieStore = await cookies();
  const theme = getThemeFromCookie(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang="en" nonce={nonce} data-theme={theme}>
      <body className={`${manrope.variable} ${sora.variable} antialiased`} nonce={nonce}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                     focus:rounded-full focus:bg-[var(--ink-strong)] focus:px-4 focus:py-2
                     focus:text-sm focus:text-white"
        >
          Skip to main content
        </a>
        <ThemeProvider initialTheme={theme}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
