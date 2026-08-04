/**
 * Turning a stored connection into a usable platform client.
 *
 * Two things happen here and nowhere else: choosing the adapter for a connection's `provider`
 * key, and decrypting that connection's credentials. Both are deliberately confined so that
 * everything downstream - the queue, the pollers, the controller - works in terms of "a provider
 * and the credentials to call it with", and none of them has to know how either was obtained.
 *
 * The decrypted secrets are returned, never cached and never logged. They live as long as the
 * call that needed them.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PdpConnection } from '@prisma/client';
import { PDP_PROVIDERS, type PdpCredentials, type PdpProvider } from './pdp-provider';
import { openCredentials, resolveCredentialsKey, sealCredentials } from './credentials';

/** An adapter paired with the credentials for one particular connection. */
export interface ResolvedConnection {
  readonly connection: PdpConnection;
  readonly provider: PdpProvider;
  readonly credentials: PdpCredentials;
}

export class UnknownProviderError extends Error {
  constructor(key: string) {
    super(
      `Aucun adaptateur n'est enregistré pour la plateforme « ${key} ». La connexion ne peut pas être utilisée.`,
    );
    this.name = 'UnknownProviderError';
  }
}

@Injectable()
export class PdpRegistryService {
  private readonly logger = new Logger(PdpRegistryService.name);

  private readonly byKey: ReadonlyMap<string, PdpProvider>;

  constructor(
    @Inject(PDP_PROVIDERS) providers: readonly PdpProvider[],
    private readonly config: ConfigService,
  ) {
    this.byKey = new Map(providers.map((provider) => [provider.key, provider]));
    this.logger.log(
      `Adaptateurs de plateforme disponibles : ${[...this.byKey.keys()].join(', ') || 'aucun'}.`,
    );
  }

  /** Every registered adapter, for a settings screen offering the choice. */
  list(): readonly { key: string; displayName: string }[] {
    return [...this.byKey.values()].map((provider) => ({
      key: provider.key,
      displayName: provider.displayName,
    }));
  }

  get(key: string): PdpProvider {
    const provider = this.byKey.get(key);
    if (!provider) throw new UnknownProviderError(key);
    return provider;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Encrypts a credential set for storage. */
  seal(secrets: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
    return sealCredentials(secrets, resolveCredentialsKey(this.env()));
  }

  /**
   * Resolves a stored connection into something callable.
   *
   * A connection with no stored secrets resolves with an empty set rather than failing: some
   * platforms authenticate by mutual TLS or by an address alone, and the sandbox needs none at
   * all. What must not happen is a *present* but unreadable secret being treated as absent, so
   * that case throws out of `openCredentials`.
   */
  resolve(connection: PdpConnection): ResolvedConnection {
    const provider = this.get(connection.provider);

    const secrets = connection.credentialsEncrypted
      ? openCredentials(connection.credentialsEncrypted, resolveCredentialsKey(this.env()))
      : {};

    return {
      connection,
      provider,
      credentials: {
        apiBaseUrl: connection.apiBaseUrl ?? '',
        secrets,
      },
    };
  }

  /**
   * The environment as Nest sees it.
   *
   * `ConfigService` is the only component that has read the `.env` files, so reaching for
   * `process.env` here would silently miss a key that was configured in one of them.
   */
  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PDP_CREDENTIALS_KEY:
        this.config.get<string>('PDP_CREDENTIALS_KEY') ?? process.env.PDP_CREDENTIALS_KEY,
    };
  }
}
