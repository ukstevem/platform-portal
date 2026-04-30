"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@platform/auth/AuthProvider";

export default function AuthCallback() {
  const router = useRouter();
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) router.replace("/");
  }, [loading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-500">Signing you in…</p>
    </div>
  );
}
