'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
// `/browser`, not the package root: the root pulls in font resolution and with it `node:fs`.
import {
  computeInvoice,
  money,
  VAT_CATEGORIES,
  ZERO_RATED_CATEGORIES,
} from '@facturx/core/browser';
import type { ClientOrgSummary } from '@/lib/api';
import { Alert, Button, Field, Select, TextInput } from '@/components/ui/Form';
import { formatEuros, VAT_CATEGORY_LABELS } from '@/lib/format';
import { issueInvoice } from '../actions';
import { NO_ISSUE_ERROR } from '@/lib/form-state';

/** The French rates. Free entry is still allowed, for the rare cases these do not cover. */
const COMMON_RATES = ['20.00', '10.00', '5.50', '2.10', '0.00'];

/** UN/ECE Rec 20 codes an invoicing UI actually needs. */
const UNITS = [
  { code: 'C62', label: 'unité' },
  { code: 'HUR', label: 'heure' },
  { code: 'DAY', label: 'jour' },
  { code: 'MTR', label: 'mètre' },
  { code: 'MTK', label: 'mètre carré' },
  { code: 'MTQ', label: 'mètre cube' },
  { code: 'KGM', label: 'kilogramme' },
  { code: 'LTR', label: 'litre' },
];

interface LineDraft {
  key: number;
  name: string;
  description: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  vatCategory: string;
  vatRatePercent: string;
  exemptionReason: string;
}

function blankLine(key: number): LineDraft {
  return {
    key,
    name: '',
    description: '',
    quantity: '1',
    unitCode: 'C62',
    unitPrice: '',
    vatCategory: 'S',
    vatRatePercent: '20.00',
    exemptionReason: '',
  };
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Émission en cours…' : 'Émettre la facture'}
    </Button>
  );
}

export function InvoiceForm({
  clientOrgs,
  defaultClientOrgId,
  today,
}: {
  clientOrgs: readonly ClientOrgSummary[];
  defaultClientOrgId: string;
  today: string;
}) {
  const [state, formAction] = useActionState(issueInvoice, NO_ISSUE_ERROR);

  const [lines, setLines] = useState<LineDraft[]>([blankLine(0)]);
  const [nextKey, setNextKey] = useState(1);
  const [prepaid, setPrepaid] = useState('');
  const [paymentMeans, setPaymentMeans] = useState('30');

  /** UNTDID 4461 credit-transfer codes, the ones BR-CO-27 obliges to carry an account. */
  const ibanRequired = paymentMeans === '30' || paymentMeans === '58';

  const update = (key: number, patch: Partial<LineDraft>): void => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // Changing to a category that charges no VAT must zero the rate, or the document fails
        // BR-Z-01 / BR-E-01 with a rate the user never intended to state.
        if (patch.vatCategory && ZERO_RATED_CATEGORIES.includes(patch.vatCategory as never)) {
          next.vatRatePercent = '0.00';
        }
        return next;
      }),
    );
  };

  /**
   * Live totals, computed with the same function the server uses to derive the real ones.
   *
   * That is the point of importing `computeInvoice` here rather than adding up prices in the
   * component: the preview cannot round differently from the issued document, because it is not a
   * second implementation. `money` is `bigint`-backed, so no float ever touches these figures.
   */
  const preview = useMemo(() => {
    const usable = lines.filter((line) => line.unitPrice.trim() !== '');
    if (usable.length === 0) return null;

    try {
      return computeInvoice({
        invoiceNumber: 'APERCU',
        issueDate: today,
        // Parties do not affect arithmetic; placeholders keep the draft shape valid.
        seller: { name: '—', address: { line1: '', postcode: '', city: '', countryCode: 'FR' } },
        buyer: { name: '—', address: { line1: '', postcode: '', city: '', countryCode: 'FR' } },
        prepaidAmount: prepaid.trim() === '' ? null : normalise(prepaid),
        lines: usable.map((line) => ({
          name: line.name || '—',
          quantity: normalise(line.quantity) || '0',
          unitCode: line.unitCode,
          unitPrice: normalise(line.unitPrice) || '0',
          vatCategory: line.vatCategory as never,
          vatRatePercent: normalise(line.vatRatePercent) || '0',
          exemptionReason: line.exemptionReason || null,
        })),
      });
    } catch {
      // Half-typed input is expected while someone is filling a form; the preview simply waits.
      return null;
    }
  }, [lines, prepaid, today]);

  return (
    <form action={formAction} className="space-y-8">
      {state.error ? (
        <Alert tone="error" title="La facture n'a pas été émise">
          <p>{state.error}</p>
          {state.issues.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <section className="space-y-5 rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-base font-semibold text-navy-900">Émetteur et références</h2>

        <Field
          label="Émise au nom de"
          name="clientOrgId"
          required
          hint="Le vendeur est repris de la fiche de cette entreprise, jamais saisi ici."
        >
          <Select name="clientOrgId" required defaultValue={defaultClientOrgId}>
            {clientOrgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Numéro de facture"
            name="invoiceNumber"
            required
            hint="Numérotation continue, sans doublon ni rupture (art. 242 nonies A, ann. II au CGI)."
          >
            <TextInput name="invoiceNumber" required placeholder="FA-2026-0001" />
          </Field>

          <Field label="Type de document" name="typeCode" required>
            <Select name="typeCode" defaultValue="380">
              <option value="380">Facture</option>
              <option value="381">Avoir</option>
              <option value="384">Facture rectificative</option>
              <option value="386">Facture d&apos;acompte</option>
            </Select>
          </Field>

          <Field label="Date d'émission" name="issueDate" required>
            <TextInput name="issueDate" type="date" required defaultValue={today} />
          </Field>

          <Field label="Date d'échéance" name="dueDate">
            <TextInput name="dueDate" type="date" />
          </Field>

          <Field
            label="Référence acheteur"
            name="buyerReference"
            hint="Exigée par la plupart des grands donneurs d'ordre et par le secteur public."
          >
            <TextInput name="buyerReference" placeholder="SERVICE-ACHATS" />
          </Field>

          <Field label="Bon de commande" name="purchaseOrderReference">
            <TextInput name="purchaseOrderReference" placeholder="BC-2026-142" />
          </Field>
        </div>
      </section>

      <section className="space-y-5 rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-base font-semibold text-navy-900">Client facturé</h2>

        <Field label="Raison sociale" name="buyerName" required>
          <TextInput name="buyerName" required placeholder="Boulangerie Martin SAS" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="SIRET" name="buyerSiret" hint="Sert d'adresse de routage (schéma 0009).">
            <TextInput name="buyerSiret" inputMode="numeric" placeholder="443 061 841 00005" />
          </Field>
          <Field label="Numéro de TVA" name="buyerVatId">
            <TextInput name="buyerVatId" placeholder="FR64443061841" />
          </Field>
        </div>

        <Field label="Adresse" name="buyerAddressLine1" required>
          <TextInput name="buyerAddressLine1" required placeholder="12 rue de la République" />
        </Field>

        <Field label="Complément d'adresse" name="buyerAddressLine2">
          <TextInput name="buyerAddressLine2" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Code postal" name="buyerPostcode" required>
            <TextInput name="buyerPostcode" required inputMode="numeric" placeholder="69002" />
          </Field>
          <Field label="Ville" name="buyerCity" required>
            <TextInput name="buyerCity" required placeholder="Lyon" />
          </Field>
          <Field label="Pays" name="buyerCountryCode" required>
            <Select name="buyerCountryCode" defaultValue="FR">
              <option value="FR">France</option>
              <option value="BE">Belgique</option>
              <option value="DE">Allemagne</option>
              <option value="ES">Espagne</option>
              <option value="IT">Italie</option>
              <option value="LU">Luxembourg</option>
              <option value="NL">Pays-Bas</option>
              <option value="CH">Suisse</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-navy-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-navy-900">Lignes</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setLines((current) => [...current, blankLine(nextKey)]);
              setNextKey((key) => key + 1);
            }}
          >
            Ajouter une ligne
          </Button>
        </div>

        <ul className="space-y-4">
          {lines.map((line, index) => (
            <li key={line.key} className="rounded border border-navy-100 bg-navy-50/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Ligne {index + 1}
                </span>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                    className="text-xs font-medium text-signal-error underline"
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>

              <div className="space-y-4">
                <Field label="Désignation" name={`lineName-${line.key}`} required>
                  <TextInput
                    id={`lineName-${line.key}`}
                    name="lineName"
                    required
                    value={line.name}
                    onChange={(event) => update(line.key, { name: event.target.value })}
                    placeholder="Prestation de conseil"
                  />
                </Field>

                <Field label="Description" name={`lineDescription-${line.key}`}>
                  <TextInput
                    id={`lineDescription-${line.key}`}
                    name="lineDescription"
                    value={line.description}
                    onChange={(event) => update(line.key, { description: event.target.value })}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Quantité" name={`lineQuantity-${line.key}`} required>
                    <TextInput
                      id={`lineQuantity-${line.key}`}
                      name="lineQuantity"
                      required
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => update(line.key, { quantity: event.target.value })}
                    />
                  </Field>

                  <Field label="Unité" name={`lineUnitCode-${line.key}`} required>
                    <Select
                      id={`lineUnitCode-${line.key}`}
                      name="lineUnitCode"
                      value={line.unitCode}
                      onChange={(event) => update(line.key, { unitCode: event.target.value })}
                    >
                      {UNITS.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Prix unitaire HT" name={`lineUnitPrice-${line.key}`} required>
                    <TextInput
                      id={`lineUnitPrice-${line.key}`}
                      name="lineUnitPrice"
                      required
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                      placeholder="450,00"
                    />
                  </Field>

                  <div className="flex items-end pb-1">
                    <div className="w-full text-right">
                      <div className="text-xs text-navy-500">Total HT</div>
                      <div className="text-sm font-semibold tabular-nums text-navy-900">
                        {lineTotal(preview, index)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Régime de TVA" name={`lineVatCategory-${line.key}`} required>
                    <Select
                      id={`lineVatCategory-${line.key}`}
                      name="lineVatCategory"
                      value={line.vatCategory}
                      onChange={(event) => update(line.key, { vatCategory: event.target.value })}
                    >
                      {VAT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {VAT_CATEGORY_LABELS[category] ?? category}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Taux de TVA (%)" name={`lineVatRate-${line.key}`} required>
                    <TextInput
                      id={`lineVatRate-${line.key}`}
                      name="lineVatRate"
                      required
                      inputMode="decimal"
                      list="taux-tva"
                      value={line.vatRatePercent}
                      disabled={ZERO_RATED_CATEGORIES.includes(line.vatCategory as never)}
                      onChange={(event) => update(line.key, { vatRatePercent: event.target.value })}
                    />
                  </Field>
                </div>

                {/*
                  BR-E-10, BR-AE-10, BR-IC-10 and BR-G-10 each require a stated reason. `Z` is
                  deliberately excluded: zero-rated means VAT at 0 %, not outside VAT, and BR-Z-10
                  forbids a reason rather than requiring one.
                */}
                {['E', 'AE', 'K', 'G'].includes(line.vatCategory) ? (
                  <Field
                    label="Motif d'exonération"
                    name={`lineExemptionReason-${line.key}`}
                    required
                    hint="Obligatoire pour ce régime : la facture est rejetée sans motif."
                  >
                    <TextInput
                      id={`lineExemptionReason-${line.key}`}
                      name="lineExemptionReason"
                      required
                      value={line.exemptionReason}
                      onChange={(event) =>
                        update(line.key, { exemptionReason: event.target.value })
                      }
                      placeholder="Autoliquidation — article 283-2 du CGI"
                    />
                  </Field>
                ) : (
                  <input type="hidden" name="lineExemptionReason" value="" />
                )}
              </div>
            </li>
          ))}
        </ul>

        <datalist id="taux-tva">
          {COMMON_RATES.map((rate) => (
            <option key={rate} value={rate} />
          ))}
        </datalist>
      </section>

      <section className="space-y-5 rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-base font-semibold text-navy-900">Paiement</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Moyen de paiement" name="paymentMeansCode">
            <Select
              name="paymentMeansCode"
              value={paymentMeans}
              onChange={(event) => setPaymentMeans(event.target.value)}
            >
              <option value="30">Virement</option>
              <option value="48">Carte bancaire</option>
              <option value="49">Prélèvement</option>
              <option value="10">Espèces</option>
              <option value="20">Chèque</option>
              <option value="1">Non précisé</option>
            </Select>
          </Field>

          {/*
            BR-CO-27: a credit transfer must name the account to credit. Marked required in the
            markup so the browser says so before the form is submitted - the server refuses it
            either way, but being told after a round trip through PDF generation and a Schematron
            run is a much worse way to learn it.
          */}
          <Field
            label="IBAN"
            name="iban"
            required={ibanRequired}
            hint={
              ibanRequired
                ? 'Le compte à créditer (BT-84). Obligatoire pour un virement.'
                : 'Le compte à créditer (BT-84).'
            }
          >
            <TextInput
              name="iban"
              required={ibanRequired}
              placeholder="FR76 3000 6000 0112 3456 7890 189"
            />
          </Field>
        </div>

        <Field label="Conditions de paiement" name="paymentTerms">
          <TextInput name="paymentTerms" placeholder="Paiement à 30 jours date de facture" />
        </Field>

        <Field
          label="Acompte déjà versé"
          name="prepaidAmount"
          hint="Déduit du total pour donner le net à payer (BT-115)."
        >
          <TextInput
            name="prepaidAmount"
            inputMode="decimal"
            value={prepaid}
            onChange={(event) => setPrepaid(event.target.value)}
            placeholder="0,00"
          />
        </Field>
      </section>

      <section className="rounded-lg border border-navy-100 bg-white p-5">
        <h2 className="text-base font-semibold text-navy-900">Totaux</h2>
        <p className="mt-1 text-xs text-navy-500">
          Calculés à partir des lignes, avec la même arithmétique que le document émis. Ils ne sont
          pas saisissables : un total qui ne peut pas être saisi ne peut pas contredire les lignes,
          ce qui est exactement l&apos;objet de la règle BR-CO-10.
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <Total label="Total HT" value={preview && fmt(preview.totals.lineTotalAmount)} />
          <Total label="TVA" value={preview && fmt(preview.totals.taxTotalAmount)} />
          <Total label="Total TTC" value={preview && fmt(preview.totals.grandTotalAmount)} strong />
          {preview && preview.totals.prepaidAmount.value !== 0n ? (
            <>
              <Total label="Acompte versé" value={fmt(preview.totals.prepaidAmount)} />
              <Total label="Net à payer" value={fmt(preview.totals.duePayableAmount)} strong />
            </>
          ) : null}
        </dl>

        {preview && preview.taxGroups.length > 1 ? (
          <div className="mt-4 border-t border-navy-50 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
              Détail de la TVA
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-navy-700">
              {preview.taxGroups.map((group) => (
                <li key={`${group.categoryCode}-${money.format(group.ratePercent)}`}>
                  {money.format(group.ratePercent)} % sur {fmt(group.basisAmount)} ={' '}
                  {fmt(group.calculatedAmount)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton />
        <p className="text-xs leading-relaxed text-navy-500">
          La facture est générée, vérifiée par le moteur de validation, puis scellée. Si elle
          n&apos;est pas conforme, rien n&apos;est enregistré.
        </p>
      </div>
    </form>
  );
}

/** Comma decimals are how a French keyboard produces them; the engine wants a point. */
function normalise(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.');
}

function fmt(amount: { value: bigint; scale: number }): string {
  return formatEuros(money.format(money.rescale(amount, 2)));
}

function lineTotal(preview: ReturnType<typeof computeInvoice> | null, index: number): string {
  const line = preview?.lines[index];
  return line ? fmt(line.netAmount) : '—';
}

function Total({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${strong ? 'font-semibold text-navy-900' : 'text-navy-700'}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}
