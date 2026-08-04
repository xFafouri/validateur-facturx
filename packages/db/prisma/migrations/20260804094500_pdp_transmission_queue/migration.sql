-- AlterTable
ALTER TABLE "PdpConnection" ADD COLUMN     "inboundCursor" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "statusCursor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transmission" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleStatus_invoiceId_code_occurredAt_key" ON "LifecycleStatus"("invoiceId", "code", "occurredAt");

-- CreateIndex
CREATE INDEX "PdpConnection_active_idx" ON "PdpConnection"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PdpConnection_clientOrgId_provider_key" ON "PdpConnection"("clientOrgId", "provider");

-- CreateIndex
CREATE INDEX "Transmission_state_nextAttemptAt_idx" ON "Transmission"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Transmission_externalId_idx" ON "Transmission"("externalId");


-- ---------------------------------------------------------------------------
-- Hand-written below this line. These are invariants of a queue that must hold
-- in the database, because the failure mode they prevent is an invoice
-- delivered twice or not at all, and neither is visible until a client says so.
-- ---------------------------------------------------------------------------

-- Exactly one platform per business may be sending at a time.
--
-- The `(clientOrgId, provider)` unique above stops two rows for the same adapter, but still
-- allows a business to be active on two platforms at once, and then "where does this invoice
-- go" has two answers. During a migration between platforms the outgoing one is deactivated,
-- not deleted: its transmissions and their history stay attached to it.
CREATE UNIQUE INDEX "PdpConnection_one_active_per_client_org"
  ON "PdpConnection" ("clientOrgId")
  WHERE "active";

-- A lease is both columns or neither. Half a lease is a row that either cannot be reclaimed or
-- cannot be attributed, and the reclaim query would treat the two cases differently.
ALTER TABLE "Transmission" ADD CONSTRAINT "Transmission_claim_is_whole"
  CHECK (("claimedAt" IS NULL) = ("claimedBy" IS NULL));

-- Once a platform has accepted an invoice we must be able to say when, and under which
-- identifier. That evidence is the entire value of the row when a client disputes delivery, and
-- a code path that advanced the state without recording it would leave nothing to show.
ALTER TABLE "Transmission" ADD CONSTRAINT "Transmission_sent_is_evidenced"
  CHECK (
    "state" NOT IN ('SENT', 'ACKNOWLEDGED') OR
    ("externalId" IS NOT NULL AND "sentAt" IS NOT NULL)
  );
