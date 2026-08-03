import Link from 'next/link';
import type { InvoiceSummary } from '@/lib/api';
import { formatDate, formatEuros, INVOICE_STATE_LABELS, TYPE_CODE_LABELS } from '@/lib/format';

/**
 * The invoice list.
 *
 * A real `<table>` rather than a grid of divs: this is tabular data, and the semantics are what
 * let a screen reader announce "colonne Montant TTC" when moving across a row. The horizontal
 * scroll is on a wrapper so the page itself never scrolls sideways on a phone.
 */
export function InvoiceTable({ invoices }: { invoices: readonly InvoiceSummary[] }) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-white px-6 py-10 text-center">
        <p className="text-sm text-navy-600">Aucune facture émise pour le moment.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">Factures émises</caption>
        <thead>
          <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-500">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Numéro
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Client
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Émise le
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Montant TTC
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              État
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="border-b border-navy-50 last:border-0 hover:bg-navy-50">
              <td className="px-4 py-3">
                <Link
                  href={`/factures/${invoice.id}`}
                  className="font-medium text-navy-800 underline underline-offset-2"
                >
                  {invoice.invoiceNumber}
                </Link>
                {invoice.typeCode !== '380' ? (
                  <span className="ml-2 text-xs text-navy-500">
                    {TYPE_CODE_LABELS[invoice.typeCode] ?? invoice.typeCode}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-navy-700">{invoice.buyer.name}</td>
              <td className="px-4 py-3 tabular-nums text-navy-600">
                {formatDate(invoice.issueDate, true)}
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-navy-900">
                {formatEuros(invoice.grandTotalAmount, invoice.currency)}
              </td>
              <td className="px-4 py-3">
                <StateBadge state={invoice.state} valid={invoice.lastValidationValid} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * State, paired with the validation verdict.
 *
 * Colour is never the only signal - the label carries the same information in words, for the
 * reason the Tailwind palette note gives.
 */
function StateBadge({ state, valid }: { state: string; valid: boolean | null }) {
  const label = INVOICE_STATE_LABELS[state] ?? state;
  const tone =
    valid === false
      ? 'bg-signal-errorBg text-signal-error'
      : state === 'REJECTED'
        ? 'bg-signal-errorBg text-signal-error'
        : 'bg-signal-okBg text-signal-ok';

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  );
}
