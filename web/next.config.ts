import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent DNS prefetching leaking URLs (can be re-enabled for performance if needed)
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Prevent clickjacking: only allow framing from same origin
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Control referrer info sent to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable unused browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Content Security Policy — permissive enough for Firebase + Google Fonts
  // Tighten 'unsafe-eval' once Turbopack is stable in production
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-eval in dev; acceptable in prod with Turbopack
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' apis.google.com",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com data:",
      // Firebase Firestore, Auth, Storage, Cloud Run AI Worker
      "connect-src 'self' *.googleapis.com *.firebaseio.com *.cloudfunctions.net *.run.app wss://*.firebaseio.com",
      // User avatars and data URIs
      "img-src 'self' data: blob: *.googleusercontent.com",
      // Firebase Auth popup / OAuth
      "frame-src 'self' *.firebaseapp.com accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
