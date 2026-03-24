"use client";

import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { DropZone } from "@/components/DropZone";
import { RecentJobs } from "@/components/RecentJobs";

export default function ScannerHome() {
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
          QR Scanner
        </h1>
        <p className="text-gray-600">Sign in to upload and file documents</p>
        <AuthButton redirectTo="/scanner/" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <PageHeader title="QR Document Scanner" />
      <DropZone />
      <RecentJobs />
    </div>
  );
}
