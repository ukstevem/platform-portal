import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/assembly",
  trailingSlash: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@platform/supabase", "@platform/auth", "@platform/ui"],
};

export default nextConfig;
