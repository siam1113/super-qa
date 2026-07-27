import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { OAuthService } from './oauth.service';

class InitiateOAuthDto {
  sourceName: string;
  redirectUri?: string;
}

@Controller('sources/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  /**
   * Initiate OAuth flow - returns authorization URL
   */
  @Post(':provider/authorize')
  async initiateOAuth(
    @Param('provider') provider: string,
    @Body() body: InitiateOAuthDto,
  ) {
    const { sourceName, redirectUri } = body;

    if (!sourceName) {
      throw new BadRequestException('sourceName is required');
    }

    const frontendUrl = redirectUri || 'http://localhost:3000/sources';

    const { url, state } = this.oauthService.generateAuthorizationUrl(
      provider,
      sourceName,
      frontendUrl,
    );

    return { authorizationUrl: url, state };
  }

  /**
   * OAuth callback - handles redirect from provider
   */
  @Get(':provider/callback')
  async handleCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    // Default redirect URL in case of errors
    const errorRedirectUrl = 'http://localhost:3000/sources';

    if (error) {
      const errorMsg = encodeURIComponent(errorDescription || error);
      return res.redirect(`${errorRedirectUrl}?error=${errorMsg}`);
    }

    if (!code || !state) {
      return res.redirect(`${errorRedirectUrl}?error=missing_code_or_state`);
    }

    try {
      const { source, redirectUri } = await this.oauthService.handleCallback(
        provider,
        code,
        state,
      );

      // Redirect back to frontend with success
      const successUrl = new URL(redirectUri);
      successUrl.searchParams.set('oauth_success', 'true');
      successUrl.searchParams.set('source_id', source.id);
      successUrl.searchParams.set('source_name', source.name);

      return res.redirect(successUrl.toString());
    } catch (err) {
      const errorMsg = encodeURIComponent(err.message || 'OAuth failed');
      return res.redirect(`${errorRedirectUrl}?error=${errorMsg}`);
    }
  }

  /**
   * Check OAuth configuration status for providers
   */
  @Get('config/status')
  async getOAuthConfigStatus() {
    const providers = ['github', 'jira', 'confluence'];
    const status: Record<string, boolean> = {};

    for (const provider of providers) {
      try {
        // Try to generate a URL - if it fails, OAuth is not configured
        this.oauthService.generateAuthorizationUrl(provider, 'test', 'http://test');
        status[provider] = true;
      } catch {
        status[provider] = false;
      }
    }

    return status;
  }
}
