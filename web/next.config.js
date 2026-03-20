/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Admin SDK on Node; avoids bundler issues with optional/native deps
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
