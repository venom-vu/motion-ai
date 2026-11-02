import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { AccountLockedGuard } from './guards/account-locked.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
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
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleOAuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AccountLockedGuard,
  ],
  exports: [
    AuthService,
    GoogleOAuthService,
    JwtAuthGuard,
    RolesGuard,
    AccountLockedGuard,
    JwtModule,
  ],
})
export class AuthModule {}
