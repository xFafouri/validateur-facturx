import { Controller, Get } from '@nestjs/common';
import { ValidationService } from './validation.service';

@Controller('validation')
export class ValidationController {
  constructor(private readonly validation: ValidationService) {}

  @Get('health')
  async health() {
    const health = await this.validation.health();
    return { engine: health.ok ? 'disponible' : 'indisponible', detail: health.detail ?? null };
  }
}
