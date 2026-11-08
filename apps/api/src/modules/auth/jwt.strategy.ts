import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtUserPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET ||
        'flowvis-jwt-dev-secret-change-me-in-production-min-32-chars',
    });
  }

  async validate(payload: JwtUserPayload): Promise<JwtUserPayload> {
    if (!payload || !payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException('Token payload không hợp lệ');
    }
    return payload;
  }
}
