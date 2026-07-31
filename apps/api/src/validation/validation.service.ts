import { Injectable, Logger } from '@nestjs/common';
import { MustangEngine, analyze, toAnalysisDto, type AnalysisDto } from '@facturx/core';

/**
 * Wraps `@facturx/core` for the API.
 *
 * The parsing, rule catalogue and arithmetic checks live in the shared package rather than here,
 * so this service and the Next.js route handler cannot drift into giving different verdicts for
 * the same file.
 */
@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);
  private readonly engine = new MustangEngine({
    baseUrl: process.env.VALIDATOR_URL ?? 'http://127.0.0.1:8081',
  });

  async validate(bytes: Uint8Array, filename: string): Promise<AnalysisDto> {
    const result = await analyze(bytes, filename, { engine: this.engine });
    this.logger.log(`Validated ${filename}: ${result.verdict} (${result.counts.errors} erreurs)`);
    return toAnalysisDto(result);
  }

  health(): Promise<{ ok: boolean; detail?: string }> {
    return this.engine.health();
  }
}
