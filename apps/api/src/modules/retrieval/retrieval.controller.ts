import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { RetrievalService } from './retrieval.service';

class SearchDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sourceIds: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentTypes?: string[];

  @IsOptional()
  @IsNumber()
  minSimilarity?: number;
}

class QueryDto extends SearchDto {
  @IsOptional()
  @IsNumber()
  maxTokens?: number;
}

class ResolveCitationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sourceIds: string[];

  @IsString()
  documentId: string;

  @IsString()
  chunkId: string;

  @IsString()
  revisionHash: string;
}

@Controller('retrieval')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post('search')
  async search(@Body() searchDto: SearchDto) {
    const results = await this.retrievalService.search(searchDto.query, {
      limit: searchDto.limit,
      sourceIds: searchDto.sourceIds,
      documentTypes: searchDto.documentTypes,
      minSimilarity: searchDto.minSimilarity,
    });

    return {
      query: searchDto.query,
      results: results.chunks,
      totalResults: results.chunks.length,
    };
  }

  @Post('query')
  async query(@Body() queryDto: QueryDto) {
    const evidence = await this.retrievalService.getEvidence(
      queryDto.query,
      queryDto.maxTokens,
      queryDto,
    );

    return {
      query: queryDto.query,
      context: evidence.context,
      citations: evidence.chunks.map(chunk => chunk.citation),
      omittedChunks: evidence.omittedChunks || 0,
      status: evidence.chunks.length ? 'evidence' : evidence.omittedChunks ? 'budget_exhausted' : 'no_evidence',
    };
  }

  @Post('resolve')
  async resolve(@Body() request: ResolveCitationDto) {
    return this.retrievalService.resolveCitation(request.documentId, request.chunkId, request.revisionHash, { sourceIds: request.sourceIds });
  }

  @Get('search')
  async searchGet(@Query('q') query: string, @Query('limit') limit?: string, @Query('sourceIds') sourceIds?: string) {
    if (!query) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const results = await this.retrievalService.search(query, {
      limit: limit ? Number(limit) : undefined,
      sourceIds: sourceIds?.split(','),
    });

    return {
      query,
      results: results.chunks,
      totalResults: results.chunks.length,
    };
  }
}
