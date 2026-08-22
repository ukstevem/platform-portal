import "./globals.css";
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { AuthProvider } from "@platform/auth/AuthProvider";
import { LayoutShell } from "@/components/LayoutShell";
import { ReactNode, Suspense } from "react";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "CAD Review | PSS",
  description: "Power System Services - review and size parts from a CAD model",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body style={{ fontFamily: "var(--font-montserrat), 'Montserrat', system-ui, sans-serif" }}>
        <AuthProvider>
          <Suspense>
            <LayoutShell>{children}</LayoutShell>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
