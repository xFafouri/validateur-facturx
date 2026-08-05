import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { can } from '@facturx/auth';
import {
  api,
  ApiError,
  type InvoiceDetail,
  type InvoiceTransmissions,
  type LifecycleStatusRecord,
  type PartyRecord,
  type TransmissionRecord,
} from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { requireUser } from '@/lib/session';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatEuros,
  formatOptionalEuros,
  formatSirenDisplay,
  INVOICE_STATE_LABELS,
  STATUS_SOURCE_LABELS,
  TRANSMISSION_STATE_LABELS,
  TYPE_CODE_LABELS,
  VAT_CATEGORY_LABELS,
} from '@/lib/format';
import { RetryForm, TransmitForm } from './TransmissionActions';

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
  const [{ id }, { emise }, actor] = await Promise.all([params, searchParams, requireUser()]);

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

  /*
    Fetched separately, and allowed to fail on its own. The invoice is the page; its delivery
    history is a section of it. A platform-side read that breaks should cost the user that
    section, not the document they came to look at.
  */
  let tracking: InvoiceTransmissions | null = null;
  try {
    tracking = await api<InvoiceTransmissions>(`/pdp/invoices/${id}/transmissions`);
  } catch {
    tracking = null;
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
              {invoice.direction === 'RECEIVED'
                ? `Reçue de ${invoice.seller.name} pour ${invoice.clientOrg.name}, émise le ${formatDate(invoice.issueDate)}.`
                : `Émise par ${invoice.clientOrg.name} le ${formatDate(invoice.issueDate)}.`}
            </p>
          </div>
          <span
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              invoice.lastValidationValid === false
                ? 'bg-signal-errorBg text-signal-error'
                : 'bg-signal-okBg text-signal-ok'
            }`}
          >
            {invoice.lastValidationValid === false
              ? 'Non conforme'
              : (INVOICE_STATE_LABELS[invoice.state] ?? invoice.state)}
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

      {/*
        Only ever shown for a received invoice. One we issued cannot be non-conforming: issuance
        refuses to archive a document the engine did not accept, so there is no such row to land
        on. A received one is stored exactly as it arrived, defects included.
      */}
      {invoice.direction === 'RECEIVED' && invoice.lastValidationValid === false ? (
        <Alert tone="warn" title="Cette facture reçue n'est pas conforme">
          <p>
            Le moteur de validation a relevé {invoice.validationErrorCount ?? 0} erreur
            {(invoice.validationErrorCount ?? 0) > 1 ? 's' : ''} sur ce document
            {invoice.validationRuleIds.length > 0
              ? ` : ${invoice.validationRuleIds.slice(0, 6).join(', ')}`
              : ''}
            .
          </p>
          <p className="mt-2">
            Elle est conservée telle qu&apos;elle a été reçue — c&apos;est la pièce qui atteste de
            ce que votre fournisseur a envoyé. Signalez-lui les anomalies pour qu&apos;il émette une
            facture rectificative.
          </p>
          <p className="mt-2">
            <Link href="/#validateur" className="font-semibold underline">
              Analyser le détail des erreurs dans le validateur
            </Link>
          </p>
        </Alert>
      ) : null}

      {invoice.direction === 'RECEIVED' ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-navy-100 bg-white px-5 py-4 text-sm">
          <div>
            <dt className="text-xs text-navy-500">Reçue le</dt>
            <dd className="text-navy-900">{formatDate(invoice.receivedAt?.slice(0, 10))}</dd>
          </div>
          <div>
            <dt className="text-xs text-navy-500">Voie de réception</dt>
            <dd className="text-navy-900">
              {invoice.sourceChannel === 'upload' ? 'Dépôt manuel' : (invoice.sourceChannel ?? '—')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-navy-500">Profil déclaré</dt>
            <dd className="text-navy-900">{invoice.profile}</dd>
          </div>
        </dl>
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
            <Row
              label="Total HT"
              value={formatOptionalEuros(invoice.lineTotalAmount, invoice.currency)}
            />
            <Row
              label="TVA"
              value={formatOptionalEuros(invoice.taxTotalAmount, invoice.currency)}
            />
            <Row
              label="Total TTC"
              value={formatOptionalEuros(invoice.grandTotalAmount, invoice.currency)}
              strong
            />
            {invoice.prepaidAmount && invoice.prepaidAmount !== '0.00' ? (
              <Row
                label="Acompte versé"
                value={formatOptionalEuros(invoice.prepaidAmount, invoice.currency)}
              />
            ) : null}
            <Row
              label="Net à payer"
              value={formatOptionalEuros(invoice.duePayableAmount, invoice.currency)}
              strong
            />
            {invoice.dueDate ? <Row label="Échéance" value={formatDate(invoice.dueDate)} /> : null}
          </dl>
        </div>
      </section>

      {invoice.direction === 'ISSUED' ? (
        <TransmissionSection
          invoiceId={invoice.id}
          transmissions={tracking?.transmissions ?? []}
          mayTransmit={can(actor.role, 'invoice:transmit')}
          unavailable={tracking === null}
        />
      ) : null}

      {tracking && tracking.lifecycleStatuses.length > 0 ? (
        <StatusTimeline statuses={tracking.lifecycleStatuses} />
      ) : null}

      <section className="rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-sm font-semibold text-navy-900">Archive</h2>
        <p className="mt-1 text-xs leading-relaxed text-navy-500">
          {invoice.direction === 'RECEIVED'
            ? "Le document est conservé exactement tel qu'il a été reçu, sans retouche. Chaque téléchargement revérifie les octets contre l'empreinte enregistrée au dépôt."
            : "Les deux versions sont scellées : le XML est l'original au sens de la réforme, le PDF est la version lisible. Chaque téléchargement revérifie les octets contre l'empreinte enregistrée au scellement."}
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

/**
 * The handover: whether this invoice has been given to a platform, and how that went.
 *
 * Distinct from the timeline below it. This section is about *our* attempts to hand the document
 * over — something we control and can retry. The timeline is what the platform reports back, which
 * we only observe.
 */
function TransmissionSection({
  invoiceId,
  transmissions,
  mayTransmit,
  unavailable,
}: {
  invoiceId: string;
  transmissions: readonly TransmissionRecord[];
  mayTransmit: boolean;
  unavailable: boolean;
}) {
  return (
    <section className="rounded-lg border border-navy-100 bg-white p-5">
      <h2 className="text-sm font-semibold text-navy-900">Transmission</h2>

      {unavailable ? (
        <p className="mt-2 text-xs text-navy-500">
          Le suivi de transmission est momentanément indisponible. La facture et son archive ne sont
          pas affectées.
        </p>
      ) : transmissions.length === 0 ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-navy-500">
            Cette facture n&apos;a pas encore été remise à une plateforme. Une fois en file, elle
            part au prochain passage du service de transmission, avec une clé d&apos;idempotence qui
            interdit tout doublon chez le destinataire.
          </p>
          {mayTransmit ? (
            <div className="mt-4">
              <TransmitForm invoiceId={invoiceId} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-navy-500">
              Votre rôle ne permet pas de transmettre une facture.
            </p>
          )}
        </>
      ) : (
        <ul className="mt-4 space-y-4">
          {transmissions.map((transmission) => (
            <li
              key={transmission.id}
              className="border-t border-navy-50 pt-4 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-navy-900">
                    {TRANSMISSION_STATE_LABELS[transmission.state] ?? transmission.state}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-500">
                    {transmission.pdpConnection.label ?? transmission.pdpConnection.provider} · mise
                    en file le {formatDateTime(transmission.createdAt)}
                    {transmission.attempt > 1 ? ` · ${transmission.attempt} tentatives` : ''}
                  </p>
                </div>
                {transmission.externalId ? (
                  <div className="text-right">
                    <p className="text-xs text-navy-500">Référence plateforme</p>
                    <p className="break-all font-mono text-[11px] text-navy-700">
                      {transmission.externalId}
                    </p>
                  </div>
                ) : null}
              </div>

              {/*
                A pending row with a future retry is not stuck, and saying when it wakes up is the
                difference between waiting and opening a support ticket.
              */}
              {transmission.state === 'PENDING' && transmission.lastError ? (
                <p className="mt-2 text-xs text-signal-warn">
                  Dernier échec : {transmission.lastError} — nouvelle tentative le{' '}
                  {formatDateTime(transmission.nextAttemptAt)}.
                </p>
              ) : null}

              {transmission.state === 'FAILED' ? (
                <div className="mt-2">
                  <Alert tone="error" title="Transmission abandonnée">
                    <p className="break-words font-mono text-xs">
                      {transmission.lastError ?? 'Cause inconnue.'}
                    </p>
                    <p className="mt-2">
                      Les tentatives automatiques se sont arrêtées : après plusieurs échecs, la
                      cause est une configuration ou un document refusé, et attendre n&apos;y change
                      rien. Corrigez le raccordement, puis réessayez.
                    </p>
                  </Alert>
                  {mayTransmit ? (
                    <RetryForm invoiceId={invoiceId} transmissionId={transmission.id} />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the platform has reported back, oldest first.
 *
 * Append-only and shown in full, including superseded entries: a status history is evidence, and
 * "when did the buyer receive it" is answered by the sequence, not by the last line of it. The
 * source of each entry is labelled because an event we recorded about ourselves and one the
 * platform asserted are not worth the same in a dispute.
 */
function StatusTimeline({ statuses }: { statuses: readonly LifecycleStatusRecord[] }) {
  return (
    <section className="rounded-lg border border-navy-100 bg-white p-5">
      <h2 className="text-sm font-semibold text-navy-900">Suivi du cycle de vie</h2>

      <ol className="mt-4 space-y-0">
        {statuses.map((status, index) => (
          <li key={status.id} className="flex gap-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  status.source === 'INTERNAL' ? 'bg-navy-300' : 'bg-navy-700'
                }`}
              />
              {index < statuses.length - 1 ? <span className="w-px flex-1 bg-navy-100" /> : null}
            </div>

            <div className={index < statuses.length - 1 ? 'pb-4' : ''}>
              <p className="text-sm text-navy-900">
                {/* A code no adapter has taught us to name is still shown, rather than hidden. */}
                {status.label ?? status.code}
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {formatDateTime(status.occurredAt)} ·{' '}
                {STATUS_SOURCE_LABELS[status.source] ?? status.source}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
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
