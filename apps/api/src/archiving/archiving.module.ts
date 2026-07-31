import { Module } from '@nestjs/common';

/**
 * Phase 1/2: immutable archiving.
 *
 * Content-addressed by SHA-256 into write-once storage. The stored bytes must be the exact
 * artifact issued or received - never a re-serialisation, which would break the hash and with it
 * the integrity guarantee the archive exists to provide.
 */
@Module({})
export class ArchivingModule {}
