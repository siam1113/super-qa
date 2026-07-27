import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, Record as Neo4jRecord } from 'neo4j-driver';

// Node types in our graph
export enum NodeType {
  REQUIREMENT = 'Requirement',
  TEST_CASE = 'TestCase',
  CODE = 'Code',
  BUG = 'Bug',
  FEATURE = 'Feature',
  DOCUMENT = 'Document',
  SOURCE = 'Source',
}

// Relationship types
export enum RelationType {
  // Traceability relationships
  TESTS = 'TESTS', // TestCase -[TESTS]-> Requirement
  IMPLEMENTS = 'IMPLEMENTS', // Code -[IMPLEMENTS]-> Requirement
  COVERS = 'COVERS', // TestCase -[COVERS]-> Code
  FOUND_IN = 'FOUND_IN', // Bug -[FOUND_IN]-> TestCase
  AFFECTS = 'AFFECTS', // Bug -[AFFECTS]-> Requirement
  FIXES = 'FIXES', // Code -[FIXES]-> Bug
  BLOCKS = 'BLOCKS', // Bug -[BLOCKS]-> Feature

  // Hierarchy relationships
  PART_OF = 'PART_OF', // Child -[PART_OF]-> Parent
  DEPENDS_ON = 'DEPENDS_ON', // Node -[DEPENDS_ON]-> Node

  // Source relationships
  FROM_SOURCE = 'FROM_SOURCE', // Document -[FROM_SOURCE]-> Source
  REFERENCES = 'REFERENCES', // Document -[REFERENCES]-> Document
}

export interface GraphNode {
  id: string;
  type: NodeType;
  externalId?: string;
  title: string;
  properties?: Record<string, any>;
}

export interface GraphRelationship {
  id?: string;
  type: RelationType;
  fromId: string;
  toId: string;
  properties?: Record<string, any>;
}

export interface TraceabilityPath {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private driver: Driver | null = null;
  private isConnected = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
    await this.createConstraints();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const uri = this.configService.get('NEO4J_URI') || 'bolt://localhost:7687';
    const user = this.configService.get('NEO4J_USER') || 'neo4j';
    const password = this.configService.get('NEO4J_PASSWORD') || 'qaagent123';

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      await this.driver.verifyConnectivity();
      this.isConnected = true;
      this.logger.log('Connected to Neo4j');
    } catch (error: any) {
      this.logger.warn(`Could not connect to Neo4j: ${error.message}`);
      this.isConnected = false;
    }
  }

  private async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.isConnected = false;
      this.logger.log('Disconnected from Neo4j');
    }
  }

  private getSession(): Session | null {
    if (!this.driver || !this.isConnected) {
      return null;
    }
    return this.driver.session();
  }

  /**
   * Create database constraints and indexes
   */
  private async createConstraints(): Promise<void> {
    const session = this.getSession();
    if (!session) return;

    try {
      // Create unique constraint on id for each node type
      for (const type of Object.values(NodeType)) {
        await session.run(`
          CREATE CONSTRAINT IF NOT EXISTS FOR (n:${type})
          REQUIRE n.id IS UNIQUE
        `);
      }

      // Create index on externalId for faster lookups
      for (const type of Object.values(NodeType)) {
        await session.run(`
          CREATE INDEX IF NOT EXISTS FOR (n:${type})
          ON (n.externalId)
        `);
      }

      this.logger.log('Graph constraints and indexes created');
    } catch (error: any) {
      this.logger.warn(`Could not create constraints: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Create or update a node
   */
  async upsertNode(node: GraphNode): Promise<GraphNode | null> {
    const session = this.getSession();
    if (!session) return null;

    try {
      const result = await session.run(
        `
        MERGE (n:${node.type} {id: $id})
        SET n.externalId = $externalId,
            n.title = $title,
            n.updatedAt = datetime()
        SET n += $properties
        RETURN n
        `,
        {
          id: node.id,
          externalId: node.externalId || null,
          title: node.title,
          properties: node.properties || {},
        },
      );

      return this.recordToNode(result.records[0], node.type);
    } finally {
      await session.close();
    }
  }

  /**
   * Create or update a relationship
   */
  async upsertRelationship(rel: GraphRelationship): Promise<boolean> {
    const session = this.getSession();
    if (!session) return false;

    try {
      await session.run(
        `
        MATCH (from {id: $fromId})
        MATCH (to {id: $toId})
        MERGE (from)-[r:${rel.type}]->(to)
        SET r += $properties,
            r.updatedAt = datetime()
        RETURN r
        `,
        {
          fromId: rel.fromId,
          toId: rel.toId,
          properties: rel.properties || {},
        },
      );

      return true;
    } catch (error: any) {
      this.logger.error(`Failed to create relationship: ${error.message}`);
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete a node and all its relationships
   */
  async deleteNode(id: string): Promise<boolean> {
    const session = this.getSession();
    if (!session) return false;

    try {
      await session.run(
        `
        MATCH (n {id: $id})
        DETACH DELETE n
        `,
        { id },
      );

      return true;
    } finally {
      await session.close();
    }
  }

  /**
   * Get a node by ID
   */
  async getNode(id: string): Promise<GraphNode | null> {
    const session = this.getSession();
    if (!session) return null;

    try {
      const result = await session.run(
        `
        MATCH (n {id: $id})
        RETURN n, labels(n) as labels
        `,
        { id },
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      const labels = record.get('labels') as string[];
      const type = labels.find((l) =>
        Object.values(NodeType).includes(l as NodeType),
      ) as NodeType;

      return this.recordToNode(record, type);
    } finally {
      await session.close();
    }
  }

  /**
   * Find all nodes related to a given node
   */
  async getRelatedNodes(
    id: string,
    relationTypes?: RelationType[],
    direction: 'incoming' | 'outgoing' | 'both' = 'both',
  ): Promise<GraphNode[]> {
    const session = this.getSession();
    if (!session) return [];

    try {
      const relationFilter = relationTypes
        ? `:${relationTypes.join('|')}`
        : '';

      let pattern: string;
      switch (direction) {
        case 'incoming':
          pattern = `(related)-[r${relationFilter}]->(n)`;
          break;
        case 'outgoing':
          pattern = `(n)-[r${relationFilter}]->(related)`;
          break;
        default:
          pattern = `(n)-[r${relationFilter}]-(related)`;
      }

      const result = await session.run(
        `
        MATCH (n {id: $id})
        MATCH ${pattern}
        RETURN DISTINCT related, labels(related) as labels
        `,
        { id },
      );

      return result.records.map((record) => {
        const labels = record.get('labels') as string[];
        const type = labels.find((l) =>
          Object.values(NodeType).includes(l as NodeType),
        ) as NodeType;
        return this.recordToNode(record, type, 'related')!;
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get full traceability path between two nodes
   */
  async getTraceabilityPath(
    fromId: string,
    toId: string,
    maxDepth = 5,
  ): Promise<TraceabilityPath | null> {
    const session = this.getSession();
    if (!session) return null;

    try {
      const result = await session.run(
        `
        MATCH path = shortestPath((from {id: $fromId})-[*1..${maxDepth}]-(to {id: $toId}))
        RETURN nodes(path) as nodes, relationships(path) as rels
        `,
        { fromId, toId },
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      const nodes = record.get('nodes') as any[];
      const rels = record.get('rels') as any[];

      return {
        nodes: nodes.map((n) => ({
          id: n.properties.id,
          type: n.labels[0] as NodeType,
          externalId: n.properties.externalId,
          title: n.properties.title,
          properties: n.properties,
        })),
        relationships: rels.map((r) => ({
          type: r.type as RelationType,
          fromId: r.startNodeElementId,
          toId: r.endNodeElementId,
          properties: r.properties,
        })),
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Find all test cases for a requirement
   */
  async getTestsForRequirement(requirementId: string): Promise<GraphNode[]> {
    return this.getRelatedNodes(requirementId, [RelationType.TESTS], 'incoming');
  }

  /**
   * Find all requirements affected by a bug
   */
  async getRequirementsAffectedByBug(bugId: string): Promise<GraphNode[]> {
    return this.getRelatedNodes(bugId, [RelationType.AFFECTS], 'outgoing');
  }

  /**
   * Find all code implementing a requirement
   */
  async getCodeForRequirement(requirementId: string): Promise<GraphNode[]> {
    return this.getRelatedNodes(
      requirementId,
      [RelationType.IMPLEMENTS],
      'incoming',
    );
  }

  /**
   * Get impact analysis - what would be affected if a node changes
   */
  async getImpactAnalysis(
    id: string,
    maxDepth = 3,
  ): Promise<Map<NodeType, GraphNode[]>> {
    const session = this.getSession();
    if (!session) return new Map();

    try {
      const result = await session.run(
        `
        MATCH (start {id: $id})
        MATCH (start)-[*1..${maxDepth}]->(affected)
        RETURN affected, labels(affected) as labels
        `,
        { id },
      );

      const impactMap = new Map<NodeType, GraphNode[]>();

      for (const record of result.records) {
        const labels = record.get('labels') as string[];
        const type = labels.find((l) =>
          Object.values(NodeType).includes(l as NodeType),
        ) as NodeType;

        const node = this.recordToNode(record, type, 'affected')!;

        if (!impactMap.has(type)) {
          impactMap.set(type, []);
        }
        impactMap.get(type)!.push(node);
      }

      return impactMap;
    } finally {
      await session.close();
    }
  }

  /**
   * Get coverage statistics
   */
  async getCoverageStats(): Promise<{
    totalRequirements: number;
    coveredRequirements: number;
    totalTestCases: number;
    totalBugs: number;
    openBugs: number;
  }> {
    const session = this.getSession();
    if (!session) {
      return {
        totalRequirements: 0,
        coveredRequirements: 0,
        totalTestCases: 0,
        totalBugs: 0,
        openBugs: 0,
      };
    }

    try {
      const result = await session.run(`
        MATCH (r:Requirement)
        WITH count(r) as totalReqs

        MATCH (r:Requirement)<-[:TESTS]-(:TestCase)
        WITH totalReqs, count(DISTINCT r) as coveredReqs

        MATCH (t:TestCase)
        WITH totalReqs, coveredReqs, count(t) as totalTests

        MATCH (b:Bug)
        WITH totalReqs, coveredReqs, totalTests, count(b) as totalBugs

        MATCH (ob:Bug) WHERE ob.status <> 'closed'
        RETURN totalReqs, coveredReqs, totalTests, totalBugs, count(ob) as openBugs
      `);

      if (result.records.length === 0) {
        return {
          totalRequirements: 0,
          coveredRequirements: 0,
          totalTestCases: 0,
          totalBugs: 0,
          openBugs: 0,
        };
      }

      const record = result.records[0];
      return {
        totalRequirements: record.get('totalReqs')?.toNumber() || 0,
        coveredRequirements: record.get('coveredReqs')?.toNumber() || 0,
        totalTestCases: record.get('totalTests')?.toNumber() || 0,
        totalBugs: record.get('totalBugs')?.toNumber() || 0,
        openBugs: record.get('openBugs')?.toNumber() || 0,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Sync a document to the graph
   */
  async syncDocument(
    doc: {
      id: string;
      externalId: string;
      type: string;
      title: string;
      sourceId: string;
      metadata?: Record<string, any>;
    },
  ): Promise<void> {
    // Map document type to node type
    const typeMap: Record<string, NodeType> = {
      requirement: NodeType.REQUIREMENT,
      test_case: NodeType.TEST_CASE,
      code: NodeType.CODE,
      issue: NodeType.BUG,
      pr: NodeType.CODE,
      wiki: NodeType.DOCUMENT,
      feature: NodeType.FEATURE,
    };

    const nodeType = typeMap[doc.type] || NodeType.DOCUMENT;

    // Create the document node
    await this.upsertNode({
      id: doc.id,
      type: nodeType,
      externalId: doc.externalId,
      title: doc.title,
      properties: doc.metadata,
    });

    // Create relationship to source
    await this.upsertRelationship({
      type: RelationType.FROM_SOURCE,
      fromId: doc.id,
      toId: doc.sourceId,
    });
  }

  /**
   * Check connection status
   */
  isHealthy(): boolean {
    return this.isConnected;
  }

  private recordToNode(
    record: Neo4jRecord,
    type: NodeType,
    key = 'n',
  ): GraphNode | null {
    const node = record.get(key);
    if (!node) return null;

    return {
      id: node.properties.id,
      type,
      externalId: node.properties.externalId,
      title: node.properties.title,
      properties: node.properties,
    };
  }
}
