-- DropIndex
DROP INDEX "ArchiveEntry_tenantId_contentHash_key";

-- CreateIndex
CREATE INDEX "ArchiveEntry_tenantId_contentHash_idx" ON "ArchiveEntry"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveEntry_tenantId_invoiceId_contentHash_key" ON "ArchiveEntry"("tenantId", "invoiceId", "contentHash");

