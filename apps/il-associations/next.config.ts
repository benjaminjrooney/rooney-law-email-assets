import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The importer and exporters stream large files; keep them on the Node runtime.
  serverExternalPackages: ["exceljs", "yauzl", "postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "512mb" },
  },
};

export default nextConfig;
