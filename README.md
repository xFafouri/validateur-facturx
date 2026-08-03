# Factur-X e-Invoicing Compliance Platform

A _Solution Compatible_ (SC) for France's 2026–2027 B2B e-invoicing mandate, aimed at the
underserved long tail: micro-businesses, accountants managing many small clients, and niche
software with no native e-invoicing.

**Status: Phases 0 and 1 complete; reception built.** The free public validator runs, backed by a
real Schematron engine, with every rule explained in French. Invoices are _generated_ — PDF/A-3
with embedded `factur-x.xml` — self-validated against that same engine, persisted, and sealed into
an immutable content-addressed archive. A signed-in user can add the businesses they invoice for,
issue an invoice through the UI, **receive supplier invoices**, and download the sealed documents.
See [Roadmap](#roadmap).

> **Why reception came before the rest of Phase 2.** The 1 September 2026 obligation that applies
> to _every_ VAT-registered business is the obligation to **receive**. Issuing is phased: large
> firms and ETI in 2026, SMEs and micro-businesses in 2027. For this product's target market the
> receiving side is the deadline, and the issuing side is next year's problem.

> **Scope boundary.** This is a _Solution Compatible_, **not** a _Plateforme Agréée_ (PA). It
> creates and validates invoices and connects to an existing certified platform; it is not
> accredited by the DGFiP and never talks to the PPF directly. See
> [`apps/api/src/pdp/pdp-provider.ts`](apps/api/src/pdp/pdp-provider.ts).

---

## Quick start

```bash
pnpm install

# The validation engine. First build downloads Maven dependencies (a few minutes); after that
# the container warms up in ~2s.
pnpm validator:up

pnpm --filter @facturx/core build   # the apps consume its build output
pnpm dev:web                        # http://localhost:3000
```

`PORT=3100 pnpm dev:web` if port 3000 is already taken.

Verify everything:

```bash
pnpm verify   # build + format check + typecheck + 199 tests
```

The invoicing and archiving suites need Postgres as well, and skip without it:

```bash
docker compose up -d postgres
pnpm --filter @facturx/db migrate:deploy
```

`POSTGRES_PORT=5433` (in `.env`, matching `DATABASE_URL`) if another project already binds 5432.

Generating an invoice needs an embeddable font, because PDF/A forbids the standard 14 PDF fonts.
`resolveSystemFonts()` picks up DejaVu or Liberation from the host; a container that generates
invoices must install one (`fonts-dejavu-core`) or point `FACTURX_FONT_REGULAR` /
`FACTURX_FONT_BOLD` at a font file.

---

## Layout

| Path                 | What it is                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js. Public French validator, SEO landing page, and the signed-in invoicing UI. **Built.**                |
| `apps/api`           | NestJS. Validation, invoicing and archiving implemented; PDP and billing are skeletons.                       |
| `packages/facturx`   | Core: CII parsing/serialising, PDF/A-3 extraction and assembly, validation, French rule catalogue. **Built.** |
| `packages/auth`      | Password hashing and server-side sessions, shared by the web app and the API. **Built.**                      |
| `packages/db`        | Prisma schema for the full data model. **Migrated and in use.**                                               |
| `services/validator` | Java sidecar wrapping Mustangproject. **Built.**                                                              |

### Why a Java sidecar

Validation correctness is the whole product, and Mustangproject is the most battle-tested
Factur-X validator available. It ships the EN 16931 Schematron, the Factur-X profile rules, **and
the DGFiP "Flux 2" French Schematron (`BR-FR-*`, v1.3.0)** — meaning French national rules are
enforced for real rather than approximated.

The sidecar is deliberately thin: it returns Mustang's XML report verbatim, and all interpretation
lives in `packages/facturx`. One implementation of the presentation logic, in the language the rest
of the stack is written in.

---

## What makes this different from running a validator

**1. Every rule is explained in French, with the fix.** A raw validator says:

```
[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
```

We say what the rule requires, why it usually fails (an arrears of rounding), and what to change —
in the language of someone running a bakery, not an implementer.

**2. We name the amounts the engine only alludes to.** The engine states the rule but never the
two figures it compared. Having parsed the invoice ourselves, we show both and the difference to
the cent, and point at the line whose amount matches the gap:

> Total HT des lignes : la facture déclare **250,00 €**, mais le calcul donne **200,00 €**.
> Le montant déclaré est supérieur de **50,00 €** au montant attendu.

**3. German rules are separated out.** Mustang evaluates the German XRechnung ruleset regardless of
a document's origin, and reports it _in German_. Showing "Eine Rechnung muss Angaben zu PAYMENT
INSTRUCTIONS enthalten" to a French user validating a French invoice is worse than useless. Findings
are classified by originating ruleset — French DGFiP rules first, EN 16931 next, German folded away.

**4. Receiver-side reading.** From 1 September 2026 every VAT-registered business must be able to
_receive_ structured invoices, and `factur-x.xml` is unreadable without tooling. Uploading a
supplier's invoice renders who sent it, for how much, and when it is due — useful even when the
document is perfectly valid.

---

## Generation

A draft invoice carries lines, rates and parties — and **no totals**. Every monetary total on the
emitted document is derived from the lines
([`compute.ts`](packages/facturx/src/generate/compute.ts)). `BR-CO-10` is the most common rejection
in the wild precisely because senders carry a total some earlier system computed separately; a total
that cannot be supplied cannot disagree. The same computed values render both the XML and the
printed page, so the two renditions of one invoice cannot drift apart.

Rounding follows EN 16931's order: each line is rounded to the cent _before_ being summed, because
BT-131 is a 2-decimal amount and the validator checks a sum of rounded values. Summing unrounded
products and rounding at the end differs on roughly one invoice in fifty — and that invoice is
rejected.

**Checks run before generation, not after.** A draft is refused with every problem listed at once,
in French, against the field the user is editing: a missing exemption reason, a VAT number whose key
does not match its SIREN, an IBAN that fails its check digits (valid per the standard, but the
invoice never gets paid). Emitting a document we already know a validator will reject is the failure
this product exists to prevent.

**Each VAT category is checked against the engine, not against memory.** The six categories do not
agree with one another: `E`, `AE`, `K` and `G` each require an exemption reason, `Z` **forbids** one
(zero-rated is taxed at 0 %, not exempt — BR-Z-10), and `K` additionally requires a delivery country
(BR-IC-12). Assuming `Z` behaved like the others produced documents rejected for the very field the
generator was being careful about. The integration suite now validates one invoice per category.

### Issuing and archiving

`IssuanceService` ([`apps/api/src/invoicing`](apps/api/src/invoicing/issuance.service.ts)) runs one
ordered path: generate, self-validate against the engine, then persist and seal. Nothing reaches the
database until the engine has accepted the document, so the invoice table cannot come to hold
records of invoices that a certified platform would reject. **If the engine is unreachable, the
issuance is refused** rather than archived unverified — an invoice is a legal act, and sealing one
into a ten-year archive without having checked it is worse than making the user wait.

Three properties are enforced rather than trusted:

- **The seller is read from the client org**, never from the request payload, so a caller cannot
  issue an invoice claiming to be a business it does not belong to.
- **Tenant scoping is a predicate on every query**, not a filter applied after the fact.
- **Amounts cross into Postgres as exact decimal strings.** `Decimal` → `number` → `NUMERIC` would
  reintroduce the drift the whole pipeline exists to avoid, one cast from the finish line.

The archive is content-addressed by SHA-256 and write-once: sealing identical bytes twice is a
no-op (which is what makes a retried issuance safe), and reading an artifact back re-hashes it and
refuses to return bytes that no longer match what was sealed. The store sits behind an
`ArtifactStore` port for the same reason as `PdpProvider` — the filesystem driver is for
development, and production must use EU object storage with versioning and object-lock.

**The sRGB ICC profile is constructed, not shipped.**
[`icc.ts`](packages/facturx/src/generate/icc.ts) builds a valid ICC v2 matrix/TRC profile — header,
tag table, sampled sRGB tone curve — because PDF/A requires an OutputIntent and the alternatives
were a binary blob in the repository or a file the host may not have (this machine had none). The
generator has no external asset and produces byte-identical output on any machine, which is what
lets an archived document be identified by its hash.

---

## Authentication

Identity is **self-hosted**, in the same EU Postgres as the invoices. A managed provider would put
the user table on someone else's infrastructure, typically US-hosted, reopening the data-residency
question the rest of the architecture is careful to close.

**Not Auth.js**, despite it being the obvious default for Next.js. `@auth/core` mints an encrypted
JWT on the credentials sign-in path and rejects `strategy: "database"` when credentials is the only
provider, so email-and-password under Auth.js leaves no session row in Postgres — and the API would
then have to reimplement its HKDF/JWE key derivation to identify a caller, against a package still
in beta. [`packages/auth`](packages/auth) is about four hundred lines instead.

Sessions are **opaque tokens resolved against a table on every request**. That costs a read per
request, and buys two properties worth more than the read:

- **Revocation is immediate.** Signing out, disabling an account or reacting to a stolen laptop
  takes effect on the next request. A stateless token stays valid until it expires whatever the
  database says, and "valid for another week" is not an acceptable answer for a system holding ten
  years of a client's tax records.
- **The API verifies callers itself.** Both tiers read the same table, so identity is never
  asserted across a trust boundary — no shared signing secret, and no header to spoof if the API is
  ever reached directly. `SessionGuard`
  ([`apps/api/src/auth`](apps/api/src/auth/session.guard.ts)) is the only thing that maps a request
  to a tenant, and the tenant id is never read from a request body.

Only the SHA-256 of a token is stored, so a leaked backup or a stray query log yields no live
session. Passwords use scrypt from `node:crypto` — memory-hard, and already in the runtime, so the
Docker image needs no native build toolchain. Digests carry their own parameters and are upgraded
on sign-in when the cost is raised. Sign-in spends a full scrypt even for an address with no
account, so response latency cannot be used to enumerate a cabinet's client list.

CSRF has two independent defences: the cookie is `SameSite=Lax`, so a cross-site POST does not
carry it, and Next.js checks `Origin` against `Host` on every Server Action.

**Not built: password reset.** There is no mail transport yet, so a locked-out user needs an
operator. Sessions, revocation and account disabling are all in place to support it when there is.

---

## Receiving

**Reception is the mirror image of issuance, and the asymmetry is deliberate.** Issuance refuses to
write anything the engine has not accepted: we are the author, and an invoice we cannot verify is
one we should not have produced. Reception cannot work that way. A supplier sends what a supplier
sends; if it is malformed we have still received it. Refusing to record a non-conforming invoice
would mean the document an accountant most needs to see — the broken one — is the one the system
silently drops.

So a received invoice is **stored whether or not it validates**, with the verdict and the rules
that fired recorded beside it, and the original bytes sealed unmodified because they are the
evidence of what the supplier actually sent. Two things are still refused, and both are refusals of
a different kind: a file that cannot be read as an invoice at all, and an invoice addressed to a
business this tenant does not manage.

**Routing is by identity, never by name.** The buyer's SIRET is tried first, then the SIREN behind
it — an invoice to one establishment belongs to the company we hold — then the VAT number. Two
businesses share a name far more often than they share a SIREN, and an invoice filed into the wrong
client's books is very hard to notice later.

Receiving the same bytes twice is normal (a retry, a forwarded email, a platform redelivering) and
is idempotent on the content hash.

### What reception changed in the schema

Two constraints were wrong as soon as invoices could arrive rather than only leave, and both are
now partial indexes written by hand in [the migration](packages/db/prisma/migrations):

- **Invoice-number uniqueness is an issuer's obligation.** The CGI requires unbroken, duplicate-free
  numbering from the business _issuing_; it says nothing about what that business receives. The old
  constraint spanned direction but not the counterparty, so a second supplier using `FA-2026-001`
  was rejected as a duplicate. It is now unique per client org for issued invoices, and per client
  org _and supplier_ for received ones.
- **Totals became nullable.** A malformed received invoice may omit BT-112, and it has to be
  recorded as omitting it — a fabricated `0,00 €` in front of an accountant is worse than a visible
  gap. Nothing about issued invoices weakened: a `CHECK` constraint still requires every total when
  `direction = 'ISSUED'`, so the guarantee moved from the code into the table.

---

## Correctness notes

**Money is never a float.** All amounts are exact `bigint`-backed decimals
([`money.ts`](packages/facturx/src/money.ts)). IEEE-754 drift is the direct mechanism behind
spurious `BR-CO-10` failures, so no amount touches floating point anywhere in the pipeline.

**Our checks never contradict the engine.** The arithmetic checks exist to _explain_ the engine's
findings, never to invent their own. Where a profile cannot express the data a rule needs — the
`MINIMUM` profile has no prepaid-amount field, so a deposit produces a legitimate BT-112/BT-115 gap
— the check reports "not evaluable" rather than a failure. Verified against a published French
MINIMUM sample that Mustangproject accepts as valid.

**Tests run against third-party documents.** `pnpm --filter @facturx/core fetch-samples` pulls real
invoices from the Mustangproject suite. Testing only against fixtures we wrote ourselves would
prove our parser agrees with our own idea of CII — the assumption most likely to be wrong. Two real
bugs were found this way: a scan window too small to find the root element behind a long licence
comment, and the over-strict `BR-CO-16` check described above.

**Generating and validating are checked against each other.** The integration suite sends generated
documents back through the Mustangproject engine and requires zero findings. Our parser agreeing
with our own serialiser would prove nothing about either; only an independent engine's verdict does.
This is what caught the two defects below.

**A false pass was fixed here.** Mustang's top-level `<summary status="valid"/>` aggregates the
Schematron result only — a document whose **PDF/A validation failed** is still summarised as valid,
and the veraPDF verdict arrives as untagged text inside `<pdf>` rather than as findings. We trusted
that summary, so a Factur-X file that was not PDF/A-3 was reported to the user as _conforme_. The
PDF/A failures are now parsed into findings with their ISO clause, and the verdict consults the
PDF/A result directly. A validator that says "compliant" about a non-compliant document is worse
than no validator.

The same round trip showed our own generator producing PDFs that failed PDF/A on ISO 19005-3 clause
6.1.3: pdf-lib does not write a trailer `/ID`, which no PDF reader complains about and every PDF/A
validator does.

**199 tests**, including 19 core integration tests and 10 issuance tests against the live engine —
the latter also against a real Postgres, because a mocked client would happily accept a `number`
where the schema wants `NUMERIC` and prove nothing about the cent that matters. The integration suite skips
itself when the sidecar is unreachable, so `pnpm test` works without Docker.

---

## Roadmap

- **Phase 0 — free public validator.** ✅ Done. Lead generation, and it forced validation
  correctness first.
- **Phase 1 — generate + validate + archive.** ✅ Generation (`BASIC`-profile CII, PDF/A-3 assembly,
  pre-flight checks — [`src/generate`](packages/facturx/src/generate)), self-validation against the
  engine, tenant-scoped persistence, and immutable content-addressed archiving
  ([`apps/api/src/invoicing`](apps/api/src/invoicing), [`archiving`](apps/api/src/archiving)).
  Authentication ([`packages/auth`](packages/auth)) and the invoicing UI
  ([`apps/web/src/app/(app)`](apps/web/src/app)) close the phase: issuance is now behind a session
  guard that resolves the acting tenant from a session row, never from the request.
- **Phase 2 — platform connection.** 🚧 Reception is built
  ([`reception.service.ts`](apps/api/src/invoicing/reception.service.ts)): a supplier invoice is
  analysed, routed to the right client business by its buyer identifiers, recorded and sealed.
  Still to build: transmission and lifecycle statuses behind `PdpProvider`, queue-based and
  idempotent, and a transport other than manual upload.
- **Phase 3 — accountant multi-client dashboard.** The monetisation unlock.
- **Phase 4 — e-reporting, more platforms, embeddable API.**

### Decisions taken

| Decision                | Choice                                              |
| ----------------------- | --------------------------------------------------- |
| Validation engine       | Mustangproject Java sidecar                         |
| Interface language      | French first; i18n structure in place               |
| Default emitted profile | `BASIC` output, richer data retained internally     |
| Scaffold                | Full monorepo, Phase 0 implemented                  |
| Authentication          | Self-hosted: scrypt passwords, sessions in Postgres |

### Still open

Which certified platform to integrate first; hosting region and topology (**must be EU** — French
tax data) and with it the production object store; Stripe price points. Password reset by email is
not built — there is no mail transport yet, so a locked-out user currently needs an operator.

---

## Compliance disclaimer

This software performs a **technical** conformity check against the Factur-X format and the
EN 16931 and French business rules as implemented by the validation engine. It is **not** legal or
tax advice, and **not** a guarantee of acceptance by a certified platform. Final regulatory
responsibility rests with the issuing business and its _plateforme agréée_.

Details that evolve — the mandatory lifecycle-status set, exact required fields, the archiving
duration, and the approved-platform list — **must be confirmed against DGFiP and FNFE-MPE before
go-live**. Verified current as of 31 July 2026: the 1 September 2026 receive obligation, the
1 September 2027 SME issue obligation, and the 5-corner model.
