import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Tauri production build uses frontendDist "../out"
  output: 'export',
  images: {
    unoptimized: true,
  },
}

export default nextConfig
