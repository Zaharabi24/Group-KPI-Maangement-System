import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';

/**
 * Data-scope resolution (§5.3) is needed by nearly every domain module, so it is
 * provided once from a global module rather than imported everywhere.
 */
@Global()
@Module({
  providers: [ScopeService],
  exports: [ScopeService],
})
export class ScopeModule {}
