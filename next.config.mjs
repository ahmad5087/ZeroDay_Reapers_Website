/** @type {import('next').NextConfig} */

// Portfolio is a separate Vercel deployment served under /portfolio via rewrites.
// Set PORTFOLIO_URL in Vercel env (e.g. https://zerodayreapers-portfolio.vercel.app).
// Falls back to localhost:3001 for local dev (run the portfolio app on port 3001).
const PORTFOLIO_URL = process.env.PORTFOLIO_URL || "http://localhost:3001";

const nextConfig = {
  async rewrites() {
    return [
      { source: "/portfolio", destination: `${PORTFOLIO_URL}/portfolio` },
      { source: "/portfolio/:path*", destination: `${PORTFOLIO_URL}/portfolio/:path*` },
    ];
  },
};

export default nextConfig;
