/**
 * Server-side client for the invoicing API.
 *
 * The authenticated area reads and writes through the API rather than through Prisma directly,
 * even though this app has a database connection for sessions. The API owns issuance, archiving
 * and integrity verification, and every one of its queries carries a tenant predicate. Reaching
 * around it would mean writing those predicates a second time, in a second place, and tenant
 * scoping is precisely the thing that must not have two implementations.
 *
 * The browser never talks to the API. Requests go web-server to API, with the session cookie
 * forwarded, so there is one origin to configure and no cross-site cookie problem.
 */

import { sessionCookieHeader } from './session';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  readonly status: number;
  /** Field-level problems, when the API returned them (a rejected draft, a failed DTO). */
  readonly issues: readonly { message: string; field?: string }[];

  constructor(status: number, message: string, issues: readonly { message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

interface ApiRequest {
  readonly method?: string;
  readonly body?: unknown;
  /** Passed through to `fetch`; the default is no caching, since all of this is per-tenant. */
  readonly cache?: RequestCache;
}

async function raise(response: Response): Promise<never> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON error body (a proxy's HTML 502 page) is not worth surfacing verbatim.
  }

  const body = payload as { message?: unknown; issues?: unknown } | null;
  const message =
    typeof body?.message === 'string'
      ? body.message
      : Array.isArray(body?.message)
        ? (body.message as string[]).join(' ')
        : `La requête a échoué (HTTP ${response.status}).`;

  const issues = Array.isArray(body?.issues)
    ? (body.issues as { message: string }[]).filter((issue) => typeof issue?.message === 'string')
    : [];

  throw new ApiError(response.status, message, issues);
}

/** Calls the API as the current user. Throws `ApiError` on any non-2xx. */
export async function api<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const cookie = await sessionCookieHeader();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: request.method ?? 'GET',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      cache: request.cache ?? 'no-store',
    });
  } catch (cause) {
    // A connection refused here means the API is down, which is an outage rather than a user
    // error - say so plainly instead of rendering an empty invoice list as though it were true.
    throw new ApiError(
      503,
      "Le service de facturation est injoignable. Vos données n'ont pas été modifiées.",
      [],
    );
  }

  if (!response.ok) await raise(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Streams a sealed artifact back, for the download route to relay to the browser. */
export async function apiDownload(path: string): Promise<Response> {
  const cookie = await sessionCookieHeader();
  return fetch(`${API_URL}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ClientOrgSummary {
  id: string;
  name: string;
  siren: string;
  siret: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  city: string | null;
  countryCode: string;
  defaultProfile: string;
  _count: { invoices: number };
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  typeCode: string;
  state: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  grandTotalAmount: string;
  duePayableAmount: string;
  lastValidationValid: boolean | null;
  clientOrg: { id: string; name: string };
  buyer: { name: string };
}

export interface InvoiceListPage {
  total: number;
  invoices: InvoiceSummary[];
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  typeCode: string;
  state: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  buyerReference: string | null;
  profile: string;
  lineTotalAmount: string;
  taxBasisTotalAmount: string;
  taxTotalAmount: string;
  grandTotalAmount: string;
  prepaidAmount: string;
  duePayableAmount: string;
  lastValidationValid: boolean | null;
  lastValidatedAt: string | null;
  clientOrg: { id: string; name: string; siren: string };
  seller: PartyRecord;
  buyer: PartyRecord;
  lines: InvoiceLineRecord[];
  taxBreakdown: TaxBreakdownRecord[];
  archiveEntries: ArchiveEntryRecord[];
}

export interface PartyRecord {
  name: string;
  legalId: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  city: string | null;
  countryCode: string | null;
}

export interface InvoiceLineRecord {
  id: string;
  lineId: string;
  name: string;
  description: string | null;
  quantity: string;
  unitCode: string;
  netUnitPrice: string;
  netAmount: string;
  vatCategoryCode: string;
  vatRatePercent: string;
}

export interface TaxBreakdownRecord {
  id: string;
  basisAmount: string;
  calculatedAmount: string;
  categoryCode: string;
  ratePercent: string;
  exemptionReason: string | null;
}

export interface ArchiveEntryRecord {
  id: string;
  artifactKind: string;
  contentHash: string;
  sizeBytes: number;
  sealedAt: string;
  retentionUntil: string;
}

export interface IssueResponse {
  invoiceId: string;
  invoiceNumber: string;
  contentHash: string;
  warnings: { message: string; severity: string }[];
}
