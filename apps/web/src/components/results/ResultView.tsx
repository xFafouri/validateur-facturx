'use client';

import { useState } from 'react';
import type { AnalysisDto } from '@facturx/core';
import { VerdictBanner } from './VerdictBanner';
import { InvoiceSummary } from './InvoiceSummary';
import { ChecksPanel } from './ChecksPanel';
import { FindingCard } from './FindingCard';
import { DownloadReport } from './DownloadReport';
import { Waitlist } from '../Waitlist';

export function ResultView({ result, onReset }: { result: AnalysisDto; onReset: () => void }) {
  const [showInapplicable, setShowInapplicable] = useState(false);

  const blocking = result.findings.filter((f) =>
    ['error', 'fatal', 'exception'].includes(f.severity),
  );
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const notices = result.findings.filter((f) => f.severity === 'notice');

  return (
    <section aria-label="Résultat de l'analyse" className="space-y-6">
      <VerdictBanner result={result} onReset={onReset} />

      {result.parseError && (
        <div className="rounded-lg border border-signal-warn/30 bg-signal-warnBg p-4">
          <h3 className="text-sm font-semibold text-signal-warn">Lecture du document</h3>
          <p className="mt-1 text-sm text-navy-700">{result.parseError}</p>
        </div>
      )}

      {result.engineError && (
        <div className="rounded-lg border border-signal-warn/30 bg-signal-warnBg p-4">
          <h3 className="text-sm font-semibold text-signal-warn">
            Contrôle réglementaire indisponible
          </h3>
          <p className="mt-1 text-sm text-navy-700">
            {result.engineError.message} Les informations ci-dessous proviennent de la lecture du
            document ; elles ne constituent pas un verdict de conformité.
          </p>
        </div>
      )}

      {result.profileNote && (
        <div className="rounded-lg border border-signal-info/30 bg-signal-infoBg p-4">
          <h3 className="text-sm font-semibold text-signal-info">À propos du profil utilisé</h3>
          <p className="mt-1 text-sm text-navy-700">{result.profileNote}</p>
        </div>
      )}

      {result.pdf && result.pdf.warnings.length > 0 && (
        <div className="rounded-lg border border-navy-200 bg-navy-50 p-4">
          <h3 className="text-sm font-semibold text-navy-900">Structure du PDF</h3>
          <ul className="mt-2 space-y-1.5">
            {result.pdf.warnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-sm text-navy-700">
                <span aria-hidden="true" className="mt-0.5 text-navy-400">
                  •
                </span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ChecksPanel result={result} />

      {result.invoice && <InvoiceSummary invoice={result.invoice} />}

      {blocking.length > 0 && (
        <FindingGroup
          title="Erreurs bloquantes"
          description="Ces anomalies empêchent votre facture d'être acceptée. Corrigez-les en priorité."
          findings={blocking}
        />
      )}

      {warnings.length > 0 && (
        <FindingGroup
          title="Avertissements"
          description="Non bloquants aujourd'hui, mais susceptibles d'être refusés par certaines plateformes ou certains clients."
          findings={warnings}
        />
      )}

      {notices.length > 0 && (
        <FindingGroup
          title="Informations"
          description="Recommandations d'amélioration, sans incidence sur la conformité."
          findings={notices}
          collapsed
        />
      )}

      {result.inapplicableFindings.length > 0 && (
        <div className="rounded-lg border border-navy-200 bg-navy-50/60 p-4">
          <button
            type="button"
            onClick={() => setShowInapplicable((open) => !open)}
            aria-expanded={showInapplicable}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="text-sm font-semibold text-navy-900">
                {result.inapplicableFindings.length} règle
                {result.inapplicableFindings.length > 1 ? 's' : ''} sans objet pour une facture
                française
              </span>
              <span className="mt-1 block text-xs text-navy-600">
                Le moteur de validation évalue aussi les règles allemandes (XRechnung). Elles ne
                s&apos;appliquent pas à une facture franco-française et sont masquées par défaut.
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-navy-500">
              {showInapplicable ? '−' : '+'}
            </span>
          </button>

          {showInapplicable && (
            <ul className="mt-4 space-y-3 border-t border-navy-200 pt-4">
              {result.inapplicableFindings.map((finding, index) => (
                <li key={`${finding.ruleId}-${index}`} className="text-sm">
                  <span className="font-mono text-xs font-semibold text-navy-500">
                    {finding.ruleId ?? '—'}
                  </span>
                  <p className="mt-0.5 text-navy-600">{finding.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DownloadReport result={result} />

      {/* Shown after the findings rather than before: the user came for a verdict, and asking
          for an email before delivering it would be the bait-and-switch the page promises not
          to be. */}
      <Waitlist verdict={result.verdict} />

      <p className="rounded-lg bg-navy-50 p-4 text-xs leading-relaxed text-navy-600">
        <strong className="font-semibold text-navy-800">Portée de ce contrôle.</strong>{' '}
        L&apos;analyse porte sur la structure du fichier et sur les règles métier EN 16931 et
        françaises telles qu&apos;implémentées par le moteur de validation. Elle ne préjuge ni de
        l&apos;exactitude commerciale de la facture, ni de son acceptation définitive par votre
        plateforme agréée, à qui revient la responsabilité réglementaire finale.
      </p>
    </section>
  );
}

function FindingGroup({
  title,
  description,
  findings,
  collapsed = false,
}: {
  title: string;
  description: string;
  findings: AnalysisDto['findings'];
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <h3 className="text-base font-semibold text-navy-900">
          {title} <span className="font-normal text-navy-500">({findings.length})</span>
        </h3>
        <span aria-hidden="true" className="text-navy-500">
          {open ? '−' : '+'}
        </span>
      </button>
      <p className="mt-1 text-sm text-navy-600">{description}</p>

      {open && (
        <ul className="mt-4 space-y-3">
          {findings.map((finding, index) => (
            <li key={`${finding.ruleId}-${finding.ruleVariant}-${index}`}>
              <FindingCard finding={finding} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
