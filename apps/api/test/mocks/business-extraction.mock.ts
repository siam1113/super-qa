export class MockBusinessExtractionService {
  private businessService?: { upsert(item: any): Promise<{ id: string }>; createRelationship(input: any): Promise<unknown> };

  setBusinessService(service: { upsert(item: any): Promise<{ id: string }>; createRelationship(input: any): Promise<unknown> }) {
    this.businessService = service;
  }

  async extractFromDocument(document: any): Promise<any> {
    const items = [];
    const relationships = [];

    const content = document.content.toLowerCase();

    // Mock flow extraction
    if (content.includes('user flow') || content.includes('process:')) {
      items.push({
        type: 'flow',
        name: 'Login Flow',
        description: 'User authentication flow',
        content: {
          steps: [
            { stepNumber: 1, description: 'Navigate to login page', actor: 'User', action: 'navigate' },
            { stepNumber: 2, description: 'Enter credentials', actor: 'User', action: 'input' },
            { stepNumber: 3, description: 'Validate credentials', actor: 'System', action: 'validate' },
            { stepNumber: 4, description: 'Generate token', actor: 'System', action: 'generate' },
            { stepNumber: 5, description: 'Redirect to dashboard', actor: 'System', action: 'redirect' },
          ],
        },
        confidence: 'high',
        tags: ['authentication', 'user-flow'],
        sourceId: document.sourceId,
        documentId: document.id,
      });
    }

    // Mock rule extraction
    if (content.includes('rule:') || content.includes('must')) {
      items.push({
        type: 'rule',
        name: 'Password Validation Rule',
        description: 'Password must be at least 8 characters long and contain uppercase, lowercase, and numbers',
        content: {
          condition: 'User creates or updates password',
          action: 'Validate password meets security requirements',
          priority: 'high',
          category: 'security',
        },
        confidence: 'high',
        tags: ['security', 'validation'],
        sourceId: document.sourceId,
        documentId: document.id,
      });
    }

    // Mock entity extraction
    if (content.includes('entity:') || content.includes('- id:')) {
      items.push({
        type: 'entity',
        name: 'User',
        description: 'User entity for authentication',
        content: {
          fields: [
            { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
            { name: 'email', type: 'string', required: true, description: 'User email address' },
            { name: 'password', type: 'string', required: true, description: 'Hashed password' },
            { name: 'createdAt', type: 'timestamp', required: true, description: 'Creation timestamp' },
          ],
        },
        confidence: 'high',
        tags: ['database', 'schema'],
        sourceId: document.sourceId,
        documentId: document.id,
      });
    }

    // Mock API extraction
    if (content.includes('api:') || content.includes('post /') || content.includes('get /')) {
      items.push({
        type: 'api',
        name: 'POST /api/auth/login',
        description: 'User login endpoint',
        content: {
          method: 'POST',
          path: '/api/auth/login',
          parameters: [],
          requestBody: {
            email: 'string',
            password: 'string',
          },
          responses: {
            200: { token: 'string', user: 'User' },
            401: { message: 'Invalid credentials' },
          },
          authentication: 'none',
        },
        confidence: 'high',
        tags: ['api', 'authentication'],
        sourceId: document.sourceId,
        documentId: document.id,
      });
    }

    // Create relationships
    if (items.length > 1) {
      for (let i = 0; i < items.length - 1; i++) {
        relationships.push({
          fromName: items[i].name,
          toName: items[i + 1].name,
          type: 'related_to',
        });
      }
    }

    return { items, relationships };
  }

  async saveExtractedItems(extraction: any): Promise<{ saved: number; relationships: number }> {
    if (this.businessService) {
      const itemIds = new Map<string, string>();
      for (const item of extraction.items) itemIds.set(item.name, (await this.businessService.upsert(item)).id);
      let relationships = 0;
      for (const relationship of extraction.relationships) {
        const fromItemId = itemIds.get(relationship.fromName);
        const toItemId = itemIds.get(relationship.toName);
        if (fromItemId && toItemId) {
          await this.businessService.createRelationship({ ...relationship, fromItemId, toItemId });
          relationships++;
        }
      }
      return { saved: extraction.items.length, relationships };
    }
    return {
      saved: extraction.items.length,
      relationships: extraction.relationships.length,
    };
  }
}
