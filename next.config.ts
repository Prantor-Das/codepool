import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Daytona's filesystem upload uses Node-only dynamic imports (notably
  // `form-data`). Keep the SDK native so those imports resolve at runtime.
  serverExternalPackages: ["@daytonaio/sdk", "form-data"],
};

export default nextConfig;
