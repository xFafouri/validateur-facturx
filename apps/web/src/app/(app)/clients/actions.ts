'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError, type ClientOrgSummary } from '@/lib/api';
import type { ClientOrgFormState } from '@/lib/form-state';

/** Empty string to null, so an untouched optional input is absent rather than blank. */
function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  return text === '' ? undefined : text;
}

/** Whitespace and the separators people paste from INSEE listings are not part of a SIREN. */
function digits(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').replace(/[\s.-]/g, '');
  return text === '' ? undefined : text;
}

export async function createClientOrg(
  _state: ClientOrgFormState,
  formData: FormData,
): Promise<ClientOrgFormState> {
  let created: ClientOrgSummary;

  try {
    created = await api<ClientOrgSummary>('/client-orgs', {
      method: 'POST',
      body: {
        name: String(formData.get('name') ?? '').trim(),
        siren: digits(formData.get('siren')) ?? '',
        siret: digits(formData.get('siret')),
        vatNumber: optional(formData.get('vatNumber')),
        addressLine1: optional(formData.get('addressLine1')),
        addressLine2: optional(formData.get('addressLine2')),
        postcode: optional(formData.get('postcode')),
        city: optional(formData.get('city')),
        countryCode: optional(formData.get('countryCode')) ?? 'FR',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }

  revalidatePath('/clients');
  revalidatePath('/tableau-de-bord');
  // `redirect` throws to unwind, so it must be outside the try that catches ApiError.
  redirect(`/clients?ajoutee=${encodeURIComponent(created.name)}`);
}
