import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Source } from './entities/source.entity';
import * as crypto from 'crypto';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  callbackUrl: string;
}

export interface OAuthState {
  sourceId?: string;
  sourceName: string;
  sourceType: string;
  redirectUri: string;
  nonce: string;
}

@Injectable()
export class OAuthService {
  private stateStore: Map<string, OAuthState> = new Map();

  constructor(
    private configService: ConfigService,
    @InjectRepository(Source)
    private sourceRepository: Repository<Source>,
  ) {}

  private getProviderConfig(provider: string): OAuthConfig {
    const baseCallbackUrl = this.configService.get('API_URL') || 'http://localhost:4000';

    switch (provider) {
      case 'github':
        return {
          clientId: this.configService.get('GITHUB_CLIENT_ID') || '',
          clientSecret: this.configService.get('GITHUB_CLIENT_SECRET') || '',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          scopes: ['repo', 'read:org'],
          callbackUrl: `${baseCallbackUrl}/api/sources/oauth/github/callback`,
        };

      case 'jira':
      case 'confluence':
        return {
          clientId: this.configService.get('ATLASSIAN_CLIENT_ID') || '',
          clientSecret: this.configService.get('ATLASSIAN_CLIENT_SECRET') || '',
          authorizationUrl: 'https://auth.atlassian.com/authorize',
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          scopes: provider === 'jira'
            ? ['read:jira-work', 'read:jira-user', 'write:jira-work', 'offline_access']
            : ['read:confluence-content.all', 'read:confluence-space.summary', 'offline_access'],
          callbackUrl: `${baseCallbackUrl}/api/sources/oauth/${provider}/callback`,
        };

      default:
        throw new BadRequestException(`OAuth not supported for provider: ${provider}`);
    }
  }

  generateAuthorizationUrl(
    provider: string,
    sourceName: string,
    redirectUri: string,
  ): { url: string; state: string } {
    const config = this.getProviderConfig(provider);

    if (!config.clientId) {
      throw new BadRequestException(`OAuth not configured for ${provider}. Please set ${provider.toUpperCase()}_CLIENT_ID`);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const state = crypto.randomBytes(32).toString('hex');

    // Store state for verification
    this.stateStore.set(state, {
      sourceName,
      sourceType: provider,
      redirectUri,
      nonce,
    });

    // Clean up old states after 10 minutes
    setTimeout(() => this.stateStore.delete(state), 10 * 60 * 1000);

    const params = new URLSearchParams();
    params.set('client_id', config.clientId);
    params.set('redirect_uri', config.callbackUrl);
    params.set('state', state);

    if (provider === 'github') {
      params.set('scope', config.scopes.join(' '));
    } else {
      // Atlassian OAuth 2.0
      params.set('audience', 'api.atlassian.com');
      params.set('scope', config.scopes.join(' '));
      params.set('response_type', 'code');
      params.set('prompt', 'consent');
    }

    return {
      url: `${config.authorizationUrl}?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<{ source: Source; redirectUri: string }> {
    // Verify state
    const storedState = this.stateStore.get(state);
    if (!storedState) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    this.stateStore.delete(state);

    const config = this.getProviderConfig(provider);

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(provider, code, config);

    // Get user/resource info
    const resourceInfo = await this.getResourceInfo(provider, tokens.accessToken);

    // Create or update source
    const source = this.sourceRepository.create({
      name: storedState.sourceName || resourceInfo.name,
      type: storedState.sourceType as any,
      config: {
        authType: 'oauth',
        oauth: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || '',
          expiresAt: tokens.expiresAt || new Date(Date.now() + 3600 * 1000),
        },
        baseUrl: resourceInfo.baseUrl,
        repository: resourceInfo.repository,
        cloudId: resourceInfo.cloudId,
      },
      status: 'connected',
      permissions: resourceInfo.permissions || [],
    });

    const savedSource = await this.sourceRepository.save(source);

    return {
      source: savedSource,
      redirectUri: storedState.redirectUri,
    };
  }

  private async exchangeCodeForTokens(
    provider: string,
    code: string,
    config: OAuthConfig,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
    const body: Record<string, string> = {
      code,
      redirect_uri: config.callbackUrl,
    };

    let headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (provider === 'github') {
      body.client_id = config.clientId;
      body.client_secret = config.clientSecret;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      // Atlassian
      body.grant_type = 'authorization_code';
      body.client_id = config.clientId;
      body.client_secret = config.clientSecret;
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers,
      body: provider === 'github'
        ? new URLSearchParams(body).toString()
        : JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new BadRequestException(`Token exchange failed: ${error}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new BadRequestException(`OAuth error: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  private async getResourceInfo(
    provider: string,
    accessToken: string,
  ): Promise<{
    name: string;
    baseUrl?: string;
    repository?: string;
    cloudId?: string;
    permissions?: string[];
  }> {
    if (provider === 'github') {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new BadRequestException('Failed to get GitHub user info');
      }

      const user = await response.json();
      return {
        name: `GitHub - ${user.login}`,
        permissions: ['repo', 'read:org'],
      };
    } else {
      // Atlassian - get accessible resources
      const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new BadRequestException('Failed to get Atlassian resources');
      }

      const resources = await response.json();

      if (!resources || resources.length === 0) {
        throw new BadRequestException('No accessible Atlassian sites found');
      }

      const site = resources[0];
      return {
        name: `${provider === 'jira' ? 'Jira' : 'Confluence'} - ${site.name}`,
        baseUrl: site.url,
        cloudId: site.id,
        permissions: provider === 'jira'
          ? ['read:jira-work', 'write:jira-work']
          : ['read:confluence-content.all'],
      };
    }
  }

  async refreshToken(sourceId: string): Promise<void> {
    const source = await this.sourceRepository.findOne({ where: { id: sourceId } });
    if (!source || source.config.authType !== 'oauth' || !source.config.oauth?.refreshToken) {
      throw new BadRequestException('Cannot refresh token for this source');
    }

    const config = this.getProviderConfig(source.type);

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: source.config.oauth.refreshToken,
      }),
    });

    if (!response.ok) {
      source.status = 'error';
      source.errorMessage = 'Token refresh failed';
      await this.sourceRepository.save(source);
      throw new BadRequestException('Token refresh failed');
    }

    const data = await response.json();

    source.config.oauth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || source.config.oauth.refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : source.config.oauth.expiresAt,
    };

    await this.sourceRepository.save(source);
  }
}
