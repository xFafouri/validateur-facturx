import { Global, Module } from '@nestjs/common';
import { SessionGuard } from './session.guard';

/**
 * Global, because every bounded context that is not the public validator needs the guard, and
 * making each one re-provide it invites one of them to quietly forget.
 *
 * There is no sign-in route here. Issuing and clearing session cookies is the web app's job -
 * it owns the browser relationship, the redirects and the French error copy. The API's entire
 * interest in authentication is reading a session that already exists.
 */
@Global()
@Module({
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule {}
