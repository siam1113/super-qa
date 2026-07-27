import {
  Controller,
  Post,
  Body,
  Get,
  Query,
} from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsArray } from 'class-validator';
import { RetrievalService } from './retrieval.service';

class SearchDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentTypes?: string[];

  @IsOptional()
  @IsNumber()
  minSimilarity?: number;
}

class QueryDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  maxTokens?: number;
}

@Controller('retrieval')
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
    const context = await this.retrievalService.getContext(
      queryDto.query,
      queryDto.maxTokens,
    );

    return {
      query: queryDto.query,
      context,
    };
  }

  @Get('search')
  async searchGet(@Query('q') query: string, @Query('limit') limit?: string) {
    if (!query) {
      return { error: 'Query parameter "q" is required' };
    }

    const results = await this.retrievalService.search(query, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return {
      query,
      results: results.chunks,
      totalResults: results.chunks.length,
    };
  }
}
