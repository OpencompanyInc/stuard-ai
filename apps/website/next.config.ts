import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip type checking during build - lint script handles it separately.
    // This avoids React types conflicts in the pnpm monorepo.
    ignoreBuildErrors: true,
  },
  images: {
    // Optimize images: serve modern formats (WebP/AVIF), resize on-demand
    formats: ["image/avif", "image/webp"],
    // Allow images from any HTTPS source for blog content
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    // Minimize image sizes for common breakpoints
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
};

export default nextConfig;
