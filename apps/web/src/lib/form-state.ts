/**
 * Shapes and initial values for `useActionState` forms.
 *
 * Separate from the action modules because a `'use server'` file may only export async functions -
 * everything in it becomes a callable server endpoint, so a plain object export is rejected
 * outright rather than treated as a constant. Keeping the initial states here also means a client
 * component can import them without pulling a server module into its graph.
 */

/** A form whose only failure mode is one message. */
export interface FormState {
  readonly error: string | null;
}

export const NO_ERROR: FormState = { error: null };

/** Client-org creation: same shape, named separately so the two cannot be swapped by accident. */
export type ClientOrgFormState = FormState;

export const NO_CLIENT_ERROR: ClientOrgFormState = { error: null };

/**
 * Issuance can fail with a list as well as a message.
 *
 * A refused draft reports every problem at once - a missing buyer address *and* a missing
 * exemption reason - because fixing them one round trip at a time is the difference between one
 * correction and four.
 */
export interface IssueFormState {
  readonly error: string | null;
  readonly issues: readonly string[];
}

export const NO_ISSUE_ERROR: IssueFormState = { error: null, issues: [] };

/** Reception reports a result in place rather than redirecting; see `receiveInvoice`. */
export interface ReceiveFormState {
  readonly error: string | null;
  readonly result: {
    readonly invoiceId: string;
    readonly invoiceNumber: string;
    readonly clientOrgName: string;
    readonly supplierName: string | null;
    readonly conforme: boolean;
    readonly duplicate: boolean;
    readonly errorCount: number;
    readonly ruleIds: readonly string[];
    readonly filename: string;
  } | null;
}

export const NO_RECEIVE_STATE: ReceiveFormState = { error: null, result: null };
