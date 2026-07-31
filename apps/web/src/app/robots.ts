import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://validateur-facturx.fr';

/**
 * The API routes are disallowed not to hide them but because they are useless to a crawler: they
 * only answer POSTs, and letting a bot spend the validation rate limit on 405s would degrade the
 * service for real users.
 *
 * Indexing is gated on an explicit env flag so staging and preview deployments cannot accidentally
 * out-rank production for the terms this page exists to win.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true';

  if (!indexable) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
