import Image from 'next/image';
import Link from 'next/link';
import { Validator } from '@/components/Validator';

export const dynamic = 'force-dynamic';

/** The receive obligation and the issue obligation for large firms both start on this date. */
const MANDATE_DATE = new Date('2026-09-01T00:00:00+02:00');
/** SMEs and micro-businesses must begin issuing a year later. */
const SME_MANDATE_DATE = new Date('2027-09-01T00:00:00+02:00');

function daysUntil(target: Date): number {
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const FAQ = [
  {
    question: 'Un PDF envoyé par e-mail est-il une facture électronique ?',
    answer:
      "Non. À compter du 1er septembre 2026, un PDF classique — même généré par un logiciel de facturation, même signé — n'est plus une facture électronique valide entre entreprises. Il faut une facture structurée (Factur-X, UBL ou CII) transmise via une plateforme agréée. Un PDF scanné ou envoyé par e-mail ne remplit aucune de ces deux conditions.",
  },
  {
    question: "Qu'est-ce que le format Factur-X exactement ?",
    answer:
      "Factur-X est un format hybride : un PDF/A-3 lisible par un humain, dans lequel est embarqué un fichier XML nommé exactement « factur-x.xml » contenant les mêmes données sous forme structurée. Votre client voit une facture normale ; son logiciel lit le XML. C'est le format le plus adapté aux TPE et PME car il reste lisible sans outil spécialisé. Il est techniquement identique au format allemand ZUGFeRD 2.x.",
  },
  {
    question: 'Quelles sont les dates de la réforme ?',
    answer:
      "Le 1er septembre 2026, toutes les entreprises assujetties à la TVA doivent être en capacité de recevoir des factures électroniques, et les grandes entreprises ainsi que les ETI doivent commencer à en émettre. Le 1er septembre 2027, l'obligation d'émission s'étend aux PME et aux microentreprises. L'obligation de réception, elle, concerne tout le monde dès 2026.",
  },
  {
    question: "Qu'est-ce qu'une plateforme agréée (PA) ?",
    answer:
      "Une plateforme agréée — anciennement appelée PDP, plateforme de dématérialisation partenaire — est un opérateur privé immatriculé par la DGFiP, habilité à émettre, recevoir et transmettre les factures électroniques ainsi qu'à transmettre les données à l'administration. Chaque entreprise concernée doit en désigner au moins une. Une centaine sont immatriculées. Le portail public (PPF) n'assure plus l'échange des factures : il gère l'Annuaire et la concentration des données.",
  },
  {
    question: "Que signifie l'erreur BR-CO-10 ?",
    answer:
      "BR-CO-10 est la règle qui exige que le total HT des lignes (BT-106) soit exactement égal à la somme des montants HT de chaque ligne (BT-131). C'est l'erreur la plus fréquente en pratique. Elle provient presque toujours d'un arrondi : le logiciel additionne des montants non arrondis puis arrondit le total, au lieu d'arrondir chaque ligne puis d'additionner. Un écart d'un seul centime suffit à faire rejeter la facture.",
  },
  {
    question: 'Mes factures sont-elles conservées par ce validateur ?',
    answer:
      "Non. Votre fichier est analysé en mémoire puis immédiatement oublié : il n'est ni enregistré sur disque, ni transmis à un tiers, et aucun compte n'est requis. C'est aussi la raison pour laquelle aucun historique n'est disponible.",
  },
];

export default function HomePage() {
  const daysToMandate = daysUntil(MANDATE_DATE);
  const daysToSme = daysUntil(SME_MANDATE_DATE);

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Static, developer-authored content: no user input reaches this object.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <header className="border-b border-navy-100">
        <div className="container-page flex items-center justify-between py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-navy-800 text-sm font-bold text-white">
              FX
            </div>
            <span className="text-[15px] font-semibold text-navy-900">Validateur Factur-X</span>
          </div>
          <nav className="hidden gap-6 text-sm text-navy-600 sm:flex">
            <a href="#validateur" className="hover:text-navy-900">
              Validateur
            </a>
            <a href="#comprendre" className="hover:text-navy-900">
              La réforme
            </a>
            <a href="#erreurs" className="hover:text-navy-900">
              Erreurs fréquentes
            </a>
            <a href="#faq" className="hover:text-navy-900">
              FAQ
            </a>
          </nav>

          {/*
            The route from the free validator to the paid product. Deliberately understated and
            placed after the nav: the validator's promise is that it needs no account, and a
            prominent sign-up next to it would read as a bait-and-switch.
          */}
          <div className="flex items-center gap-4 text-sm">
            <Link href="/connexion" className="text-navy-600 hover:text-navy-900">
              Connexion
            </Link>
            <Link
              href="/creer-un-compte"
              className="rounded border border-navy-200 px-3 py-1.5 font-medium text-navy-800 hover:bg-navy-50"
            >
              Émettre des factures
            </Link>
          </div>
        </div>
      </header>

      <main id="contenu">
        {/* ---------------------------------------------------------------- hero */}
        <section className="relative overflow-hidden bg-navy-950 text-white">
          <div className="container-page grid gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-16">
            <div>
              {daysToMandate > 0 && (
                <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-navy-100">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400"
                    aria-hidden="true"
                  />
                  Plus que {daysToMandate} jour{daysToMandate > 1 ? 's' : ''} avant
                  l&apos;obligation de réception
                </p>
              )}

              <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">
                Votre facture électronique est-elle vraiment conforme&nbsp;?
              </h1>

              <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-navy-100">
                Déposez un PDF Factur-X ou un fichier XML : nous contrôlons la structure, les{' '}
                <strong className="font-semibold text-white">~140 règles EN&nbsp;16931</strong> et
                les règles françaises de la DGFiP — et nous vous expliquons chaque erreur en
                français clair, avec la correction à apporter.
              </p>

              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-navy-200">
                <li className="flex items-center gap-2">
                  <Check /> Gratuit et sans inscription
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Aucune donnée conservée
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Résultat en quelques secondes
                </li>
              </ul>
            </div>

            <div className="relative hidden lg:block">
              <Image
                src="/img/hero.png"
                alt=""
                width={862}
                height={768}
                priority
                className="h-auto w-full max-w-md rounded-xl"
              />
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- validator */}
        <section id="validateur" className="scroll-mt-4 border-b border-navy-100 bg-navy-50/40">
          <div className="container-page py-10 sm:py-12">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-center text-2xl font-bold text-navy-900">Vérifier une facture</h2>
              <p className="mx-auto mt-2 max-w-xl text-center text-sm text-navy-600">
                Fonctionne avec les factures que vous émettez comme avec celles que vous recevez.
              </p>
              <div className="mt-6">
                <Validator />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- understand */}
        <section id="comprendre" className="scroll-mt-4">
          <div className="container-page py-12 sm:py-16">
            <h2 className="text-2xl font-bold text-navy-900">
              Comprendre la réforme en cinq minutes
            </h2>

            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <Card title="Ce qui change">
                <p>
                  À partir du 1<sup>er</sup> septembre 2026, une facture entre entreprises établies
                  en France doit être une facture <strong>structurée</strong>, transmise par une{' '}
                  <strong>plateforme agréée</strong>. Le PDF envoyé par e-mail et la facture papier
                  cessent d&apos;être valables en B2B.
                </p>
              </Card>

              <Card title="Qui est concerné, et quand">
                <p>
                  <strong>
                    Dans {daysToMandate > 0 ? `${daysToMandate} jours` : 'l’immédiat'}
                  </strong>{' '}
                  : toutes les entreprises assujetties à la TVA doivent pouvoir{' '}
                  <strong>recevoir</strong> des factures électroniques ; les grandes entreprises et
                  les ETI doivent <strong>émettre</strong>.
                </p>
                <p className="mt-2">
                  <strong>Dans {daysToSme > 0 ? `${daysToSme} jours` : 'moins d’un an'}</strong> :
                  les PME et microentreprises doivent à leur tour émettre.
                </p>
              </Card>

              <Card title="Les trois formats admis">
                <p>
                  <strong>Factur-X</strong>, <strong>UBL</strong> et <strong>CII</strong>. Pour une
                  TPE ou une PME, Factur-X est le choix naturel : hybride, il reste lisible à
                  l&apos;œil nu tout en portant les données structurées.
                </p>
              </Card>
            </div>

            <div className="mt-10 rounded-xl border border-navy-200 bg-white p-6">
              <h3 className="text-lg font-semibold text-navy-900">
                Le modèle en 5 coins, sans jargon
              </h3>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-navy-700">
                Votre logiciel de facturation (une <em>solution compatible</em>) transmet la facture
                à <em>votre</em> plateforme agréée. Celle-ci contrôle le format, consulte l&apos;
                <strong>Annuaire</strong> tenu par l&apos;État pour savoir quelle plateforme dessert
                votre client, puis lui transmet la facture. Les deux plateformes remontent en
                parallèle les données fiscales et les statuts au portail public. Vous ne communiquez
                jamais directement avec l&apos;administration.
              </p>

              <ol className="mt-5 grid gap-3 sm:grid-cols-5">
                {[
                  ['1', 'Votre logiciel', 'Émet la facture structurée'],
                  ['2', 'Votre plateforme', 'Contrôle et route (PA-E)'],
                  ['3', 'Annuaire', 'Identifie le destinataire'],
                  ['4', 'Plateforme du client', 'Reçoit et livre (PA-R)'],
                  ['5', 'Votre client', 'Consulte et paie'],
                ].map(([step, title, detail]) => (
                  <li key={step} className="rounded-lg bg-navy-50 p-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                      {step}
                    </span>
                    <p className="mt-2 text-sm font-semibold text-navy-900">{title}</p>
                    <p className="mt-0.5 text-xs text-navy-600">{detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- errors */}
        <section id="erreurs" className="scroll-mt-4 border-y border-navy-100 bg-navy-50/40">
          <div className="container-page py-12 sm:py-16">
            <h2 className="text-2xl font-bold text-navy-900">
              Les erreurs qui font rejeter une facture
            </h2>
            <p className="mt-2 max-w-2xl text-[15px] text-navy-600">
              Tirées des règles réellement contrôlées par les plateformes. Notre validateur les
              détecte toutes et vous indique la correction.
            </p>

            <div className="mt-8 space-y-4">
              {[
                {
                  code: 'BR-CO-10',
                  title: 'Le total HT ne correspond pas à la somme des lignes',
                  body: "La plus fréquente de toutes. Elle vient d'un arrondi : additionner des montants non arrondis puis arrondir le total ne donne pas le même résultat qu'arrondir chaque ligne puis additionner. Un centime d'écart suffit.",
                },
                {
                  code: 'BR-FR-12',
                  title: "L'adresse électronique de l'acheteur est absente",
                  body: 'Champ introduit par la réforme française : il ne figure dans aucun logiciel antérieur. Sans lui, votre plateforme ne sait pas à quelle plateforme destinataire router la facture.',
                },
                {
                  code: 'BR-FR-05',
                  title: 'Les mentions légales de paiement manquent dans le XML',
                  body: 'Pénalités de retard, indemnité forfaitaire de 40 €, escompte : ces mentions sont souvent imprimées en pied de page du PDF, mais doivent aussi figurer dans le XML sous forme structurée, avec leur code.',
                },
                {
                  code: 'BR-CL-17',
                  title: 'Un code de catégorie de TVA hors liste',
                  body: "Le code doit venir de la liste normalisée UNTDID 5305 : S pour un taux normal ou réduit, E pour une exonération, AE pour l'autoliquidation. Une valeur libre comme « TVA20 » est rejetée.",
                },
                {
                  code: 'Profil',
                  title: 'Un profil MINIMUM utilisé pour une vraie facture',
                  body: 'Le profil MINIMUM ne porte ni les lignes ni le détail de TVA. Il passe la validation, mais ne peut pas tenir lieu de facture pour une entreprise assujettie à la TVA. Préférez le profil BASIC.',
                },
              ].map((item) => (
                <article key={item.code} className="rounded-lg border border-navy-200 bg-white p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-navy-800 px-2 py-0.5 font-mono text-xs font-semibold text-white">
                      {item.code}
                    </span>
                    <h3 className="text-[15px] font-semibold text-navy-900">{item.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-navy-700">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- faq */}
        <section id="faq" className="scroll-mt-4">
          <div className="container-page py-12 sm:py-16">
            <h2 className="text-2xl font-bold text-navy-900">Questions fréquentes</h2>
            <div className="mt-8 max-w-3xl divide-y divide-navy-100">
              {FAQ.map((item) => (
                <details key={item.question} className="group py-4">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 text-[15px] font-semibold text-navy-900 marker:content-['']">
                    {item.question}
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-navy-400 transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-navy-700">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-navy-100 bg-navy-50/60">
        <div className="container-page py-8">
          <p className="max-w-3xl text-xs leading-relaxed text-navy-600">
            <strong className="font-semibold text-navy-800">Avertissement.</strong> Cet outil
            effectue un contrôle technique de conformité au format Factur-X et aux règles de gestion
            EN&nbsp;16931 et françaises. Il ne constitue ni un conseil juridique ou fiscal, ni une
            garantie d&apos;acceptation par une plateforme agréée. La responsabilité réglementaire
            finale incombe à l&apos;entreprise émettrice et à sa plateforme agréée. Vérifiez les
            spécifications en vigueur auprès de la DGFiP et de la FNFE-MPE.
          </p>
          <p className="mt-4 text-xs text-navy-500">
            Validateur Factur-X — solution compatible, indépendante des plateformes agréées.
          </p>
        </div>
      </footer>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-navy-200 bg-white p-5">
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      <div className="prose-fr mt-2">{children}</div>
    </div>
  );
}

function Check() {
  return (
    <svg
      className="h-4 w-4 text-orange-400"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 10.5 4 4 8-9" />
    </svg>
  );
}
