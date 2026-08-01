# Factur-X e-Invoicing Compliance Platform

A _Solution Compatible_ (SC) for France's 2026–2027 B2B e-invoicing mandate, aimed at the
underserved long tail: micro-businesses, accountants managing many small clients, and niche
software with no native e-invoicing.

**Status: Phase 0 complete; Phase 1 complete except for authentication and a UI.** The free public
validator runs, backed by a real Schematron engine, with every rule explained in French. Invoices
are also _generated_ — PDF/A-3 with embedded `factur-x.xml` — self-validated against that same
engine, persisted, and sealed into an immutable content-addressed archive. What is missing is the
way in: there is no authentication layer and no invoicing UI, so issuance is reachable from code and
tests only. See [Roadmap](#roadmap).

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
| `apps/web`           | Next.js. Public French validator + SEO landing page. **Phase 0 — built.**                                     |
| `apps/api`           | NestJS. Validation, invoicing and archiving implemented; PDP and billing are skeletons.                       |
| `packages/facturx`   | Core: CII parsing/serialising, PDF/A-3 extraction and assembly, validation, French rule catalogue. **Built.** |
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
  **Still to build: authentication and the invoicing UI.** Issuance is deliberately left without an
  HTTP route until there is an auth layer to scope it by — an unauthenticated endpoint that writes
  into a tenant's archive is the wrong seam to leave open.
- **Phase 2 — platform connection.** Transmit, receive, ingest lifecycle statuses behind
  `PdpProvider`. Queue-based, idempotent.
- **Phase 3 — accountant multi-client dashboard.** The monetisation unlock.
- **Phase 4 — e-reporting, more platforms, embeddable API.**

### Decisions taken

| Decision                | Choice                                          |
| ----------------------- | ----------------------------------------------- |
| Validation engine       | Mustangproject Java sidecar                     |
| Interface language      | French first; i18n structure in place           |
| Default emitted profile | `BASIC` output, richer data retained internally |
| Scaffold                | Full monorepo, Phase 0 implemented              |

### Still open

Which certified platform to integrate first; hosting region and topology (**must be EU** — French
tax data) and with it the production object store; auth provider; Stripe price points.

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
