import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  GraphService,
  GraphNode,
  NodeType,
  RelationType,
} from './graph.service';

class CreateNodeDto {
  id!: string;
  type!: NodeType;
  externalId?: string;
  title!: string;
  properties?: Record<string, any>;
}

class CreateRelationshipDto {
  type!: RelationType;
  fromId!: string;
  toId!: string;
  properties?: Record<string, any>;
}

@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  /**
   * Health check for graph database
   */
  @Get('health')
  getHealth() {
    return {
      connected: this.graphService.isHealthy(),
      service: 'neo4j',
    };
  }

  /**
   * Get coverage statistics
   */
  @Get('stats/coverage')
  async getCoverageStats() {
    return this.graphService.getCoverageStats();
  }

  /**
   * Create or update a node
   */
  @Post('nodes')
  async createNode(@Body() dto: CreateNodeDto): Promise<GraphNode | null> {
    return this.graphService.upsertNode(dto);
  }

  /**
   * Get a node by ID
   */
  @Get('nodes/:id')
  async getNode(@Param('id') id: string): Promise<GraphNode | null> {
    return this.graphService.getNode(id);
  }

  /**
   * Delete a node
   */
  @Delete('nodes/:id')
  async deleteNode(@Param('id') id: string) {
    const success = await this.graphService.deleteNode(id);
    return { success };
  }

  /**
   * Get related nodes
   */
  @Get('nodes/:id/related')
  async getRelatedNodes(
    @Param('id') id: string,
    @Query('types') types?: string,
    @Query('direction') direction?: 'incoming' | 'outgoing' | 'both',
  ): Promise<GraphNode[]> {
    const relationTypes = types
      ? (types.split(',') as RelationType[])
      : undefined;
    return this.graphService.getRelatedNodes(
      id,
      relationTypes,
      direction || 'both',
    );
  }

  /**
   * Create a relationship
   */
  @Post('relationships')
  async createRelationship(@Body() dto: CreateRelationshipDto) {
    const success = await this.graphService.upsertRelationship(dto);
    return { success };
  }

  /**
   * Get traceability path between two nodes
   */
  @Get('traceability/path')
  async getTraceabilityPath(
    @Query('from') fromId: string,
    @Query('to') toId: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    return this.graphService.getTraceabilityPath(
      fromId,
      toId,
      maxDepth ? parseInt(maxDepth, 10) : 5,
    );
  }

  /**
   * Get impact analysis for a node
   */
  @Get('traceability/impact/:id')
  async getImpactAnalysis(
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    const impactMap = await this.graphService.getImpactAnalysis(
      id,
      maxDepth ? parseInt(maxDepth, 10) : 3,
    );

    // Convert Map to object for JSON response
    const result: Record<string, GraphNode[]> = {};
    impactMap.forEach((nodes, type) => {
      result[type] = nodes;
    });

    return result;
  }

  /**
   * Get tests for a requirement
   */
  @Get('traceability/requirement/:id/tests')
  async getTestsForRequirement(
    @Param('id') id: string,
  ): Promise<GraphNode[]> {
    return this.graphService.getTestsForRequirement(id);
  }

  /**
   * Get requirements affected by a bug
   */
  @Get('traceability/bug/:id/requirements')
  async getRequirementsAffectedByBug(
    @Param('id') id: string,
  ): Promise<GraphNode[]> {
    return this.graphService.getRequirementsAffectedByBug(id);
  }

  /**
   * Get code implementing a requirement
   */
  @Get('traceability/requirement/:id/code')
  async getCodeForRequirement(@Param('id') id: string): Promise<GraphNode[]> {
    return this.graphService.getCodeForRequirement(id);
  }
}
