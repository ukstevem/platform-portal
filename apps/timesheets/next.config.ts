import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/timesheets",
  trailingSlash: true,
  transpilePackages: ["@platform/supabase", "@platform/auth", "@platform/ui"],
};

export default nextConfig;
