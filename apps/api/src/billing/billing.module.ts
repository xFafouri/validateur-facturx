import { Module } from '@nestjs/common';

/** Phase 1+: Stripe subscriptions. No card data is ever stored or proxied by this service. */
@Module({})
export class BillingModule {}
