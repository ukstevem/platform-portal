"use client";

import { useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { AmbientBackdrop } from "@platform/ui";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const apps = [
  {
    name: "Timesheets",
    href: "/timesheets/",
    description: "Weekly timesheet entry, project hours reporting, and overtime tracking.",
  },
  {
    name: "Document Control",
    href: "/documents/",
    description: "Upload, manage, and track engineering drawings and project documents.",
    disabled: true,
  },
  {
    name: "Job Cards",
    href: "/jobcards/",
    description: "Create and manage job cards for workshop and site work.",
    disabled: true,
  },
  {
    name: "Operations",
    href: "/operations/",
    description: "Project cost overview combining labour hours, purchase orders, and invoices.",
  },
  {
    name: "QR Scanner",
    href: "/scanner/",
    description: "Scan QR-coded documents and automatically file them by type.",
  },
  {
    name: "Laser Quote",
    href: "/laserquote/",
    description: "Import laser cutter nesting files, price parts, and generate quotes.",
  },
  {
    name: "Assembly Viewer",
    href: "/assembly/",
    description: "View 3D assembly models with interactive tree navigation and STL preview.",
  },
  {
    name: "Beam Nesting",
    href: "/nesting/",
    description: "Optimise beam cutting layouts to minimise waste from stock lengths.",
  },
  {
    name: "Material Certs",
    href: "/matl-cert/",
    description: "Track and trace material certificates against project deliverables.",
  },
  {
    name: "Employee Presence",
    href: "/employee-presence/",
    description: "Track on-site employee presence and attendance.",
  },
  {
    name: "Orderbook",
    href: "/orderbook/",
    description: "Project intake, contract values, and item-level lifecycle status.",
  },
  {
    name: "PO Analysis",
    href: "/po-analysis/",
    description: "Analyse purchase orders against project budgets and supplier spend.",
  },
];

export default function PortalHome() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<"apps" | "kiosk">("apps");

  const kioskScreens = [
    {
      name: "Laser Production",
      href: "/laserquote/production/?kiosk=true",
      description: "Workshop production queue, completion, and collection tracking.",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden" style={{ background: "#050d1c" }}>
        <AmbientBackdrop src="/photos/signin-01.jpg" variant="full" />
        <div className="relative flex items-center justify-center min-h-screen p-6">
          <div
            className="w-full max-w-md rounded-[10px] p-9 relative overflow-hidden"
            style={{
              background:
                "linear-gradient(165deg,rgba(12,45,90,0.92) 0%,rgba(10,35,72,0.94) 55%,rgba(7,26,54,0.96) 100%)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(22,58,106,0.9)",
              boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pss-logo-reversed.png" alt="Power System Services" className="h-10 w-auto mb-6" />
            <div className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: "var(--pss-sky)" }}>
              Platform · Sign in
            </div>
            <h1 className="text-[26px] font-bold mt-1.5 tracking-tight text-white">
              Welcome back.
            </h1>
            <p className="text-sm mt-1" style={{ color: "#97a8c2" }}>
              Sign in to access the PSS platform.
            </p>
            <div className="mt-6">
              <AuthButton redirectTo="/auth/callback" />
            </div>
            <div className="border-t mt-6 pt-4 text-xs" style={{ borderColor: "#0c2d5a", color: "#5e7396" }}>
              PSS Power System Services · Internal use only
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <section
        className="relative overflow-hidden rounded-md mb-7 px-7 py-6 flex items-center gap-6"
        style={{ background: "var(--pss-navy)", color: "#eef4fb", minHeight: 132 }}
      >
        <AmbientBackdrop src="/photos/home-01.jpg" variant="hero" position="center 55%" />
        <div className="relative flex-1">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: "var(--pss-sky)" }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div className="text-[26px] font-bold mt-1.5 tracking-tight">
            {greeting()}{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}.
          </div>
          <div className="text-sm mt-1" style={{ color: "#c2cce0" }}>
            Power System Services Platform
          </div>
        </div>
      </section>

      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setTab("apps")}
          className={`pb-2 text-sm font-medium ${tab === "apps" ? "border-b-2 border-current" : "text-gray-400"}`}
          style={tab === "apps" ? { color: "var(--pss-navy)" } : undefined}
        >
          Applications
        </button>
        <button
          onClick={() => setTab("kiosk")}
          className={`pb-2 text-sm font-medium ${tab === "kiosk" ? "border-b-2 border-current" : "text-gray-400"}`}
          style={tab === "kiosk" ? { color: "var(--pss-navy)" } : undefined}
        >
          Kiosk Views
        </button>
      </div>

      {tab === "apps" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) =>
            app.disabled ? (
              <div
                key={app.href}
                aria-disabled="true"
                className="block border rounded-lg p-5 bg-gray-100 opacity-60 cursor-not-allowed select-none"
              >
                <h2 className="text-lg font-semibold mb-2 text-gray-400">
                  {app.name}
                </h2>
                <p className="text-sm text-gray-400">{app.description}</p>
              </div>
            ) : (
              <a
                key={app.href}
                href={app.href}
                className="block border rounded-lg p-5 hover:shadow-md transition-shadow bg-white group"
              >
                <h2
                  className="text-lg font-semibold mb-2 group-hover:underline"
                  style={{ color: "var(--pss-navy)" }}
                >
                  {app.name}
                </h2>
                <p className="text-sm text-gray-500">{app.description}</p>
              </a>
            )
          )}
        </div>
      )}

      {tab === "kiosk" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kioskScreens.map((screen) => (
            <a
              key={screen.href}
              href={screen.href}
              className="block border rounded-lg p-5 hover:shadow-md transition-shadow bg-white group border-dashed"
            >
              <h2
                className="text-lg font-semibold mb-2 group-hover:underline"
                style={{ color: "var(--pss-navy)" }}
              >
                {screen.name}
              </h2>
              <p className="text-sm text-gray-500">{screen.description}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
