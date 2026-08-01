import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ARTIFACT_STORE } from './artifact-store';
import { ArchivingService } from './archiving.service';
import { FilesystemArtifactStore } from './stores/filesystem.store';

/**
 * Phase 1/2: immutable archiving.
 *
 * Content-addressed by SHA-256 into write-once storage. The stored bytes must be the exact
 * artifact issued or received - never a re-serialisation, which would break the hash and with it
 * the integrity guarantee the archive exists to provide.
 *
 * The store is bound through a token so the driver stays a deployment decision. The filesystem
 * driver is for development; production must use EU object storage with versioning and object-lock,
 * which depends on a hosting decision still open (see the README).
 */
@Module({
  providers: [
    ArchivingService,
    {
      provide: ARTIFACT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new FilesystemArtifactStore(config.get<string>('ARCHIVE_DIR') ?? './.archive'),
    },
  ],
  exports: [ArchivingService, ARTIFACT_STORE],
})
export class ArchivingModule {}
