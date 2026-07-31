'use client';

import type { AnalysisDto } from '@facturx/core';

/**
 * Arithmetic verification with the actual figures.
 *
 * This is the panel that does something the validation engine cannot: the engine reports
 * "BT-106 = Σ BT-131" without ever stating which two amounts it compared, leaving the user knowing
 * a total is wrong but not by how much or where. Having parsed the invoice ourselves, we show both
 * sides and the difference to the cent.
 */
export function ChecksPanel({ result }: { result: AnalysisDto }) {
  const checks = result.checks;
  const vatChecks = result.vatChecks;

  if (checks.length === 0 && vatChecks.length === 0) return null;

  const failing = checks.filter((c) => !c.passed);
  const failingVat = vatChecks.filter((c) => !c.passed);
  const allGood = failing.length === 0 && failingVat.length === 0;

  return (
    <div className="rounded-lg border border-navy-200 bg-white">
      <div className="border-b border-navy-100 px-4 py-3">
        <h3 className="text-base font-semibold text-navy-900">Vérification des totaux</h3>
        <p className="mt-0.5 text-sm text-navy-600">
          {allGood
            ? 'Tous les totaux de la facture sont cohérents entre eux.'
            : 'Un ou plusieurs totaux ne découlent pas des montants déclarés.'}
        </p>
      </div>

      <ul className="divide-y divide-navy-100">
        {checks.map((check) => (
          <li key={check.ruleId} className="flex gap-3 px-4 py-3">
            <StatusDot passed={check.passed} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-navy-900">{check.label}</span>
                <span className="font-mono text-[11px] text-navy-400">{check.ruleId}</span>
              </div>
              <p
                className={`mt-0.5 text-sm ${check.passed ? 'text-navy-600' : 'text-signal-error'}`}
              >
                {check.detail}
              </p>

              {!check.passed && check.declared && check.computed && (
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 rounded bg-signal-errorBg px-3 py-2 text-xs">
                  <div>
                    <dt className="text-navy-500">Déclaré</dt>
                    <dd className="font-mono font-semibold text-navy-900">
                      {check.declared.display}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-navy-500">Calculé</dt>
                    <dd className="font-mono font-semibold text-navy-900">
                      {check.computed.display}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </li>
        ))}

        {vatChecks.map((check, index) => (
          <li key={`vat-${index}`} className="flex gap-3 px-4 py-3">
            <StatusDot passed={check.passed} />
            <p className={`text-sm ${check.passed ? 'text-navy-600' : 'text-signal-error'}`}>
              {check.detail}
            </p>
          </li>
        ))}
      </ul>

      {result.suspectLines.length > 0 && (
        <div className="border-t border-navy-100 bg-signal-warnBg px-4 py-3">
          <p className="text-sm text-navy-800">
            <strong className="font-semibold">Piste :</strong> l&apos;écart correspond exactement au
            montant de la ligne{' '}
            {result.suspectLines.map((line, index) => (
              <span key={line}>
                {index > 0 && ', '}
                <span className="font-mono font-semibold">{line}</span>
              </span>
            ))}
            . Cette ligne a probablement été oubliée dans le total, ou comptée deux fois.
          </p>
        </div>
      )}
    </div>
  );
}

function StatusDot({ passed }: { passed: boolean }) {
  return (
    <svg
      className={`mt-0.5 h-4 w-4 shrink-0 ${passed ? 'text-signal-ok' : 'text-signal-error'}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      {passed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m4 10.5 4 4 8-9" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5 5 15" />
      )}
    </svg>
  );
}
