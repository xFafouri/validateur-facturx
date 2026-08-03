-- CreateEnum
CREATE TYPE "CredentialTokenPurpose" AS ENUM ('PASSWORD_RESET', 'INVITATION');

-- CreateTable
CREATE TABLE "CredentialToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "CredentialTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialToken_tokenHash_key" ON "CredentialToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CredentialToken_userId_purpose_idx" ON "CredentialToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "CredentialToken_expiresAt_idx" ON "CredentialToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
