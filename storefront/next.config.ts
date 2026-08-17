import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // The storefront is the workspace root — silences the multiple-lockfile
  // warning if a stray lockfile ever appears above this folder.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
