/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Emits a self-contained server bundle with only the node_modules actually reached, which is
  // what keeps the runtime image small without vendoring a pnpm workspace into it.
  output: 'standalone',
  // The workspace root, so tracing follows symlinked workspace packages.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // The build must fail on a type error rather than ship a broken page.
  typescript: { ignoreBuildErrors: false },

  poweredByHeader: false,

  // `@facturx/core` ships a real dual-format build (`pnpm --filter @facturx/core build`), so no
  // transpilation or extension aliasing is needed here - Next resolves it like any other package.

  experimental: {
    serverActions: {
      // Uploads are capped well below this by the route handler; this only lifts Next's own limit
      // out of the way so the handler can return a proper French error instead of a framework 413.
      bodySizeLimit: '25mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
