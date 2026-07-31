'use client';

import { useState } from 'react';
import type { FindingDto } from '@facturx/core';

/**
 * A single validation finding.
 *
 * The layout deliberately leads with the French explanation and pushes the engine's own English
 * message into a collapsed "technical detail" section. The raw message is precise but written for
 * implementers - a user who can act on "Sum of Invoice line net amount (BT-106) = Σ Invoice line
 * net amount (BT-131)" did not need this tool. It stays available because integrators do need it.
 */
const SEVERITY_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  exception: {
    border: 'border-l-signal-error',
    badge: 'bg-signal-error text-white',
    label: 'Bloquant',
  },
  fatal: {
    border: 'border-l-signal-error',
    badge: 'bg-signal-error text-white',
    label: 'Bloquant',
  },
  error: { border: 'border-l-signal-error', badge: 'bg-signal-error text-white', label: 'Erreur' },
  warning: {
    border: 'border-l-signal-warn',
    badge: 'bg-signal-warn text-white',
    label: 'Avertissement',
  },
  notice: { border: 'border-l-signal-info', badge: 'bg-signal-info text-white', label: 'Info' },
};

export function FindingCard({ finding }: { finding: FindingDto }) {
  const [showDetail, setShowDetail] = useState(false);
  const style = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.notice!;

  return (
    <article
      className={`rounded-lg border border-navy-200 border-l-4 bg-white p-4 ${style.border}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.badge}`}
        >
          {style.label}
        </span>

        {finding.ruleId && (
          <span className="rounded bg-navy-100 px-2 py-0.5 font-mono text-xs font-semibold text-navy-800">
            {finding.ruleId}
          </span>
        )}

        {/* Provenance matters: a DGFiP rule is a French legal obligation, an EN 16931 rule is
            European, and a PEPPOL rule is an interoperability convention. */}
        <span className="text-xs text-navy-500">{finding.rulesetLabel}</span>
      </header>

      <h4 className="mt-2.5 text-[15px] font-semibold text-navy-900">
        {finding.explanation?.title ?? finding.message}
      </h4>

      {finding.explanation && (
        <div className="mt-3 space-y-2.5 text-sm">
          <Block label="Ce que la règle exige" text={finding.explanation.meaning} />
          <Block label="Pourquoi cela arrive" text={finding.explanation.cause} />
          <Block label="Comment corriger" text={finding.explanation.fix} highlight />
        </div>
      )}

      {finding.terms.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded bg-navy-50 p-2.5">
          {finding.terms.map((term) => (
            <div key={term.id} className="text-xs">
              <dt className="inline font-mono font-semibold text-navy-700">{term.id}</dt>
              <dd className="inline text-navy-600">
                {' — '}
                {term.label}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <button
        type="button"
        onClick={() => setShowDetail((open) => !open)}
        aria-expanded={showDetail}
        className="mt-3 text-xs font-medium text-navy-600 underline underline-offset-2 hover:text-navy-800"
      >
        {showDetail ? 'Masquer le détail technique' : 'Voir le détail technique'}
      </button>

      {showDetail && (
        <div className="mt-2 space-y-2 rounded bg-navy-950 p-3 font-mono text-[11px] leading-relaxed text-navy-100">
          <p className="whitespace-pre-wrap break-words">{finding.message}</p>
          {finding.ruleVariant && (
            <p className="text-navy-400">
              Identifiant complet : <span className="text-navy-200">{finding.ruleVariant}</span>
            </p>
          )}
          {finding.location && (
            <p className="break-all text-navy-400">
              Emplacement : <span className="text-navy-200">{finding.location}</span>
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Block({
  label,
  text,
  highlight = false,
}: {
  label: string;
  text: string;
  highlight?: boolean;
}) {
  return (
    <div className={highlight ? 'rounded border-l-2 border-signal-ok bg-signal-okBg p-2.5' : ''}>
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">{label}</p>
      <p className="mt-0.5 leading-relaxed text-navy-700">{text}</p>
    </div>
  );
}
