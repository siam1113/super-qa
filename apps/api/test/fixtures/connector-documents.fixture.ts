import { ConnectorDocument } from '../../src/modules/sources/connectors/connector.interface';

export const mockGitHubDocuments: ConnectorDocument[] = [
  {
    externalId: 'issue-1',
    type: 'issue',
    title: 'Add user authentication',
    content: `# User Authentication Feature

User Flow:
1. User navigates to login page
2. User enters email and password
3. System validates credentials
4. System generates JWT token
5. User is redirected to dashboard

Rule: Password must be at least 8 characters long and contain uppercase, lowercase, and numbers.

Entity: User
- id: UUID
- email: string
- password: string (hashed)
- createdAt: timestamp

API: POST /api/auth/login
Request: { email: string, password: string }
Response: { token: string, user: User }`,
    url: 'https://github.com/test/repo/issues/1',
    metadata: {
      labels: ['feature', 'authentication'],
      state: 'open',
      author: 'john-doe',
      createdAt: '2026-07-01T10:00:00Z',
    },
  },
  {
    externalId: 'pr-2',
    type: 'pr',
    title: 'Implement password validation',
    content: `This PR implements password validation rules:

Rule: Passwords must meet security requirements
- Minimum 8 characters
- Must contain uppercase letter
- Must contain lowercase letter
- Must contain number
- Must contain special character

Code changes:
- Added validatePassword function
- Updated user registration endpoint
- Added tests for password validation`,
    url: 'https://github.com/test/repo/pull/2',
    metadata: {
      state: 'merged',
      author: 'jane-smith',
      reviewers: ['john-doe'],
      mergedAt: '2026-07-15T14:30:00Z',
    },
  },
  {
    externalId: 'code-auth.ts',
    type: 'code',
    title: 'Authentication Service',
    content: `export class AuthService {
  async login(email: string, password: string): Promise<{ token: string }> {
    // Validate input
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    // Find user
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Generate JWT token
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return { token };
  }

  async validatePassword(password: string): Promise<boolean> {
    // Minimum 8 characters
    if (password.length < 8) return false;

    // Must contain uppercase
    if (!/[A-Z]/.test(password)) return false;

    // Must contain lowercase
    if (!/[a-z]/.test(password)) return false;

    // Must contain number
    if (!/[0-9]/.test(password)) return false;

    // Must contain special character
    if (!/[!@#$%^&*]/.test(password)) return false;

    return true;
  }
}`,
    url: 'https://github.com/test/repo/blob/main/src/auth/auth.service.ts',
    metadata: {
      path: 'src/auth/auth.service.ts',
      language: 'typescript',
      size: 1024,
    },
  },
];

export const mockJiraDocuments: ConnectorDocument[] = [
  {
    externalId: 'PROJ-123',
    type: 'issue',
    title: 'As a user, I want to reset my password',
    content: `Acceptance Criteria:
1. User can request password reset via email
2. System sends reset link with expiry token
3. User can set new password via link
4. Old password becomes invalid after reset

Test Cases:
- Test that reset email is sent
- Test that token expires after 1 hour
- Test that old password doesn't work after reset
- Test that new password works immediately

Rule: Password reset tokens must expire after 1 hour for security.`,
    url: 'https://test.atlassian.net/browse/PROJ-123',
    metadata: {
      issueType: 'Story',
      status: 'In Progress',
      priority: 'High',
      assignee: 'john-doe',
      reporter: 'product-owner',
    },
  },
];

export const mockConfluenceDocuments: ConnectorDocument[] = [
  {
    externalId: 'page-456',
    type: 'wiki',
    title: 'Authentication Flow Documentation',
    content: `# Authentication Architecture

## Overview
Our authentication system uses JWT tokens with refresh token rotation.

## User Flow: Login Process
1. User submits credentials
2. Backend validates against database
3. JWT access token generated (15 min expiry)
4. Refresh token generated (7 day expiry)
5. Both tokens returned to client
6. Client stores tokens securely

## Security Rules
- Access tokens expire after 15 minutes
- Refresh tokens expire after 7 days
- Failed login attempts are rate-limited (5 attempts per 15 minutes)
- Passwords must be hashed using bcrypt with salt rounds >= 10

## Database Schema

Entity: User
- id: UUID (primary key)
- email: VARCHAR(255) unique
- password_hash: VARCHAR(255)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

Entity: RefreshToken
- id: UUID (primary key)
- user_id: UUID (foreign key)
- token: VARCHAR(500) unique
- expires_at: TIMESTAMP
- revoked: BOOLEAN

## API Endpoints

API: POST /api/auth/login
Authentication: None (public)
Request Body: { email: string, password: string }
Response: { accessToken: string, refreshToken: string }

API: POST /api/auth/refresh
Authentication: Refresh token required
Request Body: { refreshToken: string }
Response: { accessToken: string, refreshToken: string }

API: POST /api/auth/logout
Authentication: Access token required
Request Body: { refreshToken: string }
Response: { success: boolean }`,
    url: 'https://test.atlassian.net/wiki/spaces/DOCS/pages/456',
    metadata: {
      spaceKey: 'DOCS',
      version: 3,
      lastModified: '2026-07-20T09:00:00Z',
      author: 'tech-lead',
    },
  },
];
