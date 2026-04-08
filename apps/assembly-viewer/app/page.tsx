"use client";

import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { AssemblyViewerPanel } from "@/components/AssemblyViewerPanel";

export default function AssemblyViewerHome() {
  const { user, loading } = useAuth();

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
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>
          Assembly Viewer
        </h1>
        <p className="text-gray-600">Sign in to view 3D assembly models</p>
        <AuthButton redirectTo="/assembly/" />
      </div>
    );
  }

  return (
    <div className="p-4 h-[calc(100vh-3rem)]">
      <PageHeader title="Assembly Viewer" />
      <AssemblyViewerPanel />
    </div>
  );
}
