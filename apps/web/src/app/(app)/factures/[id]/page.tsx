import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type InvoiceDetail, type PartyRecord } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import {
  formatBytes,
  formatDate,
  formatDecimal,
  formatEuros,
  formatSirenDisplay,
  INVOICE_STATE_LABELS,
  TYPE_CODE_LABELS,
  VAT_CATEGORY_LABELS,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const invoice = await api<InvoiceDetail>(`/invoices/${id}`);
    return { title: `Facture ${invoice.invoiceNumber}` };
  } catch {
    return { title: 'Facture' };
  }
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ emise?: string }>;
}) {
  const [{ id }, { emise }] = await Promise.all([params, searchParams]);

  let invoice: InvoiceDetail;
  try {
    invoice = await api<InvoiceDetail>(`/invoices/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Alert tone="error" title="Impossible de charger cette facture">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  const pdf = invoice.archiveEntries.find((entry) => entry.artifactKind === 'facturx-pdf');
  const xml = invoice.archiveEntries.find((entry) => entry.artifactKind === 'cii-xml');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/factures" className="text-sm text-navy-600 hover:text-navy-900">
          ← Factures
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-navy-900">
              {TYPE_CODE_LABELS[invoice.typeCode] ?? 'Facture'} {invoice.invoiceNumber}
            </h1>
            <p className="mt-1 text-sm text-navy-600">
              Émise par {invoice.clientOrg.name} le {formatDate(invoice.issueDate)}.
            </p>
          </div>
          <span className="rounded bg-signal-okBg px-2.5 py-1 text-xs font-medium text-signal-ok">
            {INVOICE_STATE_LABELS[invoice.state] ?? invoice.state}
          </span>
        </div>
      </div>

      {emise ? (
        <Alert tone="success" title="Facture émise et scellée">
          Le document a été généré, vérifié par le moteur de validation, puis archivé avec son
          empreinte SHA-256. Il est conservé dix ans et ne peut plus être modifié : une correction
          se fait par un avoir.
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <PartyCard title="Vendeur" party={invoice.seller} />
        <PartyCard title="Client" party={invoice.buyer} />
      </section>

      <section className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Lignes de la facture</caption>
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-500">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Désignation
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Quantité
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                P.U. HT
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                TVA
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Total HT
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-navy-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy-900">{line.name}</div>
                  {line.description ? (
                    <div className="mt-0.5 text-xs text-navy-500">{line.description}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-navy-700">
                  {formatDecimal(line.quantity)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-navy-700">
                  {formatEuros(line.netUnitPrice, invoice.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-navy-700">
                  {formatDecimal(line.vatRatePercent, 2)} %
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-navy-900">
                  {formatEuros(line.netAmount, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-navy-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-navy-900">Détail de la TVA</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {invoice.taxBreakdown.map((group) => (
              <li key={group.id} className="flex justify-between gap-3">
                <span className="text-navy-600">
                  {VAT_CATEGORY_LABELS[group.categoryCode] ?? group.categoryCode}
                  {group.categoryCode === 'S' ? ` ${formatDecimal(group.ratePercent, 2)} %` : ''}
                  <span className="block text-xs text-navy-400">
                    Base {formatEuros(group.basisAmount, invoice.currency)}
                    {group.exemptionReason ? ` — ${group.exemptionReason}` : ''}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-navy-900">
                  {formatEuros(group.calculatedAmount, invoice.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-navy-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-navy-900">Totaux</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Total HT" value={formatEuros(invoice.lineTotalAmount, invoice.currency)} />
            <Row label="TVA" value={formatEuros(invoice.taxTotalAmount, invoice.currency)} />
            <Row
              label="Total TTC"
              value={formatEuros(invoice.grandTotalAmount, invoice.currency)}
              strong
            />
            {invoice.prepaidAmount !== '0.00' ? (
              <Row
                label="Acompte versé"
                value={formatEuros(invoice.prepaidAmount, invoice.currency)}
              />
            ) : null}
            <Row
              label="Net à payer"
              value={formatEuros(invoice.duePayableAmount, invoice.currency)}
              strong
            />
            {invoice.dueDate ? <Row label="Échéance" value={formatDate(invoice.dueDate)} /> : null}
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-sm font-semibold text-navy-900">Archive</h2>
        <p className="mt-1 text-xs leading-relaxed text-navy-500">
          Les deux versions sont scellées : le XML est l&apos;original au sens de la réforme, le PDF
          est la version lisible. Chaque téléchargement revérifie les octets contre l&apos;empreinte
          enregistrée au scellement.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {pdf ? (
            <ArtifactLink
              href={`/factures/${invoice.id}/telecharger/pdf`}
              label="Télécharger le PDF Factur-X"
              detail={`${formatBytes(pdf.sizeBytes)} · scellé le ${formatDate(pdf.sealedAt, true)}`}
            />
          ) : null}
          {xml ? (
            <ArtifactLink
              href={`/factures/${invoice.id}/telecharger/xml`}
              label="Télécharger le XML CII"
              detail={`${formatBytes(xml.sizeBytes)} · conservé jusqu'au ${formatDate(xml.retentionUntil, true)}`}
            />
          ) : null}
        </div>

        {pdf ? (
          <dl className="mt-4 border-t border-navy-50 pt-3 text-xs">
            <dt className="text-navy-500">Empreinte SHA-256 du PDF</dt>
            <dd className="mt-1 break-all font-mono text-[11px] text-navy-700">
              {pdf.contentHash}
            </dd>
          </dl>
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between ${strong ? 'font-semibold text-navy-900' : 'text-navy-600'}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Party details as snapshotted at issue time.
 *
 * Shown from the invoice's own snapshot rather than from the client record: editing a customer's
 * address must not change what a past invoice says, and this view is the evidence of that.
 */
function PartyCard({ title, party }: { title: string; party: PartyRecord }) {
  return (
    <div className="rounded-lg border border-navy-100 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-500">{title}</h2>
      <p className="mt-2 font-medium text-navy-900">{party.name}</p>
      <address className="mt-1 text-sm not-italic leading-relaxed text-navy-600">
        {party.addressLine1}
        {party.addressLine2 ? (
          <>
            <br />
            {party.addressLine2}
          </>
        ) : null}
        <br />
        {[party.postcode, party.city].filter(Boolean).join(' ')}
        {party.countryCode && party.countryCode !== 'FR' ? ` (${party.countryCode})` : ''}
      </address>
      <dl className="mt-3 space-y-0.5 text-xs text-navy-500">
        {party.legalId ? (
          <div className="flex gap-2">
            <dt>SIREN</dt>
            <dd className="tabular-nums text-navy-700">{formatSirenDisplay(party.legalId)}</dd>
          </div>
        ) : null}
        {party.vatNumber ? (
          <div className="flex gap-2">
            <dt>TVA</dt>
            <dd className="text-navy-700">{party.vatNumber}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ArtifactLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <a
      href={href}
      className="rounded border border-navy-200 px-4 py-2.5 text-sm hover:border-navy-300 hover:bg-navy-50"
    >
      <span className="block font-semibold text-navy-800">{label}</span>
      <span className="mt-0.5 block text-xs text-navy-500">{detail}</span>
    </a>
  );
}
