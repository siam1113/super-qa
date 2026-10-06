import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  BusinessItem,
  BusinessItemType,
  BusinessRelationship,
  RelationshipType,
  BusinessItemContent,
  ConfidenceLevel,
  VerificationStatus,
} from './entities/business-item.entity';
import { GraphService, NodeType, RelationType } from '../graph/graph.service';

export interface CreateBusinessItemDto {
  type: BusinessItemType;
  name: string;
  description?: string;
  content?: BusinessItemContent;
  confidence?: ConfidenceLevel;
  tags?: string[];
  metadata?: Record<string, any>;
  sourceId?: string;
  documentId?: string;
  externalId?: string;
}

export interface CreateRelationshipDto {
  type: RelationshipType;
  fromItemId: string;
  toItemId: string;
  description?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    @InjectRepository(BusinessItem)
    private businessItemRepository: Repository<BusinessItem>,
    @InjectRepository(BusinessRelationship)
    private relationshipRepository: Repository<BusinessRelationship>,
    private graphService: GraphService,
  ) {}

  // ============ Business Items ============

  async findAll(
    type?: BusinessItemType,
    sourceId?: string,
    tags?: string[],
    limit = 50,
    offset = 0,
  ): Promise<{ items: BusinessItem[]; total: number }> {
    const query = this.businessItemRepository.createQueryBuilder('item');

    if (type) {
      query.andWhere('item.type = :type', { type });
    }
    if (sourceId) {
      query.andWhere('item.sourceId = :sourceId', { sourceId });
    }
    if (tags && tags.length > 0) {
      // Check if any of the tags match
      query.andWhere('item.tags && :tags', { tags });
    }

    query.orderBy('item.updatedAt', 'DESC');
    query.take(limit);
    query.skip(offset);

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async findByType(type: BusinessItemType): Promise<BusinessItem[]> {
    return this.businessItemRepository.find({
      where: { type },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<BusinessItem> {
    const item = await this.businessItemRepository.findOne({
      where: { id },
      relations: ['source', 'document', 'outgoingRelationships', 'incomingRelationships'],
    });
    if (!item) {
      throw new NotFoundException(`Business item with ID ${id} not found`);
    }
    return item;
  }

  async findByExternalId(externalId: string, sourceId: string): Promise<BusinessItem | null> {
    return this.businessItemRepository.findOne({
      where: { externalId, sourceId },
    });
  }

  async create(dto: CreateBusinessItemDto): Promise<BusinessItem> {
    const item = this.businessItemRepository.create({
      ...dto,
      tags: dto.tags || [],
      confidence: dto.confidence || 'inferred',
    });

    const saved = await this.businessItemRepository.save(item);

    // Sync to graph
    await this.syncToGraph(saved);

    return saved;
  }

  async upsert(dto: CreateBusinessItemDto): Promise<BusinessItem> {
    // Check if item exists by externalId + sourceId or by name + type + sourceId
    let existing: BusinessItem | null = null;

    if (dto.externalId && dto.sourceId) {
      existing = await this.findByExternalId(dto.externalId, dto.sourceId);
    }

    if (!existing && dto.sourceId) {
      existing = await this.businessItemRepository.findOne({
        where: {
          name: dto.name,
          type: dto.type,
          sourceId: dto.sourceId,
        },
      });
    }

    if (existing) {
      // Update existing
      Object.assign(existing, dto);
      const saved = await this.businessItemRepository.save(existing);
      await this.syncToGraph(saved);
      return saved;
    }

    return this.create(dto);
  }

  async update(id: string, updates: Partial<CreateBusinessItemDto>): Promise<BusinessItem> {
    const item = await this.findOne(id);
    Object.assign(item, updates);
    const saved = await this.businessItemRepository.save(item);
    await this.syncToGraph(saved);
    return saved;
  }

  async updateVerificationStatus(
    id: string,
    status: VerificationStatus,
  ): Promise<BusinessItem> {
    const item = await this.findOne(id);
    item.verificationStatus = status;

    // If verified, boost confidence to high (if not already)
    if (status === 'verified' && item.confidence === 'inferred') {
      item.confidence = 'high';
    }

    // If rejected, set confidence to low
    if (status === 'rejected') {
      item.confidence = 'low';
    }

    const saved = await this.businessItemRepository.save(item);
    await this.syncToGraph(saved);

    this.logger.log(
      `Updated verification status for item ${id} to ${status}`,
    );

    return saved;
  }

  async delete(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.businessItemRepository.remove(item);
    await this.graphService.deleteNode(id);
  }

  async deleteBySource(sourceId: string): Promise<number> {
    const result = await this.businessItemRepository.delete({ sourceId });
    return result.affected || 0;
  }

  // ============ Relationships ============

  async createRelationship(dto: CreateRelationshipDto): Promise<BusinessRelationship> {
    // Verify both items exist
    await this.findOne(dto.fromItemId);
    await this.findOne(dto.toItemId);

    const relationship = this.relationshipRepository.create(dto);
    const saved = await this.relationshipRepository.save(relationship);

    // Sync to graph
    await this.graphService.upsertRelationship({
      type: this.mapRelationshipType(dto.type),
      fromId: dto.fromItemId,
      toId: dto.toItemId,
      properties: { businessRelationType: dto.type },
    });

    return saved;
  }

  async findRelationships(
    itemId: string,
    direction: 'incoming' | 'outgoing' | 'both' = 'both',
  ): Promise<BusinessRelationship[]> {
    const query = this.relationshipRepository.createQueryBuilder('rel');

    if (direction === 'incoming') {
      query.where('rel.toItemId = :itemId', { itemId });
    } else if (direction === 'outgoing') {
      query.where('rel.fromItemId = :itemId', { itemId });
    } else {
      query.where('rel.fromItemId = :itemId OR rel.toItemId = :itemId', { itemId });
    }

    query.leftJoinAndSelect('rel.fromItem', 'fromItem');
    query.leftJoinAndSelect('rel.toItem', 'toItem');

    return query.getMany();
  }

  async deleteRelationship(id: string): Promise<void> {
    await this.relationshipRepository.delete(id);
  }

  // ============ Search & Discovery ============

  async search(query: string, types?: BusinessItemType[]): Promise<BusinessItem[]> {
    const qb = this.businessItemRepository.createQueryBuilder('item');

    qb.where(
      '(item.name ILIKE :query OR item.description ILIKE :query)',
      { query: `%${query}%` },
    );

    if (types && types.length > 0) {
      qb.andWhere('item.type IN (:...types)', { types });
    }

    qb.orderBy('item.confidence', 'DESC');
    qb.addOrderBy('item.updatedAt', 'DESC');
    qb.take(50);

    return qb.getMany();
  }

  async getRelatedItems(itemId: string, maxDepth = 2): Promise<BusinessItem[]> {
    // Get all related items up to maxDepth
    const visited = new Set<string>();
    const result: BusinessItem[] = [];

    const traverse = async (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);

      const relationships = await this.findRelationships(id, 'both');

      for (const rel of relationships) {
        const relatedId = rel.fromItemId === id ? rel.toItemId : rel.fromItemId;
        if (!visited.has(relatedId)) {
          const item = await this.businessItemRepository.findOne({ where: { id: relatedId } });
          if (item) {
            result.push(item);
            await traverse(relatedId, depth + 1);
          }
        }
      }
    };

    await traverse(itemId, 0);
    return result;
  }

  // ============ Statistics ============

  async getStatsByType(): Promise<Record<BusinessItemType, number>> {
    const result = await this.businessItemRepository
      .createQueryBuilder('item')
      .select('item.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('item.type')
      .getRawMany();

    const stats: Record<string, number> = {};
    for (const row of result) {
      stats[row.type] = parseInt(row.count, 10);
    }
    return stats as Record<BusinessItemType, number>;
  }

  async getStatsBySource(): Promise<Array<{ sourceId: string; count: number }>> {
    return this.businessItemRepository
      .createQueryBuilder('item')
      .select('item.sourceId', 'sourceId')
      .addSelect('COUNT(*)', 'count')
      .where('item.sourceId IS NOT NULL')
      .groupBy('item.sourceId')
      .getRawMany();
  }

  // ============ Graph Sync ============

  private async syncToGraph(item: BusinessItem): Promise<void> {
    try {
      const nodeType = this.mapItemTypeToNodeType(item.type);

      await this.graphService.upsertNode({
        id: item.id,
        type: nodeType,
        externalId: item.externalId || undefined,
        title: item.name,
        properties: {
          businessType: item.type,
          confidence: item.confidence,
          tags: item.tags,
          ...item.metadata,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to sync business item to graph: ${error.message}`);
    }
  }

  private mapItemTypeToNodeType(type: BusinessItemType): NodeType {
    const mapping: Partial<Record<BusinessItemType, NodeType>> = {
      // Product
      flow: NodeType.FEATURE,
      fact: NodeType.DOCUMENT,
      entity: NodeType.DOCUMENT,
      rule: NodeType.REQUIREMENT,
      state: NodeType.DOCUMENT,
      permission: NodeType.DOCUMENT,
      integration: NodeType.SOURCE,
      constraint: NodeType.REQUIREMENT,
      configuration: NodeType.DOCUMENT,
      terminology: NodeType.DOCUMENT,
      // Technical
      api: NodeType.CODE,
      code: NodeType.CODE,
      architecture: NodeType.DOCUMENT,
      database: NodeType.DOCUMENT,
      // Quality
      test_case: NodeType.TEST_CASE,
      requirement: NodeType.REQUIREMENT,
      defect: NodeType.BUG,
      // Automation
      dom: NodeType.DOCUMENT,
      locator: NodeType.DOCUMENT,
      action: NodeType.CODE,
      data_setup: NodeType.DOCUMENT,
      auth: NodeType.DOCUMENT,
    };
    return mapping[type] || NodeType.DOCUMENT;
  }

  private mapRelationshipType(type: RelationshipType): RelationType {
    const mapping: Record<RelationshipType, RelationType> = {
      references: RelationType.REFERENCES,
      implements: RelationType.IMPLEMENTS,
      depends_on: RelationType.DEPENDS_ON,
      part_of: RelationType.PART_OF,
      triggers: RelationType.REFERENCES,
      validates: RelationType.TESTS,
      contradicts: RelationType.REFERENCES,
      supersedes: RelationType.REFERENCES,
      related_to: RelationType.REFERENCES,
    };
    return mapping[type] || RelationType.REFERENCES;
  }
}
