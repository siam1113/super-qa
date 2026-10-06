/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
}

module.exports = nextConfig
