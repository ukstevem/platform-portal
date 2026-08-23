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
  title: "Erection Planner | PSS",
  description: "Power System Services - plan and document the site erection sequence",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
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
