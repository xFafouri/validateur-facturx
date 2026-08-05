# Factur-X e-Invoicing Compliance Platform

A _Solution Compatible_ (SC) for France's 2026–2027 B2B e-invoicing mandate, aimed at the
underserved long tail: micro-businesses, accountants managing many small clients, and niche
software with no native e-invoicing.

**Status: Phases 0 and 1 complete; Phase 2 connected end to end against a sandbox platform.** The
free public validator runs, backed by a real Schematron engine, with every rule explained in
French. Invoices are _generated_ — PDF/A-3 with embedded `factur-x.xml` — self-validated against
that same engine, persisted, and sealed into an immutable content-addressed archive. A signed-in
user can add the businesses they invoice for, issue an invoice through the UI, **receive supplier
invoices**, and download the sealed documents. Issued invoices are now **queued, transmitted to a
certified platform and tracked through their lifecycle statuses**, and invoices addressed to a
client arrive by polling as well as by upload. Connecting a business to its platform and following
an invoice's status timeline are both done from the UI. See [Roadmap](#roadmap).

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
pnpm verify   # build + format check + typecheck + 383 tests
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
| `apps/api`           | NestJS. Validation, invoicing, archiving and platform transmission implemented; billing is a skeleton.        |
| `packages/facturx`   | Core: CII parsing/serialising, PDF/A-3 extraction and assembly, validation, French rule catalogue. **Built.** |
| `packages/auth`      | Password hashing and server-side sessions, shared by the web app and the API. **Built.**                      |
| `packages/mail`      | Outbound transactional mail: a transport port with SMTP, console and in-memory drivers. **Built.**            |
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

Password reset and emailed invitations are built on top of this, once there was a mail transport to
carry them — see [Mail](#mail) and [The links](#the-links).

---

## Roles and access

Three roles were modelled from the start and enforced nowhere, which meant every signed-in user of
a tenant could see and do everything. For a product where one cabinet holds several unrelated
businesses' books that is a liability rather than a missing feature: the whole point of
`CLIENT_USER` is a login you can hand to a client without handing them their neighbours' books.

|                          | `OWNER` | `ACCOUNTANT` | `CLIENT_USER`      |
| ------------------------ | ------- | ------------ | ------------------ |
| Read client businesses   | all     | all          | **assigned only**  |
| Add a client business    | ✅      | ✅           | ❌                 |
| Read invoices            | all     | all          | **assigned only**  |
| Issue an invoice         | ✅      | ✅           | ❌                 |
| Receive an invoice       | ✅      | ✅           | ✅ (assigned only) |
| Transmit to the platform | ✅      | ✅           | ❌                 |
| Read delivery status     | ✅      | ✅           | ✅ (assigned only) |
| Connect a platform       | ✅      | ✅           | ❌                 |
| Manage users             | ✅      | ❌           | ❌                 |

`CLIENT_USER` cannot issue because issuing writes into a ten-year legal archive under the cabinet's
numbering sequence, and a restricted login doing that unsupervised is the risk the role exists to
avoid. It _can_ receive, because dropping in a supplier's invoice is exactly the errand you want a
client running for themselves.

Transmission follows issuance rather than reception: putting a document into the official circuit
in a business's name is the same act as issuing it, one step later. Reading delivery status is the
exception granted to everyone — "has my invoice arrived" is a question about the client's own
document, and refusing it just turns into a phone call to the cabinet.

**Permissions and scope are separate mechanisms and both are always required.** A permission check
that passes says the role may issue invoices at all; it says nothing about on whose behalf. Scope
is a predicate on every query — [`scope.ts`](apps/api/src/auth/scope.ts) — never a filter over
results, for the same reason tenant isolation is not. The two failures the tests caught while this
was being built are instructive, and both were _worse_ than having no check:

- returning `{ id: { in: [...] } }` to be spread into a `where` **overwrote the id being looked
  up**, so asking for a business outside scope returned a different business with a 200;
- spreading a caller-supplied `clientOrgId` after the scope predicate let it **overwrite that
  predicate**, which is a privilege escalation in three characters.

Both are now nested under `AND`, which cannot collide with whatever else is in the object.

Scope **fails closed**: a `CLIENT_USER` with no assignment sees nothing, because that is what a
half-finished invitation looks like and "nothing" is the safe reading. Changing anyone's role or
assignment revokes their sessions immediately, so a demoted user cannot keep working from a tab
they left open.

New users are **invited by email** and choose their own password, so it is never known to the
owner, never read out over the phone and never sits in a chat log. Setting one directly is still
possible for a deployment with no relay.

---

## Mail

Password resets and invitations, behind a transport port with three drivers
([`packages/mail`](packages/mail)) — the same shape as `ArtifactStore` and `PdpProvider`, and for
the same reason: production sends through a relay, development must not, and tests must be able to
read what was sent.

Two ways to reach Brevo: **the HTTP API** (`BREVO_API_KEY`) or SMTP. The API wins when both are
set, because outbound SMTP is blocked on most CI runners, many container platforms and plenty of
ISPs while 443 is open everywhere — and because a refused sender comes back as a sentence rather
than a socket timeout. SMTP stays supported for a self-hosted relay.

**With neither set, messages print to the console.** That is the default on purpose: a
developer can complete a password reset by reading the link out of their terminal, with no provider
account, no domain and no DNS. Production sets `SMTP_HOST`; a deployment that wants a missing relay
to be fatal rather than silently printing sets `MAIL_TRANSPORT=unavailable`.

Configured for **Brevo** by default — French, EU-hosted. Not a neutral choice: every address here
belongs to a French accountant or one of their clients, and the relay is the last mile where that
data could leave the EU, which is the same reasoning that made identity self-hosted. Any
RFC-compliant relay works.

Sending needs **a domain you control DNS for**, not a business mailbox. The `From` must be at a
domain carrying your SPF and DKIM records; a Gmail address cannot work, because Gmail's DMARC
policy tells receivers to reject mail claiming to be `@gmail.com` that Google did not send.

```bash
# Check a relay without going through the app. Safe to run: with no SMTP_HOST it prints.
pnpm --filter @facturx/mail send-test vous@exemple.fr
```

**Outbound SMTP is blocked on many networks**, including most CI runners and sandboxes — ports 587
and 465 in particular. That is why the transport sets short, explicit timeouts rather than
nodemailer's two-minute defaults: a password-reset request sits in front of a person waiting for a
page, and a blocked port must fail in seconds with a message naming the host, not hang. A failed
send never changes what the user is told, so it cannot become an enumeration signal either.

Providers also require the sender to be **validated** before they will relay for it. With Brevo
that is either a verified single address or an authenticated domain. Brevo can additionally
restrict API keys to allowlisted IPs — a 401 naming an IP address means that, not a bad key, and
the two need opposite actions. The transport distinguishes them.

### The links

Reset and invitation links are the same primitive as a session: 256 bits of CSPRNG output, stored
only as SHA-256, checked against the database on use. Three properties are specific to them:

- **Issuing a new link invalidates the old one**, so clicking "forgot password" three times does
  not leave three live links in three emails.
- **Consuming is atomic** — `updateMany` with `usedAt: null` in the predicate — so two simultaneous
  submissions cannot both set a password.
- **A weak password does not burn the link**, or a typo would send the user back to their mailbox.

Requesting a reset **reports success unconditionally**, whether the address exists, is disabled or
was never seen. Anything else turns the form into a way of asking which businesses use a given
cabinet. Completing one is the opposite: the caller already holds a secret from their own mailbox,
so failures are named — an expired link says it expired.

A successful reset revokes **every** session for that user, because a reset is what someone does
when they think they are compromised, and leaving the attacker's session alive defeats the point.

Emails load no remote resource — no images, no web fonts, no tracking pixel — so opening one
discloses nothing to us. The password-changed notice deliberately carries **no link at all**: a
"was this you?" message with a button is the shape of a phishing mail.

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
is idempotent on the content hash — **per receiving business**, not per tenant. The distinction
matters because a cabinet often manages both sides of a trade: company A invoices company B, both
are its clients, and the identical PDF is A's issued invoice and B's payable. Deduplicating across
the whole tenant treated the second as a redelivery of the first.

That assumption reached into the archive too, and was wrong there in a worse way. `ArchiveEntry`
was unique on `(tenantId, contentHash)`, so sealing the intercompany invoice for B found A's entry
and returned it: **B's invoice was written with no artifact at all**, its download 404ed, and
receiving it again failed on the invoice-number index instead of deduplicating. An entry is a
record about _one invoice_ — it carries that invoice's retention deadline — so it is now unique per
invoice. The bytes are still stored once; the store is content-addressed, and it is the record, not
the blob, that was being over-deduplicated.

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

## Transmission and lifecycle statuses

Everything platform-specific sits behind
[`PdpProvider`](apps/api/src/pdp/pdp-provider.ts). Nothing above that interface knows which
platform a business uses — businesses switch, an accountant's clients sit on several at once, and
PEPPOL eDelivery should later be one more implementation rather than a rewrite.

### The queue is a Postgres table, not a broker

Redis is in the stack, and the transmission queue deliberately does not use it.

The failure that must never happen is an invoice arriving at the buyer **twice, or not at all**.
Both are fiscal events rather than technical ones: a duplicate is a document the buyer may book and
pay, and a silent drop is a receivable nobody chases. Enqueueing to a broker is a second write that
cannot join the transaction which decided the invoice was ready, so whichever order you pick, one
crash window either loses jobs or duplicates them — and you are left reconciling two stores that
disagree about invoices.

So the [`Transmission`](packages/db/prisma/schema.prisma) row **is** the work item. Enqueueing
commits with the state change that justified it, `idempotencyKey` is a unique constraint rather
than a convention, and workers claim rows with `FOR UPDATE SKIP LOCKED` — the same primitive a
broker would be using underneath. Redis keeps the jobs it is good at, and stays out of the path
where correctness is measured in invoices.

**Idempotency is three layers, each covering what the one before cannot**
([`transmission.service.ts`](apps/api/src/pdp/transmission.service.ts)):

1. **Enqueue** derives its key from the sealed content hash, so a double enqueue is refused by the
   database rather than caught by a read two callers could both pass.
2. **Claim** takes a lease, so two workers cannot run one row at once — and a lease left by a killed
   worker goes stale and is reclaimed, rather than stranding the invoice as pending forever.
3. **The platform** is told the key, which is the only thing that helps with the genuinely
   ambiguous failure: the request arrived and the response did not.

Issuance never calls into this module. It leaves an invoice in `VALIDATED`, and the sweep queues
exactly those — **the invoice's own state is the outbox**. That keeps the module dependency
pointing one way (inbound polling needs `ReceptionService`, so the arrow has to), and it means an
invoice queued by a request that then died still gets sent.

### Statuses

Platforms express lifecycle statuses differently and the DGFiP numbering has already moved once, so
[`lifecycle.ts`](apps/api/src/pdp/lifecycle.ts) defines **our** vocabulary and each adapter
translates onto it. The platform's original message is kept verbatim in `LifecycleStatus.payload`,
so nothing the mapping discards is lost.

Statuses do not arrive in order — platforms batch and retry them — so invoice state is a function of
the **furthest point reached**, not the most recently received message. Without that ranking a late
`DEPOSEE` would walk a delivered invoice backwards on the user's screen. The history stays
complete either way: every status is appended, including the late one; only the summary state is
monotonic.

### Polling, not webhooks

A missed webhook is silent, and both flows here fail dangerously when they fail silently: a missed
status leaves an invoice showing as sent when the buyer has refused it, and a missed inbound invoice
is a payable nobody knows about. Polling's error is bounded by one interval. Webhooks, where a
platform offers them, should trigger an early poll rather than replace one.

Cursors **lag on purpose**. Each is advanced only as far as the last item actually written, so a
crash mid-batch re-reads rather than skips. Re-reading costs nothing — statuses deduplicate on a
unique constraint, inbound invoices on their content hash — and skipping loses a payable.

**The webhook endpoint is built on exactly that principle.**
[`pdp-webhook.controller.ts`](apps/api/src/pdp/pdp-webhook.controller.ts) is the one route in the
application a stranger is expected to call, and it **reads nothing from the body**. A webhook says
only _poll sooner_; the poll then reads the truth from the platform's own API over an authenticated
channel. That caps what a forged call can achieve at "made us do work we were going to do anyway",
where trusting the payload would have turned the same forgery into a fabricated payment status on a
real invoice. Dropping every webhook on the floor would leave the system slower and still correct.

Three further properties follow from it being unguarded:

- **It authenticates on a token it can only recognise, never read** — 256 bits of CSPRNG output
  stored as SHA-256, the same primitive as a session. This is the mirror image of the platform
  credentials below: those are the platform's and must be replayable, so they are encrypted; this
  one is ours, so it is hashed and shown exactly once when minted.
- **It answers before it works.** Platforms time webhooks out and retry, and a retry storm is the
  last thing a slow poll needs, so the poll is fired and not awaited.
- **It is debounced.** A public endpoint that triggers outbound work is otherwise an amplifier, and
  platforms legitimately fan out — ten statuses on one invoice can be ten calls in a second. One
  poll covers them all, because the poll reads everything outstanding since the cursor rather than
  whatever the notification named.

### Credentials

`PdpConnection` holds the secret that lets us submit invoices in a business's name, so it is
encrypted with AES-256-GCM before it reaches the database
([`credentials.ts`](apps/api/src/pdp/credentials.ts)), keyed from `PDP_CREDENTIALS_KEY` and never
from the database — which is what makes a stolen backup useless on its own. There is no default and
no generated fallback: without the key, saving a credential is refused rather than stored in clear.
**Credentials go in and never come out** — no route returns them, decrypted or otherwise.

The envelope carries a version byte, so moving to KMS-wrapped data keys once the hosting region is
decided is a new version that reads the old one, not an irreversible migration.

### The screens

Two, and the split between them is the one that matters:
[`/raccordements`](<apps/web/src/app/(app)/raccordements>) is what a business controls, and the
transmission section of [`/factures/[id]`](<apps/web/src/app/(app)/factures/[id]/page.tsx>) is what
the platform reports back.

The connection screen shows, per business, which platform it is raccordée to, whether a credential
is stored, and the verdict of the last check. It never shows a credential — the API has no route
that would return one, which is what makes encrypting them at rest worth anything. "Jamais vérifié"
is styled as a warning rather than as neutral text, because it is also the state a connection falls
back to when its credentials are edited, and an unverified connection's first visible symptom would
otherwise be an invoice that never leaves.

Which boxes to draw comes from the adapter: `PdpProvider.credentialFields` declares the secrets its
platform asks for, since only the adapter knows whether that is an API key, an OAuth pair or a
certificate passphrase. An **empty** declaration means the platform needs none, and the screen says
so instead of showing an empty form; an **omitted** one falls back to a free-form `CLE=valeur` box
([`secrets.ts`](apps/web/src/lib/secrets.ts)), so an adapter that has not declared its fields is
still configurable. That box refuses a malformed line rather than skipping it — a silently dropped
credential surfaces days later as an authentication error nobody connects back to the typo.

The invoice timeline is append-only and shown in full, superseded entries included, with the source
of each entry labelled: an event we recorded about ourselves and one the platform asserted are not
worth the same in a dispute. A parked transmission offers a retry, which re-uses the original
`idempotencyKey` so the platform recognises a resend rather than a second invoice.

### What Phase 2 changed in the schema

- **`LifecycleStatus` gained a unique `(invoiceId, code, occurredAt)`.** It is what makes a lagging
  cursor safe, and deduplicating in the database means two concurrent pollers cannot both check,
  both find nothing, and both insert.
- **`Transmission` became a queue** — `nextAttemptAt` for backoff, `claimedAt`/`claimedBy` for the
  lease — with `CHECK` constraints that a lease is whole, and that a `SENT` row carries the
  evidence (`externalId`, `sentAt`) it exists to provide.
- **One active platform per business**, as a partial unique index. Two active connections would give
  "where does this invoice go" two answers; switching platforms deactivates the old one rather than
  deleting it, because its transmissions are evidence.

---

## Working across many clients

The screens were built for a tenant with three client businesses. An accountant has two hundred,
and at that size almost every one of them answered the wrong question.

`/tableau-de-bord` counted three totals and listed five invoices. Worse, its "des factures reçues ne
sont pas conformes" warning was computed **over those five** — a sample presented as a fact, so a
tenant with a sixth non-conforming invoice was told everything was fine. `/factures` offered one
filter pill per business, which at two hundred is not a filter but a second list to search. And
`/clients` was a grid of identical cards, so finding the broken one was a reading exercise.

[`GET /client-orgs/overview`](apps/api/src/invoicing/client-orgs.controller.ts) replaces the
guesswork with **six aggregates, whatever the client count** — counted in the database rather than
by looping the businesses, because the loop is the version that works against three rows in
development and falls over in front of the customer the feature exists for.

The scoping subtlety is worth stating, because it is not where you would look for it. Every
aggregate carries the tenant and scope predicates, but that is defence in depth; what actually keeps
the endpoint safe is that the **scoped business list is the only list**. Counts are read out of maps
keyed by an id from it, and the totals are summed from the merged rows rather than from the raw
`groupBy` results — so a count belonging to a business out of scope is never read, even if a
predicate later goes missing. Confirmed by mutation: removing the scope from one aggregate does not
change any response, while removing it from the business list fails two tests. A total is a
disclosure too — "12 non-conforming invoices" tells a client user about eleven documents they may
not open.

The dashboard now leads with a worklist, and **renders nothing at zero**. A dashboard of green
zeroes trains people to stop reading it, and the one number that matters then arrives in the same
typeface as eight that do not.

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

**383 tests.** The integration suites run against the live engine _and_ a real Postgres, because a
mocked client would happily accept a `number` where the schema wants `NUMERIC` and prove nothing
about the cent that matters — and because the transmission queue's guarantees are the database's:
that a double enqueue is refused by a unique constraint, that `FOR UPDATE SKIP LOCKED` gives two
concurrent workers disjoint rows, and that a replayed send resolves to the original transmission
rather than a second invoice at the buyer. All of them skip themselves when the sidecar or Postgres
is unreachable, so `pnpm test` works without Docker.

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
- **Phase 2 — platform connection.** 🚧 Reception
  ([`reception.service.ts`](apps/api/src/invoicing/reception.service.ts)): a supplier invoice is
  analysed, routed to the right client business by its buyer identifiers, recorded and sealed.
  Transmission and lifecycle statuses now sit behind `PdpProvider`
  ([`apps/api/src/pdp`](apps/api/src/pdp)) — a Postgres-backed queue that is idempotent at three
  layers, exponential backoff with a lease, DGFiP status ingestion that cannot walk an invoice
  backwards, and encrypted per-business credentials. Inbound polling gives reception a second
  doorway, so upload is no longer the only transport. The screens close the loop: a business is
  connected and checked from [`/raccordements`](<apps/web/src/app/(app)/raccordements>), and an
  invoice is queued, retried and followed through its lifecycle statuses from its own page.
  Webhooks close it: a platform can trigger an early poll through an unguarded, payload-ignoring
  endpoint ([`pdp-webhook.controller.ts`](apps/api/src/pdp/pdp-webhook.controller.ts)).
  **Still to build:** an adapter for a real certified platform — the sandbox provider is what the
  pipeline is proven against, and this is the one thing standing between the phase and completion.
- **Phase 3 — accountant multi-client dashboard.** 🚧 The monetisation unlock, and the phase where
  the screens stop being built for one business. `GET /client-orgs/overview`
  ([`client-orgs.controller.ts`](apps/api/src/invoicing/client-orgs.controller.ts)) answers "which
  of my clients needs me today" in a fixed six aggregates, and the dashboard leads with that
  worklist rather than with three totals. **Still to build:** a per-client detail page, bulk
  issue/monitor actions, and per-client archive export.
- **Phase 4 — e-reporting, more platforms, embeddable API.**

### Decisions taken

| Decision                | Choice                                              |
| ----------------------- | --------------------------------------------------- |
| Validation engine       | Mustangproject Java sidecar                         |
| Interface language      | French first; i18n structure in place               |
| Default emitted profile | `BASIC` output, richer data retained internally     |
| Scaffold                | Full monorepo, Phase 0 implemented                  |
| Authentication          | Self-hosted: scrypt passwords, sessions in Postgres |
| Authorisation           | Static role matrix + per-query client-org scope     |
| Transmission queue      | Postgres outbox + `SKIP LOCKED`, not a broker       |
| Platform credentials    | AES-256-GCM at the application layer, key from env  |

### Still open

Which certified platform to integrate first — the pipeline is built and proven against the sandbox
provider, so this is now an adapter and a set of sandbox credentials rather than a design question.
Hosting region and topology (**must be EU** — French tax data) and with it the production object
store, and whether `PDP_CREDENTIALS_KEY` becomes a KMS-wrapped data key once that is decided. Stripe
price points. Mail needs a domain with SPF and DKIM records before it can send anywhere real.

The **exact lifecycle status codes** each platform emits, and which of our vocabulary they map onto,
have to come from that platform's own documentation — see the disclaimer below.

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
