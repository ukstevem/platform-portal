"use client";

import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { NestingPage } from "@/components/NestingPage";

export default function Page() {
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
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>
          Beam Nesting
        </h1>
        <p className="text-gray-600">Sign in to access beam nesting</p>
        <AuthButton redirectTo="/nesting/" />
      </div>
    );
  }

  return <NestingPage />;
}
