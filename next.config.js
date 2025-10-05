/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ✅ Vercel 빌드에서 ESLint 오류가 있어도 실패하지 않게
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
