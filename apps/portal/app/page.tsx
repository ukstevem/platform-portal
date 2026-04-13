"use client";

import { useState } from "react";
import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";

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
  },
  {
    name: "Job Cards",
    href: "/jobcards/",
    description: "Create and manage job cards for workshop and site work.",
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
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pss-logo.png" alt="Power System Services" className="h-16 w-auto" />
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>
          Platform Portal
        </h1>
        <p className="text-gray-600">Sign in to access the PSS platform</p>
        <AuthButton redirectTo="/" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>
          Welcome{user.fullName ? `, ${user.fullName}` : ""}
        </h1>
        <p className="text-gray-500 mt-1">Power System Services Platform</p>
      </div>

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
          {apps.map((app) => (
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
          ))}
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
