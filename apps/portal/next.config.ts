import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@platform/supabase", "@platform/auth", "@platform/ui"],
};

export default nextConfig;
