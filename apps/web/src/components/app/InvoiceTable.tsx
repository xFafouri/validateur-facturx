import Link from 'next/link';
import type { InvoiceDirection, InvoiceSummary } from '@/lib/api';
import { formatDate, formatEuros, INVOICE_STATE_LABELS, TYPE_CODE_LABELS } from '@/lib/format';

/**
 * The invoice list, for either direction.
 *
 * A real `<table>` rather than a grid of divs: this is tabular data, and the semantics are what
 * let a screen reader announce "colonne Montant TTC" when moving across a row. The horizontal
 * scroll is on a wrapper so the page itself never scrolls sideways on a phone.
 *
 * `direction` only changes wording and the empty state. A mixed list passes nothing and gets a
 * neutral "Contrepartie" column, because "Client" would be wrong for half the rows.
 */
export function InvoiceTable({
  invoices,
  direction,
}: {
  invoices: readonly InvoiceSummary[];
  direction?: InvoiceDirection;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-white px-6 py-10 text-center">
        <p className="text-sm text-navy-600">
          {direction === 'RECEIVED'
            ? 'Aucune facture reçue pour le moment.'
            : 'Aucune facture émise pour le moment.'}
        </p>
      </div>
    );
  }

  const counterpartyLabel =
    direction === 'RECEIVED' ? 'Fournisseur' : direction === 'ISSUED' ? 'Client' : 'Contrepartie';
  const dateLabel = direction === 'RECEIVED' ? 'Reçue le' : 'Émise le';

  return (
    <div className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
      <table className="w-full min-w-[48rem] text-sm">
        <caption className="sr-only">
          {direction === 'RECEIVED' ? 'Factures reçues' : 'Factures'}
        </caption>
        <thead>
          <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-500">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Numéro
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {counterpartyLabel}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {dateLabel}
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
                {/* Only worth saying in a mixed list; a filtered one has it in the heading. */}
                {direction === undefined ? (
                  <span className="ml-2 text-xs text-navy-400">
                    {invoice.direction === 'RECEIVED' ? 'reçue' : 'émise'}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-navy-700">{invoice.counterpartyName}</td>
              <td className="px-4 py-3 tabular-nums text-navy-600">
                {formatDate(
                  invoice.direction === 'RECEIVED' && invoice.receivedAt
                    ? invoice.receivedAt.slice(0, 10)
                    : invoice.issueDate,
                  true,
                )}
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-navy-900">
                {invoice.grandTotalAmount === null ? (
                  // A received invoice that stated no total. Shown as absent rather than as
                  // zero, which would be a figure we invented.
                  <span className="text-signal-warn" title="Montant absent de la facture reçue">
                    non indiqué
                  </span>
                ) : (
                  formatEuros(invoice.grandTotalAmount, invoice.currency)
                )}
              </td>
              <td className="px-4 py-3">
                <StateBadge
                  state={invoice.state}
                  valid={invoice.lastValidationValid}
                  errorCount={invoice.validationErrorCount}
                />
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
function StateBadge({
  state,
  valid,
  errorCount,
}: {
  state: string;
  valid: boolean | null;
  errorCount: number | null;
}) {
  if (valid === false) {
    return (
      <span className="inline-block rounded bg-signal-errorBg px-2 py-0.5 text-xs font-medium text-signal-error">
        Non conforme{errorCount ? ` · ${errorCount}` : ''}
      </span>
    );
  }

  const label = INVOICE_STATE_LABELS[state] ?? state;
  const tone =
    state === 'REJECTED' ? 'bg-signal-errorBg text-signal-error' : 'bg-signal-okBg text-signal-ok';

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  );
}
