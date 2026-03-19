import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/documents",
  trailingSlash: true,
  transpilePackages: ["@platform/supabase", "@platform/auth", "@platform/ui"],
};

export default nextConfig;
