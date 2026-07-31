import type { Metadata } from 'next';
import './globals.css';

const SITE_NAME = 'Validateur Factur-X';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://validateur-facturx.fr';
const ALLOW_INDEXING = process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true';

/**
 * Metadata is written for French search intent, which is the entire point of this page existing.
 * The queries that matter are things people type in a panic: "valider facture électronique",
 * "erreur BR-CO-10", "mon PDF est-il conforme", "facturation électronique 1er septembre 2026".
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Validateur Factur-X gratuit — vérifiez la conformité de votre facture électronique',
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'Vérifiez gratuitement si votre facture électronique est conforme à la réforme française : contrôle Factur-X, CII et EN 16931, avec explication en français de chaque erreur. Sans inscription.',
  keywords: [
    'Factur-X',
    'facture électronique',
    'validateur Factur-X',
    'EN 16931',
    'CII',
    'facturation électronique 2026',
    'conformité facture',
    'BR-CO-10',
    'plateforme agréée',
    'DGFiP',
  ],
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'Validateur Factur-X gratuit — votre facture est-elle conforme ?',
    description:
      'Déposez votre facture : contrôle immédiat Factur-X / EN 16931, erreurs expliquées en français, sans inscription.',
    images: [
      {
        url: '/img/og.png',
        width: 1200,
        height: 630,
        alt: 'Validateur Factur-X — contrôle EN 16931 et règles DGFiP, erreurs expliquées en français.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Validateur Factur-X gratuit — votre facture est-elle conforme ?',
    description:
      'Contrôle Factur-X / EN 16931 et règles DGFiP. Erreurs expliquées en français, sans inscription.',
    images: ['/img/og.png'],
  },
  // Gated on the same flag as robots.ts, so a staging deployment cannot out-rank production for
  // the very terms this page exists to win.
  robots: {
    index: ALLOW_INDEXING,
    follow: ALLOW_INDEXING,
  },
  alternates: {
    canonical: '/',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-white"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
