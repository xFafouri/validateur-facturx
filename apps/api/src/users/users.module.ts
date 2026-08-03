import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';

/**
 * User and access management.
 *
 * Its own module rather than a corner of invoicing: who may see a tenant's books is a different
 * concern from what those books contain, and the two have no reason to share a service.
 */
@Module({
  controllers: [UsersController],
})
export class UsersModule {}
