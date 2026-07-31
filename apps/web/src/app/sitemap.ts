import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://validateur-facturx.fr';

/**
 * Single-page site for now, but the sitemap exists from day one because the whole Phase 0 thesis
 * is organic French search traffic ahead of the 1 September 2026 deadline, and there is no time
 * to wait on discovery.
 *
 * `changeFrequency: 'weekly'` is honest: the deadline countdown on the page changes daily, and the
 * rule content will be revised as DGFiP specifications firm up.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
