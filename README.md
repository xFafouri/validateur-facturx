# Factur-X e-Invoicing Compliance Platform

A _Solution Compatible_ (SC) for France's 2026–2027 B2B e-invoicing mandate, aimed at the
underserved long tail: micro-businesses, accountants managing many small clients, and niche
software with no native e-invoicing.

**Status: Phase 0 complete and working end to end.** The free public validator runs, backed by a
real Schematron engine, with every rule explained in French. Later phases are scaffolded but not
implemented — see [Roadmap](#roadmap).

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
pnpm verify   # build + format check + typecheck + 107 tests
```

---

## Layout

| Path                 | What it is                                                                           |
| -------------------- | ------------------------------------------------------------------------------------ |
| `apps/web`           | Next.js. Public French validator + SEO landing page. **Phase 0 — built.**            |
| `apps/api`           | NestJS. Module skeleton; only validation is implemented.                             |
| `packages/facturx`   | Core: CII parsing, PDF/A-3 extraction, validation, French rule catalogue. **Built.** |
| `packages/db`        | Prisma schema for the full data model. Modelled, not migrated.                       |
| `services/validator` | Java sidecar wrapping Mustangproject. **Built.**                                     |

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

**107 tests**, including 9 integration tests against the live engine. The integration suite skips
itself when the sidecar is unreachable, so `pnpm test` works without Docker.

---

## Roadmap

- **Phase 0 — free public validator.** ✅ Done. Lead generation, and it forced validation
  correctness first.
- **Phase 1 — generate + validate + archive.** Factur-X generation (PDF/A-3 + `factur-x.xml`,
  `BASIC` profile), immutable archiving. Prisma schema is modelled for it.
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
tax data); auth provider; Stripe price points.

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
