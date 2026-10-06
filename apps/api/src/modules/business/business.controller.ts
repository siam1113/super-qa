import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  BusinessService,
  CreateBusinessItemDto,
  CreateRelationshipDto,
} from './business.service';
import { BusinessItemType, VerificationStatus } from './entities/business-item.entity';

@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  // ============ Business Items ============

  @Get('items')
  async findAll(
    @Query('type') type?: BusinessItemType,
    @Query('sourceId') sourceId?: string,
    @Query('tags') tags?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tagArray = tags ? tags.split(',') : undefined;
    const result = await this.businessService.findAll(
      type,
      sourceId,
      tagArray,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return {
      items: result.items.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        description: item.description,
        content: item.content,
        confidence: item.confidence,
        verificationStatus: item.verificationStatus,
        tags: item.tags,
        metadata: item.metadata,
        sourceId: item.sourceId,
        documentId: item.documentId,
        externalId: item.externalId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      total: result.total,
    };
  }

  @Get('items/by-type/:type')
  async findByType(@Param('type') type: BusinessItemType) {
    const items = await this.businessService.findByType(type);
    return items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      confidence: item.confidence,
      tags: item.tags,
      updatedAt: item.updatedAt,
    }));
  }

  @Get('items/:id')
  async findOne(@Param('id') id: string) {
    const item = await this.businessService.findOne(id);
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      content: item.content,
      confidence: item.confidence,
      verificationStatus: item.verificationStatus,
      tags: item.tags,
      metadata: item.metadata,
      sourceId: item.sourceId,
      documentId: item.documentId,
      source: item.source ? { id: item.source.id, name: item.source.name, type: item.source.type } : null,
      document: item.document ? { id: item.document.id, title: item.document.title, url: item.document.url, type: item.document.type } : null,
      externalId: item.externalId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      outgoingRelationships: item.outgoingRelationships?.map((rel) => ({
        id: rel.id,
        type: rel.type,
        toItemId: rel.toItemId,
        description: rel.description,
      })),
      incomingRelationships: item.incomingRelationships?.map((rel) => ({
        id: rel.id,
        type: rel.type,
        fromItemId: rel.fromItemId,
        description: rel.description,
      })),
    };
  }

  @Post('items')
  async create(@Body() dto: CreateBusinessItemDto) {
    const item = await this.businessService.create(dto);
    return {
      id: item.id,
      type: item.type,
      name: item.name,
    };
  }

  @Patch('items/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateBusinessItemDto>,
  ) {
    const item = await this.businessService.update(id, dto);
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      updatedAt: item.updatedAt,
    };
  }

  @Patch('items/:id/verification')
  async updateVerificationStatus(
    @Param('id') id: string,
    @Body('status') status: VerificationStatus,
  ) {
    const item = await this.businessService.updateVerificationStatus(id, status);
    return {
      id: item.id,
      verificationStatus: item.verificationStatus,
      confidence: item.confidence,
      updatedAt: item.updatedAt,
    };
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.businessService.delete(id);
  }

  // ============ Search ============

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('types') types?: string,
  ) {
    const typeArray = types
      ? (types.split(',') as BusinessItemType[])
      : undefined;
    const items = await this.businessService.search(query, typeArray);
    return items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      confidence: item.confidence,
    }));
  }

  @Get('items/:id/related')
  async getRelatedItems(
    @Param('id') id: string,
    @Query('depth') depth?: string,
  ) {
    const items = await this.businessService.getRelatedItems(
      id,
      depth ? parseInt(depth, 10) : 2,
    );
    return items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
    }));
  }

  // ============ Relationships ============

  @Get('items/:id/relationships')
  async getRelationships(
    @Param('id') id: string,
    @Query('direction') direction?: 'incoming' | 'outgoing' | 'both',
  ) {
    const relationships = await this.businessService.findRelationships(
      id,
      direction || 'both',
    );
    return relationships.map((rel) => ({
      id: rel.id,
      type: rel.type,
      fromItem: rel.fromItem
        ? {
            id: rel.fromItem.id,
            type: rel.fromItem.type,
            name: rel.fromItem.name,
          }
        : null,
      toItem: rel.toItem
        ? {
            id: rel.toItem.id,
            type: rel.toItem.type,
            name: rel.toItem.name,
          }
        : null,
      description: rel.description,
    }));
  }

  @Post('relationships')
  async createRelationship(@Body() dto: CreateRelationshipDto) {
    const rel = await this.businessService.createRelationship(dto);
    return {
      id: rel.id,
      type: rel.type,
      fromItemId: rel.fromItemId,
      toItemId: rel.toItemId,
    };
  }

  @Delete('relationships/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRelationship(@Param('id') id: string) {
    await this.businessService.deleteRelationship(id);
  }

  // ============ Statistics ============

  @Get('stats')
  async getStats() {
    const [byType, bySource] = await Promise.all([
      this.businessService.getStatsByType(),
      this.businessService.getStatsBySource(),
    ]);
    return {
      byType,
      bySource,
      total: Object.values(byType).reduce((sum, count) => sum + count, 0),
    };
  }

  @Get('stats/by-type')
  async getStatsByType() {
    return this.businessService.getStatsByType();
  }

  @Get('stats/by-source')
  async getStatsBySource() {
    return this.businessService.getStatsBySource();
  }
}
