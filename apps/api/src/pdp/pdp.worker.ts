/**
 * The tick that drives the queue and the pollers.
 *
 * Kept as thin as it looks on purpose. Everything it calls is idempotent and safe to run
 * concurrently, so the worker itself needs no locking, no leader election and no state: it is a
 * timer that says "now". That is also what makes moving it out of the API process later a
 * deployment change rather than a rewrite - a separate container running the same two calls.
 *
 * ## Not `setInterval`
 *
 * A drain that takes longer than the interval would have interval ticks stacking up behind it,
 * and the queue would be drained by however many overlapping passes the event loop had
 * accumulated. Each cycle schedules the next one only when the previous has finished, so a slow
 * platform makes the loop slower rather than making it re-entrant.
 *
 * ## Off by default
 *
 * `PDP_WORKER_ENABLED` gates it. Tests drive the services directly and would otherwise race a
 * background timer mutating the rows they are asserting on, and a developer running the API
 * should not be surprised by outbound network calls they did not ask for.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { TransmissionService } from './transmission.service';
import { PdpSyncService } from './pdp-sync.service';

const DEFAULT_QUEUE_INTERVAL_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

@Injectable()
export class PdpWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PdpWorker.name);

  /** Identifies this process in `Transmission.claimedBy`, so a stuck claim can be traced to it. */
  private readonly workerId = `${hostname()}:${process.pid}`;

  private queueTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly transmissions: TransmissionService,
    private readonly sync: PdpSyncService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('PDP_WORKER_ENABLED') !== 'true') {
      this.logger.log(
        'Worker de transmission désactivé (PDP_WORKER_ENABLED n’est pas « true »). Les factures seront mises en file mais pas transmises.',
      );
      return;
    }

    this.logger.log(`Worker de transmission démarré (${this.workerId}).`);
    this.scheduleQueue(0);
    this.schedulePoll(this.pollInterval());
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.queueTimer) clearTimeout(this.queueTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    // Nothing to drain on the way out: an attempt interrupted by a shutdown leaves its claim
    // behind, and the lease expiry hands the row to whoever is running next.
  }

  /** One queue cycle: enqueue what issuance left behind, then send what is due. */
  async runQueueCycle(): Promise<void> {
    const queued = await this.transmissions.enqueuePending();
    const report = await this.transmissions.drain(this.workerId);

    if (queued > 0 || report.claimed > 0) {
      this.logger.log(
        `File : ${queued} mise(s) en file, ${report.claimed} traitée(s), ` +
          `${report.sent} transmise(s), ${report.failed} à réessayer, ${report.parked} abandonnée(s).`,
      );
    }
  }

  private scheduleQueue(delay: number): void {
    if (this.stopping) return;
    this.queueTimer = setTimeout(() => {
      void this.runQueueCycle()
        // The loop's own errors are logged and swallowed. A worker that dies on a transient
        // database blip stops transmitting invoices, and nothing restarts it until the process is.
        .catch((error: unknown) => this.logger.error(`Cycle de file en échec : ${String(error)}`))
        .finally(() => this.scheduleQueue(this.queueInterval()));
    }, delay);
  }

  private schedulePoll(delay: number): void {
    if (this.stopping) return;
    this.pollTimer = setTimeout(() => {
      void this.sync
        .pollAll()
        .catch((error: unknown) =>
          this.logger.error(`Cycle d'interrogation en échec : ${String(error)}`),
        )
        .finally(() => this.schedulePoll(this.pollInterval()));
    }, delay);
  }

  private queueInterval(): number {
    return this.positiveInt('PDP_QUEUE_INTERVAL_MS', DEFAULT_QUEUE_INTERVAL_MS);
  }

  private pollInterval(): number {
    return this.positiveInt('PDP_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
  }

  /** A misconfigured interval falls back to the default rather than to a busy loop at zero. */
  private positiveInt(key: string, fallback: number): number {
    const parsed = Number(this.config.get<string>(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
