import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Manrope, Sora } from "next/font/google";
import { MotionProvider } from "@/components/ui/MotionProvider";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { getThemePreferenceFromCookie, THEME_BOOT_SCRIPT, THEME_COOKIE } from "@/lib/theme";
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
  description: "SPOKES Skills for Life student portal. Sign in to see today's next step toward a job.",
  applicationName: "VisionQuest",
  icons: {
    icon: "/spokes-logo.png",
    shortcut: "/spokes-logo.png",
    apple: "/spokes-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1628" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const preference = getThemePreferenceFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  const nonce = (await headers()).get("x-csp-nonce") ?? undefined;

  return (
    <html lang="en" data-theme={preference === "system" ? undefined : preference} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${manrope.variable} ${sora.variable} antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                     focus:rounded-full focus:bg-[var(--ink-strong)] focus:px-4 focus:py-2
                     focus:text-sm focus:text-white"
        >
          Skip to main content
        </a>
        <ThemeProvider initialPreference={preference}>
          <MotionProvider>
            {children}
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
