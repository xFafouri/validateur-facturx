import { readFileSync } from 'node:fs';

/**
 * Loads the workspace-root `.env`.
 *
 * Next only reads `.env` files beside the app it is running, and this is a monorepo where the
 * database URL, the API URL and the mail relay are shared with the API - keeping two copies in
 * step by hand is exactly the sort of thing that silently stops being done. Parsed here rather
 * than with a library because there is no dotenv in this app's dependency tree and the format is
 * ours: `KEY=value`, `#` comments, optional single or double quotes.
 *
 * Anything already in the environment wins, so `SMTP_HOST=... next dev` still overrides the file.
 */
function loadWorkspaceEnv() {
  const path = new URL('../../.env', import.meta.url);

  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // No root .env is normal - in a container every value arrives through the environment.
    return;
  }

  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values run to an unescaped `#`.
      value = value.split(' #')[0].trim();
    }
    process.env[key] = value;
  }
}

loadWorkspaceEnv();

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
