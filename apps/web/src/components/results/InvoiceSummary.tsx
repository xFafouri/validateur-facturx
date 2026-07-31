'use client';

import { useState } from 'react';
import type { InvoiceDto } from '@facturx/core';

/**
 * Human-readable rendering of the invoice's structured content.
 *
 * This is the receiver-side capability the brief identifies as underserved. From 1 September 2026
 * every VAT-registered business must be able to *receive* structured invoices, and a supplier's
 * `factur-x.xml` is unreadable without tooling. Showing what an incoming invoice actually says -
 * who sent it, for how much, due when - is useful even when the document is perfectly valid.
 */
export function InvoiceSummary({ invoice }: { invoice: InvoiceDto }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border border-navy-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-navy-900">Contenu de la facture</span>
          <span className="mt-0.5 block text-sm text-navy-600">
            Données lues dans le fichier XML structuré
          </span>
        </span>
        <span aria-hidden="true" className="text-navy-500">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-navy-100 px-4 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label="Numéro" value={invoice.invoiceNumber} mono />
            <Field label="Type" value={invoice.typeLabel} />
            <Field label="Émise le" value={formatDate(invoice.issueDate)} />
            <Field label="Échéance" value={formatDate(invoice.dueDate)} />
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            <PartyCard title="Vendeur" party={invoice.seller} />
            <PartyCard title="Acheteur" party={invoice.buyer} />
          </div>

          {invoice.lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">Lignes de la facture</caption>
                <thead>
                  <tr className="border-b border-navy-200 text-left text-xs uppercase tracking-wide text-navy-500">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      #
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Désignation
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Qté
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      P.U. HT
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      TVA
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Montant HT
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {invoice.lines.map((line, index) => (
                    <tr key={line.id ?? index}>
                      <td className="py-2 pr-3 font-mono text-xs text-navy-500">
                        {line.id ?? index + 1}
                      </td>
                      <td className="py-2 pr-3 text-navy-900">{line.name ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-navy-700">
                        {line.quantity ?? '—'}
                        {line.unitCode && (
                          <span className="ml-1 text-xs text-navy-400">
                            {unitLabel(line.unitCode)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-navy-700">
                        {line.unitPrice?.display ?? '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-navy-700">
                        {line.vatRatePercent ? `${line.vatRatePercent} %` : '—'}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums text-navy-900">
                        {line.netAmount?.display ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invoice.taxBreakdown.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                Ventilation de TVA
              </h4>
              <ul className="mt-2 space-y-1">
                {invoice.taxBreakdown.map((tax, index) => (
                  <li key={index} className="flex flex-wrap gap-x-3 text-sm text-navy-700">
                    <span className="tabular-nums">
                      {tax.ratePercent ? `${tax.ratePercent} %` : 'Taux non déclaré'}
                    </span>
                    <span className="text-navy-400">·</span>
                    <span>Base {tax.basisAmount?.display ?? '—'}</span>
                    <span className="text-navy-400">·</span>
                    <span>TVA {tax.calculatedAmount?.display ?? '—'}</span>
                    {tax.categoryCode && (
                      <span className="rounded bg-navy-100 px-1.5 font-mono text-xs text-navy-700">
                        {tax.categoryCode}
                      </span>
                    )}
                    {tax.exemptionReason && (
                      <span className="w-full text-xs italic text-navy-500">
                        {tax.exemptionReason}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <dl className="ml-auto max-w-xs space-y-1.5 border-t border-navy-200 pt-3 text-sm">
            <TotalRow label="Total HT" value={invoice.totals.taxBasisTotalAmount?.display} />
            <TotalRow label="TVA" value={invoice.totals.taxTotalAmount?.display} />
            <TotalRow label="Total TTC" value={invoice.totals.grandTotalAmount?.display} />
            <TotalRow label="Net à payer" value={invoice.totals.duePayableAmount?.display} strong />
          </dl>

          {invoice.notes.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                Mentions
              </h4>
              <ul className="mt-1.5 space-y-1">
                {invoice.notes.map((note, index) => (
                  <li key={index} className="text-sm text-navy-600">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PartyCard({ title, party }: { title: string; party: InvoiceDto['seller'] }) {
  return (
    <div className="rounded border border-navy-100 bg-navy-50/50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-500">{title}</h4>
      <p className="mt-1 font-medium text-navy-900">{party.name ?? 'Non déclaré'}</p>
      <dl className="mt-1.5 space-y-0.5 text-xs text-navy-600">
        {party.legalId && (
          <div>
            <dt className="inline">SIREN/SIRET : </dt>
            <dd className="inline font-mono">{party.legalId}</dd>
          </div>
        )}
        {party.vatId && (
          <div>
            <dt className="inline">TVA : </dt>
            <dd className="inline font-mono">{party.vatId}</dd>
          </div>
        )}
        {(party.postcode || party.city) && (
          <div>
            <dd>{[party.postcode, party.city, party.countryCode].filter(Boolean).join(' ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-navy-500">{label}</dt>
      <dd className={`mt-0.5 text-sm text-navy-900 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={strong ? 'font-semibold text-navy-900' : 'text-navy-600'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold text-navy-900' : 'text-navy-800'}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

/** Renders `YYYY-MM-DD` as `01/09/2026`, the French convention. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** The handful of UN/ECE Rec 20 unit codes that actually appear on French invoices. */
function unitLabel(code: string): string {
  const labels: Record<string, string> = {
    C62: 'u',
    HUR: 'h',
    DAY: 'j',
    MON: 'mois',
    KGM: 'kg',
    MTR: 'm',
    LTR: 'L',
    MTK: 'm²',
    E48: 'service',
  };
  return labels[code] ?? code;
}
