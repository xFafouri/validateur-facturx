# PROJECT BRIEF — Factur-X e-Invoicing Compliance Platform

### A "Solution Compatible" for France's 2026–2027 B2B e-invoicing mandate, aimed at the underserved long tail (micro-SMEs, accountants, niche software)

---

## 0. How to use this brief (read first, agent)

You are the engineering agent bootstrapping this project. Before writing code:

1. **Read the whole brief.** The regulatory domain (§3) is load-bearing — getting it wrong produces invoices that fail validation and are legally non-compliant. Do not improvise compliance mechanics from general knowledge; use §3 and verify anything uncertain against the official sources in §16.
2. **Confirm the open decisions in §14** with me before scaffolding (which PA to integrate first, hosting region, profile, billing provider). Ask me these as concrete questions.
3. **Propose the repo scaffold** (monorepo layout, packages, tooling) and wait for a go before generating the full skeleton.
4. Then build **Phase 0 first** (§8) — the free public validator — because it doubles as lead-generation and forces us to get CII/Schematron validation right, which is the hardest correctness problem and the foundation for everything else.

The stack in §9 is a recommendation with rationale. If you have a strong reason to deviate, raise it — but the domain fit reasoning is deliberate.

---

## 1. One-liner

Compliance software that lets small French businesses and their accountants **generate, validate, send, receive, track and archive** legally-compliant structured e-invoices for the 2026/2027 mandate — without buying an enterprise platform built for large firms.

## 2. Why this exists (the opportunity in one paragraph)

From **1 September 2026**, French B2B invoices must be structured electronic invoices exchanged through certified platforms; plain PDF and paper become invalid for B2B. Large and mid-size firms must issue from that date, **every** VAT-registered business must be able to _receive_ from that date, and **SMEs/micro-businesses must issue from 1 September 2027**. This is forced, dated, nationwide demand. The big certified platforms (Pennylane, Sage, Esker, Cegid, and ~106 approved platforms as of early 2026) target medium/large firms and full-service accounting suites. The **long tail is underserved**: the corner shop, the freelancer, the accountant ("cabinet comptable") juggling dozens of tiny clients, and vertical business software that has no native e-invoicing. Also, English-language and _receiver-side_ tooling is notably thin. That gap is the target.

## 3. Regulatory & domain primer (the facts that must be correct)

> These are the mechanics the product must implement correctly. Terminology and specs evolve; verify against the DGFiP _Spécifications Externes_, FNFE-MPE, and the official Factur-X spec (§16) before locking implementation details.

### 3.1 Who is in scope, and when

- Applies to **VAT-registered businesses established in France** transacting B2B domestically.
- **1 Sept 2026:** all businesses must be able to **receive** e-invoices; **large + mid-size** firms must begin **issuing**. e-reporting begins on the same phased calendar.
- **1 Sept 2027:** **SMEs (PME) and micro-businesses (TPE)** must begin **issuing**.
- A **scanned PDF or an emailed PDF does not count** — only structured formats via a certified platform.

### 3.2 The 5-corner model (topology)

France moved from a "Y-model" to a **5-corner model** in 2024. The participants:

- **SC — Solution Compatible:** in-house or third-party software (ERP, billing, accounting) that _creates_ invoices and connects to a PA. **It cannot connect directly to the PPF.** → **This product is an SC. We are NOT building a PA.** (See §4.)
- **PA — Plateforme Agréée** (formerly **PDP** — _Plateforme de Dématérialisation Partenaire_; renamed by DGFiP, reaffirmed in the Loi de Finances 2026): private platforms **certified by the DGFiP** that issue, receive, validate, transmit, and report invoices. **Every in-scope business must appoint at least one PA.** ~106 were approved by early 2026.
- **PPF — Portail Public de Facturation:** the government portal, now **scaled back to two roles**: (1) maintain the **Annuaire** (central directory of businesses by SIREN/SIRET + their active e-invoicing addresses/PAs, run by AIFE) used to route invoices; (2) act as **data concentrator** for the DGFiP and handle e-reporting. **The PPF no longer does B2B invoice exchange** — that is exclusively the PAs.

### 3.3 How an invoice flows (the numbered "flows")

Supplier's software (SC) → **PA-e** (sender's platform): validates format + regulatory checks → uses the **Annuaire** to find the buyer's **PA-r** → routes the structured invoice to PA-r (**Flow F2**) → PA-r validates and delivers to the buyer. In parallel, PA-e sends a **regulatory data subset to the PPF (Flow F1)**. Both platforms push **lifecycle statuses to the PPF (Flow F6)**. e-reporting travels on **F10** (with F8/F9 variants); directory flows are F13/F14. Numbering is non-contiguous because flows were consolidated when the model moved from Y-shape to 5-corner.

- **Default transport between PAs is PEPPOL eDelivery**, unless both PAs agree otherwise. Interoperability between PAs is mandatory.

### 3.4 Accepted formats

Three structured formats are accepted: **Factur-X**, **UBL**, and **CII**. UBL and pure CII are used more by large/international senders and PEPPOL flows. **Factur-X is the right default for the TPE/PME target** because it is hybrid and human-readable.

**Factur-X internals (implement precisely):**

- A **PDF/A-3** container with an **embedded XML attachment named exactly `factur-x.xml`**.
- The XML uses the **UN/CEFACT Cross Industry Invoice (CII)** syntax, base **D22B** (migrated from D16B; backward compatible). It conforms to the European semantic standard **EN 16931**.
- Factur-X is **technically identical to Germany's ZUGFeRD 2.x** — a valid file for one is valid for the other.
- **Five profiles**, increasing data richness: `MINIMUM`, `BASIC_WL`, `BASIC`, `EN_16931` (a.k.a. Comfort), `EXTENDED`. There is also a French **CIUS-FR / EXTENDED-based** extension for reform specifics.
  - **Recommendation: default to `BASIC` or `EN_16931`.** `MINIMUM` omits VAT line detail → **not valid for VAT-registered businesses**. `BASIC_WL` (without a visible/detailed PDF layer) is for fully-automated flows, not invoices sent to a TPE client.
  - The profile is declared in the XML at `GuidelineSpecifiedDocumentContextParameter/ID`. Example guideline URNs:
    - `MINIMUM` → `urn:factur-x.eu:1p0:minimum`
    - `BASIC_WL` → `urn:factur-x.eu:1p0:basicwl`
    - `BASIC` → `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic`
    - `EN 16931` → `urn:cen.eu:en16931:2017`
    - `EXTENDED` → `urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended`
  - Pitfall: if you declare `EN 16931` but omit fields that profile requires, validators reject. A common approach is to output `BASIC` (passes broadly) while retaining more data internally.

### 3.5 Validation

Validation has two layers:

- **XSD schema** validation (structure) — one XSD set per profile.
- **Schematron / business-rule** validation — EN 16931 defines **~140 business rules** (`BR-01`…`BR-CO-23`), plus CII structural rules (`CII-SR-*`), code-list rules (`BR-CL-*`), and French rules where applicable.
- Business terms are identified as `BT-*` (e.g. `BT-5` = currency code, `BT-106` = sum of line net amounts, `BT-131` = line net amount).
- **The #1 real-world error:** the invoice total HT (`BT-106`) must exactly equal the sum of line net amounts (`BT-131`). Rounding/summation correctness is critical.

### 3.6 Invoice lifecycle statuses

A structured lifecycle is a core innovation of the reform, and **statuses impact VAT reporting**. Two families:

- **Transmission statuses:** e.g. _Deposited (Déposée)_, _Received (Reçue)_, _Rejected (Rejetée)_.
- **Business processing statuses:** e.g. _Refused (Refusée)_, _In dispute (En litige)_, _Approved_, _Payment_ statuses, etc.
  Some are mandatory, some recommended — **confirm the mandatory set against DGFiP specs**. The product must be able to send, receive, store, and display these.

### 3.7 e-reporting (separate from e-invoicing)

Beyond B2B e-invoicing, businesses must **e-report** transaction data for **B2C sales and international/cross-border transactions** to the tax authority, on the same phased calendar. Treat this as a distinct module (later phase).

### 3.8 Master data & archiving

- **Clean, validated SIREN/SIRET master data is the critical path** — bad identifiers cause routing failures and rejections. The product should validate SIREN/SIRET (and ideally look them up / verify against the Annuaire) on entry.
- **Archiving obligation:** invoices must be archived for a legally-defined retention period with integrity guarantees (commonly cited as up to **10 years**; confirm exact duration and format/integrity requirements against DGFiP). The product must store the exact issued/received artifact immutably.

## 4. Critical scope boundary — SC, not PA

**We are building a Solution Compatible (SC), not a certified PA.** Becoming a PA requires DGFiP accreditation, heavy security/audit obligations, and capital, and ~106 already exist — that is not the wedge. Instead, the product **connects to one (or more) existing certified PA(s)** via API/PEPPOL to actually transmit, receive, and report. Our value is the **UX, the niche fit, and the receiver/accountant workflow** that the big platforms neglect — sitting _upstream_ of a PA. (A future option is to become a PEPPOL Access Point ourselves; out of scope for MVP.)

## 5. Target users (personas)

1. **The micro-business owner (TPE)** — a freelancer, artisan, or small shop that just needs to send compliant invoices and receive/read incoming ones, cheaply, in French, without an accounting degree.
2. **The accountant / cabinet comptable** — manages **many** small clients; needs a **multi-client dashboard** to onboard clients, generate/validate on their behalf, monitor statuses, and archive. **This is the highest-leverage buyer** (one sale = many end-users).
3. **The niche-software vendor** — vertical SaaS (e.g. a booking or field-service tool) with no native e-invoicing; wants an **API/embeddable** to become compliant without building it. (Later phase.)

## 6. MVP scope (must-have)

- Generate a **valid Factur-X** invoice (PDF/A-3 + embedded `factur-x.xml`, profile `BASIC`/`EN_16931`) from structured input.
- **Validate** any Factur-X/CII file (XSD + Schematron, with human-readable error explanations).
- **Receive & parse** an inbound Factur-X (extract structured data; the underserved receiver side).
- **Connect to one certified PA** (sandbox first) to transmit and receive, and **capture lifecycle statuses**.
- **Immutable archiving** of issued/received artifacts.
- **Multi-tenant accounts** (accountant → many client organizations; strict tenant isolation).
- **SIREN/SIRET validation** on party entry.
- Basic **billing** (subscription).

## 7. Explicitly OUT of scope for MVP

Becoming a PA; becoming a PEPPOL Access Point; full e-reporting (B2C/cross-border); a full accounting/ledger suite; payment execution; multi-country mandates (Germany/Italy/etc.) — architect for later, don't build now.

## 8. Phased roadmap

- **Phase 0 — Free public validator (lead-gen + correctness foundation).** A public Next.js page: upload a Factur-X/CII XML (or PDF), get instant XSD + Schematron results with plain-French explanations of each `BR-*`/`BT-*` error. No signup. This ranks for French e-invoicing search terms, builds trust, and forces us to nail validation first. _(2–4 weeks.)_
- **Phase 1 — Generate + validate + archive.** Authenticated app: create invoices → produce valid Factur-X → self-validate → immutable archive. Single-tenant path working end to end. _(3–5 weeks.)_
- **Phase 2 — PA connection (send/receive + lifecycle).** Integrate one PA's sandbox behind a `PdpProvider` abstraction: transmit (F2 via the PA), receive inbound, ingest lifecycle statuses (F6), surface them in the UI. Reliability (retries, idempotency) matters most here. _(4–6 weeks.)_
- **Phase 3 — Accountant multi-client dashboard.** Onboard many client orgs, bulk generate/monitor, per-client archives, roles. The real monetization unlock. _(3–4 weeks.)_
- **Phase 4 — e-reporting, more PAs, embeddable API for vendors, EU expansion.** _(Later.)_

## 9. Recommended stack (with rationale)

This is a **structured-data + integration + reliability** problem (XML/PDF correctness, external platform calls, audit, dashboards), not a UI-novelty problem. The stack is chosen for that, and it maps cleanly onto a modern TypeScript full-stack skill set.

| Layer                    | Choice                                                                                                                                                                                                   | Why                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**             | **TypeScript** everywhere                                                                                                                                                                                | One language across API, workers, web; strong typing suits an invoice/compliance domain with strict schemas.                                                                                                   |
| **Backend API**          | **NestJS**                                                                                                                                                                                               | Modular, DI-first architecture fits bounded contexts (invoicing, validation, PA-integration, archiving, billing); trivial to swap `PdpProvider` implementations; first-class validation, guards, interceptors. |
| **DB**                   | **PostgreSQL**                                                                                                                                                                                           | Relational integrity is essential for invoices ↔ lines ↔ tax ↔ statuses ↔ audit; strong constraints, transactions, JSONB where needed.                                                                         |
| **ORM**                  | **Prisma**                                                                                                                                                                                               | Type-safe schema + migrations; fast iteration; good DX.                                                                                                                                                        |
| **Async jobs / queues**  | **BullMQ + Redis**                                                                                                                                                                                       | PA transmission, status polling, retries, and archiving must be async and reliable with backoff/idempotency. Do **not** do external PA calls inline in the request.                                            |
| **Frontend**             | **Next.js (React) + TypeScript**                                                                                                                                                                         | Dashboard app **and** SSR marketing/validator pages for French SEO (lead-gen). Tailwind + a component lib (shadcn/ui) for speed.                                                                               |
| **Factur-X generation**  | **pdf-lib** (or similar) for PDF/A-3 assembly + attachment; **an XML builder** for CII; ensure PDF/A-3 conformance (XMP metadata, embedded-file relationship `Data`/`Alternative`, `factur-x.xml` name). | Proven Node/TS path exists for PDF/A-3 + CII.                                                                                                                                                                  |
| **XML validation**       | **libxml-based XSD** validation; **Schematron** via a Node XSLT pipeline **or** a small **Java sidecar (Mustangproject)** exposed over HTTP.                                                             | Pure-Node Schematron is doable but a **Mustangproject sidecar is the most battle-tested** for Factur-X validation/generation — consider it for correctness-critical paths. Decide in §14.                      |
| **PA integration**       | Abstract **`PdpProvider`** interface; concrete adapter for the chosen PA's API; **PEPPOL eDelivery** as the transport model to design toward.                                                            | Keeps us portable across PAs and future-proofs a PEPPOL AP option.                                                                                                                                             |
| **Auth / multi-tenancy** | Auth.js or Clerk; **org-scoped, row-level tenant isolation** (accountant → client orgs).                                                                                                                 | Accountant persona demands clean tenancy from day one.                                                                                                                                                         |
| **Payments**             | **Stripe** (never store card data).                                                                                                                                                                      | Standard, EU-ready, handles VAT.                                                                                                                                                                               |
| **Infra**                | **Docker** + **EU-region hosting** (e.g. an EU VPS such as Hetzner, or an EU PaaS); **GitHub Actions** CI/CD; staging + production separation.                                                           | **Data residency in the EU is a compliance/GDPR requirement** — host French tax data in-EU.                                                                                                                    |
| **Observability**        | Structured logging, **Sentry**, and a dedicated **immutable audit-log** table.                                                                                                                           | Compliance needs traceability.                                                                                                                                                                                 |

## 10. High-level architecture

```
[Next.js web]  ──────────────►  [NestJS API]  ──────────────►  [PostgreSQL]  (Prisma)
  - marketing / validator (public)      │  modules:                 (invoices, lines, parties,
  - dashboard (auth, multi-tenant)      │   - invoicing               tax, statuses, archive,
                                        │   - validation              audit, tenants, billing)
                                        │   - pdp-integration
                                        │   - archiving
                                        │   - ereporting (later)
                                        │   - billing (Stripe)
                                        ▼
                                   [BullMQ workers] ──► retries/idempotent jobs:
                                        │                 - transmit invoice to PA
                                        │                 - poll / ingest lifecycle statuses
                                        │                 - validation (heavy)
                                        │                 - archive sealing
                                        ▼
                             [PdpProvider adapter] ──(API / PEPPOL eDelivery)──► [Certified PA]
                                        │                                             │
                          [Validation engine]                                  routes via Annuaire
                          (XSD + Schematron;                                    to buyer's PA-r;
                           Node pipeline or                                     PA-e → PPF (F1),
                           Mustangproject sidecar)                             statuses → PPF (F6)
```

Design principles: PA calls are **always async + idempotent** (retry with backoff, dedupe keys); every state change writes to the **audit log**; the **generated/received artifact is stored immutably** for archiving; `PdpProvider` is the only place that knows PA-specific details.

## 11. Core data model (sketch — refine in Prisma)

- **Tenant / Organization** — the account owner; a cabinet comptable is a tenant that owns many **ClientOrg**s.
- **ClientOrg** — an end business (SIREN/SIRET, VAT number, e-invoicing address/PA). Belongs to a Tenant.
- **User** — belongs to Tenant; roles (owner, accountant, client-user).
- **Party** — seller/buyer identity snapshot (SIREN/SIRET, name, address, VAT) captured per invoice for immutability.
- **Invoice** — header: number, dates, currency, type code, profile used, seller/buyer Party refs, totals (HT/TVA/TTC), status, direction (issued/received), raw artifact ref.
- **InvoiceLine** — line items (`BT-*`): description, qty, unit price, net amount, VAT rate/category.
- **TaxBreakdown** — VAT subtotals per rate (needed for EN 16931 rules).
- **LifecycleStatus** — status code, timestamp, source (our side / PA / PPF), payload.
- **PdpConnection** — per ClientOrg: which PA, credentials/endpoints (encrypted), PEPPOL address.
- **ArchiveEntry** — immutable stored artifact (hash, storage ref, retention-until, integrity metadata).
- **AuditLog** — append-only: who/what/when for every material action.
- **EReport** (later) — B2C/cross-border transaction reporting records.
- **Subscription** — Stripe billing state per Tenant.

## 12. Key technical challenges & how to approach them

1. **Factur-X correctness.** PDF/A-3 conformance is fussy (XMP extension schema, embedded-file relationship, exact `factur-x.xml` filename). CII XML must satisfy the declared profile. **Mitigation:** build/validate against the official XSD + Schematron and the FNFE-MPE example invoices; strongly consider a **Mustangproject sidecar** for generation/validation of correctness-critical output; add a golden-file test suite using official samples.
2. **Summation/rounding rules.** `BT-106 = Σ BT-131`, VAT breakdown consistency. **Mitigation:** compute money with integer minor units or a decimal library; centralize totals logic; test against EN 16931 rules.
3. **PA integration reliability.** External calls fail; statuses arrive asynchronously. **Mitigation:** queue everything, idempotency keys, exponential backoff, dead-letter handling, reconciliation jobs.
4. **PEPPOL / interoperability.** Design the transport abstraction toward PEPPOL eDelivery even while going through a PA. **Mitigation:** keep `PdpProvider` narrow and swappable.
5. **Multi-tenancy & isolation.** Accountant data spans many client orgs. **Mitigation:** row-level tenant scoping enforced at the ORM/query layer + tested authorization guards.
6. **EU data residency & GDPR.** **Mitigation:** host in EU; encrypt secrets and PII at rest; DPA-ready; data-retention/erasure policy that respects the archiving obligation.
7. **Immutable archiving.** **Mitigation:** content-addressed storage (hash), write-once buckets, retention metadata.

## 13. Security, compliance & legal (build these in from day one)

- **EU-only hosting** for tax data; encryption at rest + in transit.
- **No card data** stored — Stripe only.
- **Append-only audit log** for every material action.
- **Immutable archive** meeting the retention obligation.
- **GDPR:** lawful basis, DPA, data-subject rights, minimal PII.
- Validate/verify **SIREN/SIRET** and VAT numbers on input.
- ⚠️ _This product handles legal compliance; ship with a clear disclaimer that final compliance responsibility sits with the certified PA and the business, and verify all specs against DGFiP before go-live._

## 14. Open decisions (ask me before scaffolding)

1. **Which certified PA do we integrate first?** (Pick one with a usable sandbox/API from the official DGFiP approved list.)
2. **Validation engine:** pure-Node Schematron pipeline vs **Mustangproject Java sidecar**? (Recommendation: sidecar for correctness-critical paths.)
3. **Default Factur-X profile:** `BASIC` (broad pass) vs `EN_16931` (richer)? (Recommendation: `BASIC` output, richer data retained internally.)
4. **Hosting region/provider** (EU VPS vs EU PaaS) and staging/prod topology.
5. **Auth provider** (Auth.js self-hosted vs Clerk).
6. **Billing model / price points** (see §15) — affects Stripe setup.
7. **Primary go-to-market persona to optimize the first UI for** (recommendation: **accountant/cabinet comptable** for leverage; TPE self-serve as secondary).

## 15. Business model (for context, so billing is built right)

- **Free:** the public validator (lead-gen, no account).
- **TPE self-serve:** ~€19–39/mo — issue + receive + archive, capped volume.
- **Pro / higher volume:** ~€49–99/mo — higher volume, e-reporting (later), priority.
- **Accountant / cabinet:** per-client seat pricing (e.g. ~€5–12 per managed client/mo) — the main revenue line.
- **Vendor API:** usage-based (later).
  Compliance tools have very low churn once embedded — optimize for landing accountants and for the receiver side that competitors neglect.

## 16. Reference links (verify specs here — treat official sources as authoritative)

**Official / standards**

- FNFE-MPE (Forum National de la Facture Électronique) — Factur-X spec & profiles: https://fnfe-mpe.org/factur-x/ and https://fnfe-mpe.org/factur-x/factur-x_en/
- DGFiP is the authority for the _Spécifications Externes_, the approved-PA list, and mandatory lifecycle statuses (search current DGFiP / impots.gouv.fr e-invoicing pages).
- EN 16931 semantic standard — via AFNOR / ILNAS / EVS.

**Architecture & flows (secondary, well-explained)**

- Fonoa — 5-corner model & flows: https://www.fonoa.com/resources/blog/france-e-invoicing-architecture and https://www.fonoa.com/resources/blog/france-e-invoicing-flow
- EDICOM — PPF/Annuaire roles: https://edicomgroup.com/electronic-invoicing/france
- Sovos docs — PA-E/PA-R flow & lifecycle: https://docs.sovos.com/en/indirect-tax/indirect-tax-products/einvoicing/compliance-network/country-setup-guides/france/about-france
- Banqup — PA/PPF/SC + timeline: https://www.banqup.com/resources/blog/france-s-new-e-invoicing-and-e-reporting-framework
- Dr Dynamics — flow-by-flow (F1/F2/F6/F10…): https://www.drdynamics.co.uk/blog/frances-e-invoicing-mandate-flow-by-flow
- Avalara — readiness overview: https://www.avalara.com/blog/en/europe/2026/07/french-e-invoicing-mandate-readiness.html

**Factur-X technical (implementation)**

- Node.js/TypeScript walkthrough (PDF/A-3 + CII XML, profiles): https://dev.to/erwanbargain/factur-x-en-16931-from-scratch-pdfa-3-cii-xml-in-nodejs-typescript-3pbe
- Profiles / CIUS-FR / receiver-side depth: https://invoicedataextraction.com/blog/factur-x-format-guide
- Technical guide (5 profiles, XSD vs Schematron, common BR-* errors): https://facturevalide.fr/blog/factur-x-guide-technique-complet.html
- **Mustangproject** (Java library for Factur-X/ZUGFeRD generation + validation) — evaluate as a sidecar.

**Timeline / mandate confirmation**

- TrueCommerce: https://www.truecommerce.com/blog/e-invoicing-in-france-a-guide-to-the-french-mandate/
- Bpifrance: https://conseil.bpifrance.fr/publications/facturation-electronique-obligatoire-un-tournant-digital-pour-les-entreprises-francaises

## 17. Suggested first actions for the agent

1. Ask me the §14 questions.
2. Propose a monorepo scaffold (e.g. `apps/web` Next.js, `apps/api` NestJS, `packages/facturx` generation+validation, `packages/db` Prisma, optional `services/validator` Mustang sidecar) and CI setup — wait for approval.
3. Build **Phase 0**: the `packages/facturx` validator core (XSD + Schematron against official samples, with a golden-file test suite) and the public Next.js validator page.
4. Only then proceed to Phase 1.

---

_Accuracy note: dates and the mandate structure are firm (Sept 2026 / Sept 2027, 5-corner model, PA/PPF/SC roles, Factur-X = PDF/A-3 + CII). Details that evolve — the mandatory lifecycle-status set, exact required data fields, archiving duration, and the current approved-PA list — must be confirmed against DGFiP/FNFE-MPE before go-live. Do not treat this brief as legal advice._
