import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  async findAll(
    @Query('sourceId') sourceId?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { documents, total } = await this.documentsService.findAll(
      sourceId,
      type,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );

    return {
      documents: documents.map((doc) => ({
        id: doc.id,
        sourceId: doc.sourceId,
        externalId: doc.externalId,
        type: doc.type,
        title: doc.title,
        url: doc.url,
        metadata: doc.metadata,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
      total,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const doc = await this.documentsService.findOne(id);
    return {
      id: doc.id,
      sourceId: doc.sourceId,
      externalId: doc.externalId,
      type: doc.type,
      title: doc.title,
      content: doc.content,
      url: doc.url,
      metadata: doc.metadata,
      chunks: doc.chunks?.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
      })),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
