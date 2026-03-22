/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Produces a self-contained Node.js server in .next/standalone/.
  // Required for the Docker / Railway deployment — the Dockerfile copies this
  // output and runs it with `node server.js`.
  output: "standalone",

  // Keep Admin SDK on Node; avoids bundler issues with optional/native deps
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },

  webpack: (config) => {
    // PDF.js (used by react-pdf) attempts to require 'canvas' in Node
    // environments where it is not installed.  Aliasing it to false tells
    // webpack to substitute an empty module, preventing build / runtime errors
    // in headless Linux containers (Docker / Railway).
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
