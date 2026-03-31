"use client";

import { useAuth } from "@platform/auth/AuthProvider";
import { AuthButton } from "@platform/auth/AuthButton";
import { PageHeader } from "@platform/ui";
import { AssetTable } from "@/components/AssetTable";

const CATEGORIES = [
  { value: "machine", label: "Machine", prefix: "MCH" },
  { value: "vehicle", label: "Vehicle", prefix: "VEH" },
  { value: "fire-extinguisher", label: "Fire Extinguisher", prefix: "FEX" },
];

const SUBTYPES = {
  machine: [
    { value: "CRN", label: "Crane" },
    { value: "DRL", label: "Drill" },
    { value: "GRN", label: "Grinder" },
    { value: "PRB", label: "Press Brake" },
    { value: "GIL", label: "Guillotine" },
    { value: "SAW", label: "Band Saw" },
    { value: "LTH", label: "Lathe" },
    { value: "WLD", label: "Welder" },
  ],
  vehicle: [
    { value: "VAN", label: "Van" },
    { value: "UTE", label: "Pickup/Ute" },
    { value: "FLT", label: "Forklift" },
    { value: "TRK", label: "Truck" },
    { value: "CAR", label: "Car" },
  ],
  "fire-extinguisher": [
    { value: "FOA", label: "Foam" },
    { value: "CO2", label: "CO2" },
    { value: "DPW", label: "Dry Powder" },
    { value: "WAT", label: "Water" },
  ],
};

export default function AssetsPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-600">Sign in to manage assets</p>
        <AuthButton redirectTo="/scanner/assets" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Physical Assets" />
      <AssetTable
        title="Asset"
        categories={CATEGORIES}
        subtypes={SUBTYPES}
        showColumns={["location", "manufacturer", "model", "serial_number"]}
      />
    </div>
  );
}
