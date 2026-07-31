'use client';

import type { AnalysisDto } from '@facturx/core';

/**
 * The verdict is the one thing every visitor came for, so it is stated plainly and first.
 *
 * "Indéterminé" is a real third state, kept distinct from "non conforme": if our own validation
 * service failed, we have no grounds to tell someone their invoice is non-compliant. Collapsing
 * the two would mean making a false accusation about a legal document because of our outage.
 */
const VERDICTS = {
  conforme: {
    label: 'Facture conforme',
    detail:
      'Aucune erreur bloquante détectée. Le fichier respecte la structure Factur-X et les règles de gestion contrôlées.',
    classes: 'border-signal-ok/30 bg-signal-okBg',
    accent: 'text-signal-ok',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />,
  },
  'non-conforme': {
    label: 'Facture non conforme',
    detail:
      "Des anomalies bloquantes ont été détectées. En l'état, cette facture sera probablement rejetée.",
    classes: 'border-signal-error/30 bg-signal-errorBg',
    accent: 'text-signal-error',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m0 3.75h.007M12 3l9 16.5H3L12 3Z"
      />
    ),
  },
  indeterminé: {
    label: 'Conformité indéterminée',
    detail:
      "Le contrôle réglementaire n'a pas pu être effectué. Ce résultat ne signifie pas que votre facture est non conforme.",
    classes: 'border-signal-warn/30 bg-signal-warnBg',
    accent: 'text-signal-warn',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m0 3.75h.007M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    ),
  },
} as const;

export function VerdictBanner({ result, onReset }: { result: AnalysisDto; onReset: () => void }) {
  const verdict = VERDICTS[result.verdict as keyof typeof VERDICTS] ?? VERDICTS['indeterminé'];

  return (
    <div className={`rounded-xl border p-5 sm:p-6 ${verdict.classes}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <svg
            className={`h-8 w-8 shrink-0 ${verdict.accent}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {verdict.icon}
          </svg>
          <div>
            {/* The icon is decorative; the state is always carried in text as well, so the
                result never depends on colour perception alone. */}
            <h2 className={`text-lg font-bold sm:text-xl ${verdict.accent}`}>{verdict.label}</h2>
            <p className="mt-1 max-w-2xl text-sm text-navy-700">{verdict.detail}</p>

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Stat
                label="Erreurs"
                value={result.counts.errors}
                emphasise={result.counts.errors > 0}
              />
              <Stat label="Avertissements" value={result.counts.warnings} />
              <Stat label="Informations" value={result.counts.notices} />
              {result.profileLabel && <Stat label="Profil" value={result.profileLabel} />}
            </dl>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="shrink-0 self-start rounded-lg border border-navy-300 bg-white px-4 py-2 text-sm font-semibold text-navy-800 transition-colors hover:bg-navy-50"
        >
          Analyser une autre facture
        </button>
      </div>

      <p className="mt-4 border-t border-black/5 pt-3 text-xs text-navy-500">
        <span className="font-medium">{result.filename}</span>
        {' · '}
        {formatSize(result.sizeBytes)}
        {result.rulesFired !== null && ` · ${result.rulesFired} règles évaluées`}
        {result.durationMs !== null && ` · ${(result.durationMs / 1000).toFixed(1)} s`}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasise = false,
}: {
  label: string;
  value: string | number;
  emphasise?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-navy-500">{label}</dt>
      <dd
        className={`text-base font-semibold ${emphasise ? 'text-signal-error' : 'text-navy-900'}`}
      >
        {value}
      </dd>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
