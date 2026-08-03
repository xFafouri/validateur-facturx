'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError, type IssueResponse } from '@/lib/api';
import type { IssueFormState } from '@/lib/form-state';

/**
 * Issues an invoice.
 *
 * The payload is assembled here from the form rather than posted as JSON by the browser, so the
 * form keeps working without JavaScript and the API never sees a shape the browser invented.
 */
export async function issueInvoice(
  _state: IssueFormState,
  formData: FormData,
): Promise<IssueFormState> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const optional = (key: string): string | undefined => text(key) || undefined;

  // Lines arrive as parallel arrays, which is what a repeated form control produces.
  const names = formData.getAll('lineName').map(String);
  const lines = names
    .map((name, index) => ({
      name: name.trim(),
      description: String(formData.getAll('lineDescription')[index] ?? '').trim() || undefined,
      quantity: String(formData.getAll('lineQuantity')[index] ?? '').trim(),
      unitCode: String(formData.getAll('lineUnitCode')[index] ?? 'C62').trim() || 'C62',
      unitPrice: String(formData.getAll('lineUnitPrice')[index] ?? '').trim(),
      vatCategory: String(formData.getAll('lineVatCategory')[index] ?? 'S').trim(),
      vatRatePercent: String(formData.getAll('lineVatRate')[index] ?? '').trim(),
      exemptionReason:
        String(formData.getAll('lineExemptionReason')[index] ?? '').trim() || undefined,
    }))
    // A blank row is a row the user added and did not fill, not an error to report back at them.
    .filter((line) => line.name !== '' || line.unitPrice !== '');

  if (lines.length === 0) {
    return { error: 'Ajoutez au moins une ligne à la facture.', issues: [] };
  }

  let result: IssueResponse;
  try {
    result = await api<IssueResponse>('/invoices', {
      method: 'POST',
      body: {
        clientOrgId: text('clientOrgId'),
        invoiceNumber: text('invoiceNumber'),
        typeCode: optional('typeCode') ?? '380',
        issueDate: text('issueDate'),
        dueDate: optional('dueDate'),
        currency: 'EUR',
        buyerReference: optional('buyerReference'),
        purchaseOrderReference: optional('purchaseOrderReference'),
        buyer: {
          name: text('buyerName'),
          siret: optional('buyerSiret')?.replace(/\D/g, ''),
          vatId: optional('buyerVatId'),
          address: {
            line1: text('buyerAddressLine1'),
            line2: optional('buyerAddressLine2'),
            postcode: text('buyerPostcode'),
            city: text('buyerCity'),
            countryCode: optional('buyerCountryCode') ?? 'FR',
          },
        },
        lines,
        paymentMeansCode: optional('paymentMeansCode'),
        iban: optional('iban')?.replace(/\s/g, ''),
        paymentTerms: optional('paymentTerms'),
        prepaidAmount: optional('prepaidAmount'),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, issues: error.issues.map((issue) => issue.message) };
    }
    throw error;
  }

  revalidatePath('/factures');
  revalidatePath('/tableau-de-bord');
  redirect(`/factures/${result.invoiceId}?emise=1`);
}
