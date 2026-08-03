'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiUpload, type ReceiveResponse } from '@/lib/api';
import type { ReceiveFormState } from '@/lib/form-state';

/** Matches the API and the public validator. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Records a received invoice.
 *
 * Deliberately does not redirect on success. Receiving is a batch activity - an accountant works
 * through a folder of supplier invoices - and bouncing to a detail page after each one would make
 * the common case the slow one. The result is reported in place and the form stays ready.
 */
export async function receiveInvoice(
  _state: ReceiveFormState,
  formData: FormData,
): Promise<ReceiveFormState> {
  const file = formData.get('facture');

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choisissez un fichier à déposer.', result: null };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `Le fichier dépasse la taille maximale de ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo.`,
      result: null,
    };
  }

  let result: ReceiveResponse;
  try {
    result = await apiUpload(
      `/invoices/reception?filename=${encodeURIComponent(file.name)}`,
      await file.arrayBuffer(),
      file.type || 'application/octet-stream',
    );
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, result: null };
    throw error;
  }

  revalidatePath('/reception');
  revalidatePath('/factures');
  revalidatePath('/tableau-de-bord');

  return { error: null, result: { ...result, filename: file.name } };
}
