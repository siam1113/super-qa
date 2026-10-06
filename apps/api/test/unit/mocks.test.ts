import { MockGitHubConnector, MockJiraConnector, MockConfluenceConnector } from '../mocks/connector.mock';
import { MockEmbeddingService } from '../mocks/embedding.mock';
import { MockBusinessExtractionService } from '../mocks/business-extraction.mock';
import { mockGitHubDocuments, mockJiraDocuments, mockConfluenceDocuments } from '../fixtures/connector-documents.fixture';

describe('Mock Services Tests', () => {
  describe('MockGitHubConnector', () => {
    let connector: MockGitHubConnector;

    beforeEach(() => {
      connector = new MockGitHubConnector();
    });

    it('should test connection successfully with valid token', async () => {
      const result = await connector.testConnection({ token: 'test_token' });

      expect(result.success).toBe(true);
      expect(result.message).toContain('GitHub');
      expect(result.permissions).toBeDefined();
      expect(result.permissions.length).toBeGreaterThan(0);
    });

    it('should fail connection with missing token', async () => {
      const result = await connector.testConnection({ token: '' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('token');
    });

    it('should fetch documents with pagination', async () => {
      const result = await connector.fetchDocuments({ token: 'test' }, { limit: 2 });

      expect(result.documents).toBeDefined();
      expect(result.documents.length).toBeLessThanOrEqual(2);
      expect(result.hasMore).toBeDefined();
    });

    it('should return all GitHub mock documents', async () => {
      const result = await connector.fetchDocuments({ token: 'test' }, { limit: 10 });

      expect(result.documents.length).toBe(mockGitHubDocuments.length);
      expect(result.documents[0].type).toBe('issue');
      expect(result.documents[1].type).toBe('pr');
      expect(result.documents[2].type).toBe('code');
    });
  });

  describe('MockJiraConnector', () => {
    let connector: MockJiraConnector;

    beforeEach(() => {
      connector = new MockJiraConnector();
    });

    it('should test connection successfully', async () => {
      const result = await connector.testConnection({
        token: 'test_token',
        email: 'test@example.com'
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Jira');
    });

    it('should fetch Jira documents', async () => {
      const result = await connector.fetchDocuments({
        token: 'test',
        email: 'test@example.com'
      });

      expect(result.documents.length).toBe(mockJiraDocuments.length);
      expect(result.documents[0].type).toBe('issue');
    });
  });

  describe('MockConfluenceConnector', () => {
    let connector: MockConfluenceConnector;

    beforeEach(() => {
      connector = new MockConfluenceConnector();
    });

    it('should test connection successfully', async () => {
      const result = await connector.testConnection({
        token: 'test_token',
        email: 'test@example.com'
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Confluence');
    });

    it('should fetch Confluence documents', async () => {
      const result = await connector.fetchDocuments({
        token: 'test',
        email: 'test@example.com'
      });

      expect(result.documents.length).toBe(mockConfluenceDocuments.length);
      expect(result.documents[0].type).toBe('wiki');
    });
  });

  describe('MockEmbeddingService', () => {
    let service: MockEmbeddingService;

    beforeEach(() => {
      service = new MockEmbeddingService();
    });

    it('should generate embeddings for multiple texts', async () => {
      const texts = ['Hello world', 'Test embedding', 'Another text'];
      const embeddings = await service.embed(texts);

      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(1536);
      expect(embeddings[0].every(n => typeof n === 'number')).toBe(true);
    });

    it('should generate single embedding', async () => {
      const embedding = await service.embedSingle('Test text');

      expect(embedding).toHaveLength(1536);
      expect(embedding.every(n => typeof n === 'number')).toBe(true);
    });
  });

  describe('MockBusinessExtractionService', () => {
    let service: MockBusinessExtractionService;

    beforeEach(() => {
      service = new MockBusinessExtractionService();
    });

    it('should extract flows from document content', async () => {
      const document = {
        id: 'test-1',
        content: 'User Flow: 1. Login 2. Navigate 3. Complete action',
        sourceId: 'source-1',
      };

      const result = await service.extractFromDocument(document);

      expect(result.items.length).toBeGreaterThan(0);
      const flowItem = result.items.find(item => item.type === 'flow');
      expect(flowItem).toBeDefined();
      expect(flowItem.confidence).toBe('high');
    });

    it('should extract rules from document content', async () => {
      const document = {
        id: 'test-2',
        content: 'Rule: Passwords must be at least 8 characters',
        sourceId: 'source-1',
      };

      const result = await service.extractFromDocument(document);

      const ruleItem = result.items.find(item => item.type === 'rule');
      expect(ruleItem).toBeDefined();
      expect(ruleItem.name).toContain('Password');
    });

    it('should extract entities from document content', async () => {
      const document = {
        id: 'test-3',
        content: 'Entity: User\n- id: UUID\n- email: string',
        sourceId: 'source-1',
      };

      const result = await service.extractFromDocument(document);

      const entityItem = result.items.find(item => item.type === 'entity');
      expect(entityItem).toBeDefined();
      expect(entityItem.name).toBe('User');
    });

    it('should extract APIs from document content', async () => {
      const document = {
        id: 'test-4',
        content: 'API: POST /api/auth/login',
        sourceId: 'source-1',
      };

      const result = await service.extractFromDocument(document);

      const apiItem = result.items.find(item => item.type === 'api');
      expect(apiItem).toBeDefined();
      expect(apiItem.name).toContain('POST /api/auth/login');
    });

    it('should create relationships between extracted items', async () => {
      const document = {
        id: 'test-5',
        content: 'User Flow: Login\nRule: Password validation\nEntity: User',
        sourceId: 'source-1',
      };

      const result = await service.extractFromDocument(document);

      expect(result.items.length).toBeGreaterThan(1);
      expect(result.relationships.length).toBeGreaterThan(0);
    });

    it('should save extracted items', async () => {
      const extraction = {
        items: [
          { type: 'flow', name: 'Test Flow' },
          { type: 'rule', name: 'Test Rule' },
        ],
        relationships: [
          { fromName: 'Test Flow', toName: 'Test Rule', type: 'related_to' },
        ],
      };

      const result = await service.saveExtractedItems(extraction);

      expect(result.saved).toBe(2);
      expect(result.relationships).toBe(1);
    });
  });

  describe('Test Fixtures', () => {
    it('should have GitHub mock documents', () => {
      expect(mockGitHubDocuments).toBeDefined();
      expect(mockGitHubDocuments.length).toBe(3);
      expect(mockGitHubDocuments[0].externalId).toBe('issue-1');
      expect(mockGitHubDocuments[1].externalId).toBe('pr-2');
      expect(mockGitHubDocuments[2].externalId).toBe('code-auth.ts');
    });

    it('should have Jira mock documents', () => {
      expect(mockJiraDocuments).toBeDefined();
      expect(mockJiraDocuments.length).toBe(1);
      expect(mockJiraDocuments[0].externalId).toBe('PROJ-123');
    });

    it('should have Confluence mock documents', () => {
      expect(mockConfluenceDocuments).toBeDefined();
      expect(mockConfluenceDocuments.length).toBe(1);
      expect(mockConfluenceDocuments[0].externalId).toBe('page-456');
    });

    it('should have realistic content in fixtures', () => {
      const githubIssue = mockGitHubDocuments[0];
      expect(githubIssue.content).toContain('User Flow');
      expect(githubIssue.content).toContain('Rule:');
      expect(githubIssue.content).toContain('Entity:');
      expect(githubIssue.content).toContain('API:');
    });
  });
});
