import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisService } from '../../infra/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { AccountLockedGuard } from './guards/account-locked.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { AuthThrottlerGuard, ShareThrottlerGuard, getAuthThrottleOptions } from './throttler.guard.js';

@Module({
  imports: [
    WalletModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [getAuthThrottleOptions()],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret:
          process.env.JWT_SECRET ||
          'motion-ai-jwt-dev-secret-change-me-in-production-min-32-chars',
        signOptions: {
          expiresIn: 900, // 15 phút (900 giây)
        },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    GoogleOAuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AccountLockedGuard,
    AuthThrottlerGuard,
    ShareThrottlerGuard,
  ],
  exports: [
    AuthService,
    GoogleOAuthService,
    JwtAuthGuard,
    RolesGuard,
    AccountLockedGuard,
    JwtModule,
    AuthThrottlerGuard,
    ShareThrottlerGuard,
  ],
})
export class AuthModule {}
