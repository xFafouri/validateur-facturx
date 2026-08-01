import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so that every bounded context can reach the database without each one re-importing it.
 *
 * The tenancy discipline that matters is not "who may hold a client" but "every query carries its
 * tenant predicate" - which is enforced in the services, where the queries are written.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
