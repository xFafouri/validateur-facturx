'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError, type EnqueueResponse } from '@/lib/api';
import type { TransmitFormState } from '@/lib/form-state';

/**
 * Queues an invoice for its platform.
 *
 * Reports in place rather than redirecting, because the two interesting outcomes are both things
 * to read on the page you are already on: "it is on its way", and the 409 that says this business
 * is not connected to anything yet — which the message turns into a place to go.
 */
export async function transmitInvoice(
  _state: TransmitFormState,
  formData: FormData,
): Promise<TransmitFormState> {
  const invoiceId = String(formData.get('invoiceId') ?? '');

  let result: EnqueueResponse;
  try {
    result = await api<EnqueueResponse>(`/pdp/invoices/${encodeURIComponent(invoiceId)}/transmit`, {
      method: 'POST',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, queued: false, alreadyQueued: false };
    }
    throw error;
  }

  revalidatePath(`/factures/${invoiceId}`);
  revalidatePath('/factures');
  return { error: null, queued: true, alreadyQueued: result.alreadyQueued };
}

/**
 * Puts a parked transmission back in the queue.
 *
 * The row keeps its idempotency key, so the platform recognises the retry as the same send — which
 * is why this is offered as a button at all rather than left to a support ticket.
 */
export async function retryTransmission(
  _state: TransmitFormState,
  formData: FormData,
): Promise<TransmitFormState> {
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const transmissionId = String(formData.get('transmissionId') ?? '');

  try {
    await api(`/pdp/transmissions/${encodeURIComponent(transmissionId)}/retry`, {
      method: 'POST',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, queued: false, alreadyQueued: false };
    }
    throw error;
  }

  revalidatePath(`/factures/${invoiceId}`);
  return { error: null, queued: true, alreadyQueued: false };
}
