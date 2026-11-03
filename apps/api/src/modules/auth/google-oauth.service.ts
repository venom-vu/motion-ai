import { Injectable, Logger } from '@nestjs/common';

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
}

export type HttpFetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private fetchImpl: HttpFetchFn = globalThis.fetch;

  /**
   * Thiết lập hàm fetch tùy chỉnh cho mục đích kiểm thử (mock tại ranh giới HTTP).
   */
  setFetchImpl(customFetch: HttpFetchFn): void {
    this.fetchImpl = customFetch;
  }

  private assertConfigured(): void {
    if (
      process.env.NODE_ENV === 'production' &&
      (!process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET ||
        !process.env.GOOGLE_CALLBACK_URL)
    ) {
      throw new Error(
        'Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL',
      );
    }
  }

  /**
   * Cho phép ghi đè endpoint Google bằng env (chỉ để giả Google trong smoke test);
   * ở production luôn dùng URL Google thật.
   */
  private resolveEndpoint(envName: string, defaultUrl: string): string {
    if (process.env.NODE_ENV === 'production') return defaultUrl;
    return process.env[envName]?.trim() || defaultUrl;
  }

  getAuthorizationUrl(state: string): string {
    this.assertConfigured();
    const clientId = process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id';
    const callbackUrl =
      process.env.GOOGLE_CALLBACK_URL ||
      'http://localhost:3001/auth/google/callback';

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeAndGetProfile(code: string): Promise<GoogleUserProfile> {
    this.assertConfigured();
    const clientId = process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id';
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret';
    const callbackUrl =
      process.env.GOOGLE_CALLBACK_URL ||
      'http://localhost:3001/auth/google/callback';

    // 1. Trao đổi authorization code lấy access_token
    const tokenUrl = this.resolveEndpoint(
      'GOOGLE_TOKEN_URL',
      'https://oauth2.googleapis.com/token',
    );
    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenRes = await this.fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      this.logger.error(
        `Google token exchange failed (${tokenRes.status}): ${errText}`,
      );
      throw new Error(
        `Google token exchange failed with status ${tokenRes.status}`,
      );
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      id_token?: string;
    };

    if (!tokenData.access_token) {
      throw new Error('Google token response did not contain access_token');
    }

    // 2. Lấy thông tin user profile từ userinfo endpoint
    const userinfoUrl = this.resolveEndpoint(
      'GOOGLE_USERINFO_URL',
      'https://www.googleapis.com/oauth2/v3/userinfo',
    );
    const userinfoRes = await this.fetchImpl(userinfoUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!userinfoRes.ok) {
      const errText = await userinfoRes.text().catch(() => '');
      this.logger.error(
        `Google userinfo failed (${userinfoRes.status}): ${errText}`,
      );
      throw new Error(`Google userinfo failed with status ${userinfoRes.status}`);
    }

    const profileData = (await userinfoRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    if (!profileData.sub || !profileData.email) {
      throw new Error('Google user profile is missing sub or email');
    }

    return {
      googleId: profileData.sub,
      email: profileData.email,
      name: profileData.name,
      picture: profileData.picture,
    };
  }
}
