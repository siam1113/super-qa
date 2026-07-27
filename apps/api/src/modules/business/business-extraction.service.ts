import { Injectable, Logger } from '@nestjs/common';
import { BusinessService, CreateBusinessItemDto } from './business.service';
import {
  BusinessItemType,
  BusinessItemContent,
  FlowContent,
  RuleContent,
  EntityContent,
  PermissionContent,
  IntegrationContent,
  TerminologyContent,
  ConstraintContent,
  FactContent,
  ApiContent,
  CodeContent,
  ArchitectureContent,
  DatabaseContent,
  TestCaseContent,
  RequirementContent,
  DefectContent,
  DomContent,
  LocatorContent,
  ActionContent,
  DataSetupContent,
  AuthContent,
} from './entities/business-item.entity';

interface ExtractionResult {
  items: CreateBusinessItemDto[];
  relationships: Array<{
    fromName: string;
    toName: string;
    type: string;
  }>;
}

interface DocumentInput {
  id: string;
  title: string;
  content: string;
  type: string;
  sourceId: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class BusinessExtractionService {
  private readonly logger = new Logger(BusinessExtractionService.name);

  constructor(private readonly businessService: BusinessService) {}

  /**
   * Extract business knowledge from a document
   */
  async extractFromDocument(document: DocumentInput): Promise<ExtractionResult> {
    const result: ExtractionResult = { items: [], relationships: [] };

    try {
      // Extract different types of business knowledge
      const extractors = [
        // Product
        this.extractFlows(document),
        this.extractRules(document),
        this.extractEntities(document),
        this.extractFacts(document),
        this.extractPermissions(document),
        this.extractIntegrations(document),
        this.extractTerminology(document),
        this.extractConstraints(document),
        // Technical
        this.extractApis(document),
        this.extractCode(document),
        this.extractArchitecture(document),
        this.extractDatabase(document),
        // Quality
        this.extractTestCases(document),
        this.extractRequirements(document),
        this.extractDefects(document),
        // Automation
        this.extractDom(document),
        this.extractLocators(document),
        this.extractActions(document),
        this.extractDataSetup(document),
        this.extractAuth(document),
      ];

      const extractions = await Promise.all(extractors);

      for (const extraction of extractions) {
        result.items.push(...extraction.items);
        result.relationships.push(...extraction.relationships);
      }

      this.logger.debug(
        `Extracted ${result.items.length} items from document ${document.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error extracting from document ${document.id}: ${error.message}`,
      );
    }

    return result;
  }

  /**
   * Save extracted items to database
   */
  async saveExtractedItems(
    extraction: ExtractionResult,
  ): Promise<{ saved: number; relationships: number }> {
    let saved = 0;
    let relCount = 0;
    const itemMap = new Map<string, string>(); // name -> id

    // Save items
    for (const item of extraction.items) {
      try {
        const savedItem = await this.businessService.upsert(item);
        itemMap.set(item.name, savedItem.id);
        saved++;
      } catch (error) {
        this.logger.warn(`Failed to save item ${item.name}: ${error.message}`);
      }
    }

    // Create relationships
    for (const rel of extraction.relationships) {
      const fromId = itemMap.get(rel.fromName);
      const toId = itemMap.get(rel.toName);

      if (fromId && toId) {
        try {
          await this.businessService.createRelationship({
            type: rel.type as any,
            fromItemId: fromId,
            toItemId: toId,
          });
          relCount++;
        } catch (error) {
          // Relationship may already exist
        }
      }
    }

    return { saved, relationships: relCount };
  }

  // ============ Extraction Methods ============

  private async extractFlows(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: "User Flow:", "Process:", "Workflow:", numbered steps
    const flowPatterns = [
      /(?:user\s+)?flow[:\s]+([^\n]+)/gi,
      /process[:\s]+([^\n]+)/gi,
      /workflow[:\s]+([^\n]+)/gi,
    ];

    for (const pattern of flowPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const flowName = match[1].trim();
        if (flowName.length > 3 && flowName.length < 200) {
          // Try to extract steps
          const steps = this.extractSteps(doc.content, match.index);

          const content: FlowContent = {
            steps: steps.map((step, idx) => ({
              order: idx + 1,
              name: step,
            })),
          };

          items.push({
            type: 'flow',
            name: flowName,
            description: `Extracted from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private extractSteps(content: string, startIndex: number): string[] {
    const steps: string[] = [];
    const afterFlow = content.substring(startIndex, startIndex + 2000);

    // Look for numbered steps: 1. ..., 2. ..., etc.
    const stepPattern = /(?:^|\n)\s*(\d+)[.\)]\s+([^\n]+)/g;
    let match;
    while ((match = stepPattern.exec(afterFlow)) !== null) {
      if (steps.length < 20) {
        steps.push(match[2].trim());
      }
    }

    // Also look for bullet points if no numbered steps
    if (steps.length === 0) {
      const bulletPattern = /(?:^|\n)\s*[-•*]\s+([^\n]+)/g;
      while ((match = bulletPattern.exec(afterFlow)) !== null) {
        if (steps.length < 10) {
          steps.push(match[1].trim());
        }
      }
    }

    return steps;
  }

  private async extractRules(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: "Rule:", "Business Rule:", "If... then...", "must", "shall", "should"
    const rulePatterns = [
      /(?:business\s+)?rule[:\s]+([^\n]+)/gi,
      /validation[:\s]+([^\n]+)/gi,
      /requirement[:\s]+([^\n]+)/gi,
    ];

    for (const pattern of rulePatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const ruleName = match[1].trim();
        if (ruleName.length > 5 && ruleName.length < 300) {
          items.push({
            type: 'rule',
            name: this.truncate(ruleName, 100),
            description: ruleName,
            confidence: 'inferred',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    // Extract "must/shall/should" statements as rules
    const mustPattern = /([A-Z][^.]*(?:must|shall|should|will)\s+[^.]+\.)/g;
    let match;
    while ((match = mustPattern.exec(doc.content)) !== null) {
      const statement = match[1].trim();
      if (statement.length > 10 && statement.length < 500) {
        const content: RuleContent = {
          condition: '',
          action: statement,
        };

        items.push({
          type: 'rule',
          name: this.truncate(statement, 100),
          description: statement,
          content,
          confidence: 'low',
          tags: ['auto-extracted', 'requirement-statement'],
          sourceId: doc.sourceId,
          documentId: doc.id,
        });
      }
    }

    return { items, relationships };
  }

  private async extractEntities(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Class names, Model names, data objects
    const entityPatterns = [
      /(?:entity|model|class|object|table)[:\s]+([A-Z][a-zA-Z]+)/gi,
      /interface\s+([A-Z][a-zA-Z]+)/g,
      /type\s+([A-Z][a-zA-Z]+)\s*=/g,
    ];

    const foundEntities = new Set<string>();

    for (const pattern of entityPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const entityName = match[1].trim();
        if (
          entityName.length > 2 &&
          entityName.length < 50 &&
          !foundEntities.has(entityName.toLowerCase())
        ) {
          foundEntities.add(entityName.toLowerCase());

          // Try to extract attributes
          const attributes = this.extractAttributes(doc.content, match.index);

          const content: EntityContent = {
            attributes,
          };

          items.push({
            type: 'entity',
            name: entityName,
            description: `Data entity extracted from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private extractAttributes(
    content: string,
    startIndex: number,
  ): EntityContent['attributes'] {
    const attributes: EntityContent['attributes'] = [];
    const afterEntity = content.substring(startIndex, startIndex + 1000);

    // Look for property definitions
    const attrPattern =
      /(?:^|\n)\s*(\w+)[:\s]+([a-zA-Z]+(?:\[\])?)\s*(?:\/\/|#|--)?([^\n]*)?/g;
    let match;
    while ((match = attrPattern.exec(afterEntity)) !== null) {
      if (attributes.length < 20) {
        attributes.push({
          name: match[1],
          type: match[2],
          description: match[3]?.trim() || undefined,
        });
      }
    }

    return attributes;
  }

  private async extractFacts(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Facts, key-value pairs, configuration values
    const factPatterns = [
      /(?:default|limit|max|min|threshold)[:\s=]+(\d+(?:\.\d+)?)\s*(\w+)?/gi,
      /timeout[:\s=]+(\d+)\s*(ms|seconds?|minutes?|hours?)?/gi,
      /rate[:\s=]+(\d+(?:\.\d+)?)\s*(?:per\s+)?(\w+)?/gi,
    ];

    for (const pattern of factPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const value = match[1];
        const unit = match[2] || '';
        const context = doc.content.substring(
          Math.max(0, match.index - 50),
          match.index,
        );
        const factName = this.extractFactName(context, match[0]);

        const content: FactContent = {
          value,
          unit: unit || undefined,
        };

        items.push({
          type: 'fact',
          name: factName,
          description: `Value: ${value} ${unit}`,
          content,
          confidence: 'inferred',
          tags: ['auto-extracted', 'numeric-value'],
          sourceId: doc.sourceId,
          documentId: doc.id,
        });
      }
    }

    return { items, relationships };
  }

  private extractFactName(context: string, match: string): string {
    // Try to extract a meaningful name from context
    const words = context.split(/\s+/).slice(-3);
    const name = words.join(' ').replace(/[^\w\s]/g, '').trim();
    return name || this.truncate(match, 50);
  }

  private async extractPermissions(
    doc: DocumentInput,
  ): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Permissions, roles, access control
    const permPatterns = [
      /(?:role|permission)[:\s]+([^\n]+)/gi,
      /(?:can|may|allowed\s+to)\s+(\w+)\s+([^\n]+)/gi,
      /access[:\s]+([^\n]+)/gi,
    ];

    for (const pattern of permPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const permText = (match[1] || match[0]).trim();
        if (permText.length > 3 && permText.length < 200) {
          items.push({
            type: 'permission',
            name: this.truncate(permText, 100),
            description: permText,
            confidence: 'low',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractIntegrations(
    doc: DocumentInput,
  ): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: API endpoints, webhooks, external systems
    const integrationPatterns = [
      /(?:api|endpoint)[:\s]+([^\n]+)/gi,
      /(?:webhook|callback)[:\s]+([^\n]+)/gi,
      /(?:integration|connects?\s+to)[:\s]+([^\n]+)/gi,
      /(https?:\/\/[^\s]+)/g,
    ];

    const foundUrls = new Set<string>();

    for (const pattern of integrationPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const integration = match[1].trim();
        if (
          integration.length > 5 &&
          integration.length < 300 &&
          !foundUrls.has(integration)
        ) {
          foundUrls.add(integration);

          const content: IntegrationContent = {
            system: integration,
            type: integration.startsWith('http') ? 'api' : 'other',
            direction: 'bidirectional',
          };

          items.push({
            type: 'integration',
            name: this.truncate(integration, 100),
            description: `Integration point from ${doc.title}`,
            content,
            confidence: 'low',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractTerminology(
    doc: DocumentInput,
  ): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Definitions, glossary terms, "X means Y", "X is defined as Y"
    const termPatterns = [
      /["']([A-Z][a-zA-Z\s]+)["']\s+(?:means?|refers?\s+to|is\s+defined\s+as)[:\s]+([^.]+)/gi,
      /(?:definition|glossary)[:\s]+([^\n]+)/gi,
      /term[:\s]+([^\n]+)/gi,
    ];

    for (const pattern of termPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const term = match[1].trim();
        const definition = match[2]?.trim() || '';

        if (term.length > 2 && term.length < 100) {
          const content: TerminologyContent = {
            term,
            definition: definition || `Term from ${doc.title}`,
          };

          items.push({
            type: 'terminology',
            name: term,
            description: definition || undefined,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractConstraints(
    doc: DocumentInput,
  ): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Constraints, limits, boundaries
    const constraintPatterns = [
      /(?:constraint|limit|boundary|restriction)[:\s]+([^\n]+)/gi,
      /(?:maximum|minimum|at\s+least|at\s+most|no\s+more\s+than)\s+(\d+)/gi,
      /(?:must\s+be|should\s+be)\s+(?:between|less\s+than|greater\s+than)\s+([^\n]+)/gi,
    ];

    for (const pattern of constraintPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const constraintText = match[1]?.trim() || match[0].trim();
        if (constraintText.length > 3 && constraintText.length < 300) {
          const content: ConstraintContent = {
            type: 'custom',
            value: constraintText,
          };

          items.push({
            type: 'constraint',
            name: this.truncate(constraintText, 100),
            description: constraintText,
            content,
            confidence: 'low',
            tags: ['auto-extracted'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  // ============ Technical Extraction ============

  private async extractApis(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: API endpoints, REST methods, OpenAPI paths
    const apiPatterns = [
      /(GET|POST|PUT|PATCH|DELETE)\s+([\/\w{}\-:]+)/gi,
      /endpoint[:\s]+([\/\w{}\-]+)/gi,
      /api[:\s]+([\/\w{}\-]+)/gi,
      /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    const foundApis = new Set<string>();

    for (const pattern of apiPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const method = match[1]?.toUpperCase() || 'GET';
        const endpoint = match[2]?.trim() || match[1]?.trim();
        const key = `${method} ${endpoint}`;

        if (endpoint && endpoint.length > 1 && !foundApis.has(key)) {
          foundApis.add(key);

          const content: ApiContent = {
            method,
            endpoint,
          };

          items.push({
            type: 'api',
            name: key,
            description: `API endpoint from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'api'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractCode(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Function/method definitions, class definitions
    const codePatterns = [
      /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(:])/g,
      /(?:class|interface|type|enum)\s+(\w+)/g,
      /def\s+(\w+)\s*\(/g,
      /func\s+(\w+)\s*\(/g,
    ];

    const foundCode = new Set<string>();

    for (const pattern of codePatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const name = match[1]?.trim();
        if (name && name.length > 2 && !foundCode.has(name.toLowerCase())) {
          foundCode.add(name.toLowerCase());

          const content: CodeContent = {
            language: this.detectLanguage(doc),
            path: doc.metadata?.path || doc.title,
            purpose: `Code element from ${doc.title}`,
          };

          items.push({
            type: 'code',
            name,
            description: `Code: ${name}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'code'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private detectLanguage(doc: DocumentInput): string {
    const ext = doc.metadata?.path?.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', js: 'javascript', py: 'python', go: 'go',
      java: 'java', rb: 'ruby', rs: 'rust', cs: 'csharp',
    };
    return langMap[ext || ''] || 'unknown';
  }

  private async extractArchitecture(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Architecture components, layers, services
    const archPatterns = [
      /(?:component|service|module|layer)[:\s]+([^\n]+)/gi,
      /(?:architecture|system)[:\s]+([^\n]+)/gi,
      /(?:microservice|container|pod)[:\s]+([^\n]+)/gi,
    ];

    for (const pattern of archPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const component = match[1]?.trim();
        if (component && component.length > 2 && component.length < 200) {
          const content: ArchitectureContent = {
            component,
          };

          items.push({
            type: 'architecture',
            name: this.truncate(component, 100),
            description: `Architecture component from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'architecture'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractDatabase(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Table definitions, schema, columns
    const dbPatterns = [
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/gi,
      /(?:table|schema|collection)[:\s]+[`"']?(\w+)[`"']?/gi,
      /@Entity\s*\(\s*['"](\w+)['"]\s*\)/g,
    ];

    const foundTables = new Set<string>();

    for (const pattern of dbPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const tableName = match[1]?.trim();
        if (tableName && !foundTables.has(tableName.toLowerCase())) {
          foundTables.add(tableName.toLowerCase());

          const content: DatabaseContent = {
            tableName,
          };

          items.push({
            type: 'database',
            name: tableName,
            description: `Database table from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'database'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  // ============ Quality Extraction ============

  private async extractTestCases(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Test cases, test descriptions, it/describe blocks
    const testPatterns = [
      /(?:it|test)\s*\(\s*['"]([^'"]+)['"]/g,
      /(?:describe|context)\s*\(\s*['"]([^'"]+)['"]/g,
      /test\s+case[:\s]+([^\n]+)/gi,
      /TC[-_]?\d+[:\s]+([^\n]+)/gi,
    ];

    const foundTests = new Set<string>();

    for (const pattern of testPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const testName = match[1]?.trim();
        if (testName && testName.length > 5 && !foundTests.has(testName.toLowerCase())) {
          foundTests.add(testName.toLowerCase());

          const content: TestCaseContent = {
            steps: [],
            automationStatus: 'automated',
          };

          items.push({
            type: 'test_case',
            name: this.truncate(testName, 100),
            description: testName,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'test'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractRequirements(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Requirements, user stories, acceptance criteria
    const reqPatterns = [
      /REQ[-_]?\d+[:\s]+([^\n]+)/gi,
      /US[-_]?\d+[:\s]+([^\n]+)/gi,
      /(?:as\s+a\s+\w+,?\s+i\s+want\s+to?\s+)([^\n]+)/gi,
      /acceptance\s+criteria[:\s]+([^\n]+)/gi,
      /(?:shall|must|should)\s+([^\n.]+)/gi,
    ];

    const foundReqs = new Set<string>();

    for (const pattern of reqPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const reqText = match[1]?.trim();
        if (reqText && reqText.length > 10 && !foundReqs.has(reqText.toLowerCase())) {
          foundReqs.add(reqText.toLowerCase());

          const content: RequirementContent = {
            type: 'functional',
          };

          items.push({
            type: 'requirement',
            name: this.truncate(reqText, 100),
            description: reqText,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'requirement'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractDefects(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Bugs, defects, issues
    const defectPatterns = [
      /BUG[-_]?\d+[:\s]+([^\n]+)/gi,
      /DEFECT[-_]?\d+[:\s]+([^\n]+)/gi,
      /(?:bug|defect|issue)[:\s]+([^\n]+)/gi,
      /(?:fix|fixed|fixing)[:\s]+([^\n]+)/gi,
    ];

    const foundDefects = new Set<string>();

    for (const pattern of defectPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const defectText = match[1]?.trim();
        if (defectText && defectText.length > 5 && !foundDefects.has(defectText.toLowerCase())) {
          foundDefects.add(defectText.toLowerCase());

          const content: DefectContent = {
            severity: 'medium',
            status: 'open',
          };

          items.push({
            type: 'defect',
            name: this.truncate(defectText, 100),
            description: defectText,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'defect'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  // ============ Automation Extraction ============

  private async extractDom(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Page objects, page definitions
    const domPatterns = [
      /(?:page|screen|view)[:\s]+([^\n]+)/gi,
      /class\s+(\w+Page)\s/g,
      /(?:PageObject|BasePage)\s*{\s*([^}]+)/gi,
    ];

    const foundPages = new Set<string>();

    for (const pattern of domPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const pageName = match[1]?.trim();
        if (pageName && pageName.length > 2 && !foundPages.has(pageName.toLowerCase())) {
          foundPages.add(pageName.toLowerCase());

          const content: DomContent = {
            pageName,
            elements: [],
          };

          items.push({
            type: 'dom',
            name: this.truncate(pageName, 100),
            description: `Page object from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'page-object'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractLocators(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Selectors, locators, data-testid
    const locatorPatterns = [
      /data-testid\s*=\s*['"]([^'"]+)['"]/g,
      /getByTestId\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /getByRole\s*\(\s*['"]([^'"]+)['"]/g,
      /locator\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\$\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    const foundLocators = new Set<string>();

    for (const pattern of locatorPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const selector = match[1]?.trim();
        if (selector && selector.length > 1 && !foundLocators.has(selector)) {
          foundLocators.add(selector);

          const content: LocatorContent = {
            selector,
            type: selector.startsWith('data-') ? 'testid' : 'css',
            element: selector,
          };

          items.push({
            type: 'locator',
            name: selector,
            description: `Locator from ${doc.title}`,
            content,
            confidence: 'inferred',
            tags: ['auto-extracted', 'locator'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractActions(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Actions, steps, commands
    const actionPatterns = [
      /\.click\s*\(/g,
      /\.fill\s*\(\s*['"]([^'"]*)['"]/g,
      /\.type\s*\(\s*['"]([^'"]*)['"]/g,
      /(?:step|action)[:\s]+([^\n]+)/gi,
      /(?:When|Then|Given)\s+([^\n]+)/gi,
    ];

    const foundActions = new Set<string>();

    for (const pattern of actionPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const actionText = match[1]?.trim() || match[0]?.trim();
        if (actionText && actionText.length > 3 && !foundActions.has(actionText.toLowerCase())) {
          foundActions.add(actionText.toLowerCase());

          const content: ActionContent = {
            actionType: 'custom',
            code: actionText,
          };

          items.push({
            type: 'action',
            name: this.truncate(actionText, 100),
            description: `Action from ${doc.title}`,
            content,
            confidence: 'low',
            tags: ['auto-extracted', 'action'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  private async extractDataSetup(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Fixtures, factories, seed data
    const dataPatterns = [
      /(?:fixture|factory|seed)[:\s]+([^\n]+)/gi,
      /beforeEach\s*\(\s*(?:async\s*)?\(\)\s*=>\s*{([^}]+)}/g,
      /(?:createUser|createData|setupData)\s*\(/g,
    ];

    for (const pattern of dataPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const dataText = match[1]?.trim() || 'Data Setup';

        const content: DataSetupContent = {
          entityType: 'unknown',
          operation: 'create',
        };

        items.push({
          type: 'data_setup',
          name: this.truncate(dataText, 100),
          description: `Data setup from ${doc.title}`,
          content,
          confidence: 'low',
          tags: ['auto-extracted', 'data-setup'],
          sourceId: doc.sourceId,
          documentId: doc.id,
        });

        break; // Only one per doc to avoid noise
      }
    }

    return { items, relationships };
  }

  private async extractAuth(doc: DocumentInput): Promise<ExtractionResult> {
    const items: CreateBusinessItemDto[] = [];
    const relationships: ExtractionResult['relationships'] = [];

    // Pattern: Authentication, authorization, tokens
    const authPatterns = [
      /(?:auth|authentication|authorization)[:\s]+([^\n]+)/gi,
      /(?:token|jwt|bearer|api[_-]?key)[:\s]+([^\n]+)/gi,
      /(?:login|signin|authenticate)\s*\(/g,
    ];

    const foundAuth = new Set<string>();

    for (const pattern of authPatterns) {
      let match;
      while ((match = pattern.exec(doc.content)) !== null) {
        const authText = match[1]?.trim() || 'Authentication';
        if (!foundAuth.has(authText.toLowerCase())) {
          foundAuth.add(authText.toLowerCase());

          const content: AuthContent = {
            authType: 'jwt',
          };

          items.push({
            type: 'auth',
            name: this.truncate(authText, 100),
            description: `Auth config from ${doc.title}`,
            content,
            confidence: 'low',
            tags: ['auto-extracted', 'auth'],
            sourceId: doc.sourceId,
            documentId: doc.id,
          });
        }
      }
    }

    return { items, relationships };
  }

  // ============ Helpers ============

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }
}
