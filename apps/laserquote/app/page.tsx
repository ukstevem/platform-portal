"use client";

import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { ImportForm } from "@/components/ImportForm";
import { ImportList } from "@/components/ImportList";

export default function LaserQuoteHome() {
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
          Laser Quote
        </h1>
        <p className="text-gray-600">Sign in to import nesting files and generate quotes</p>
        <AuthButton redirectTo="/laserquote/" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <PageHeader title="Laser Quote" />
      <ImportForm />
      <ImportList />
    </div>
  );
}
