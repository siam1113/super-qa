import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  StreamableFile,
  Res,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { StorageService } from './storage.service';

// Multer file interface
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface UploadDto {
  key?: string;
  metadata?: string;
}

interface UploadResponse {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

interface UrlResponse {
  url: string;
  key: string;
  expiresIn?: number;
}

@Controller('storage')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Upload a file to storage.
   * Used by the Python TraceStorageClient for screenshots, traces, and logs.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: MulterFile,
    @Body() body: UploadDto,
  ): Promise<UploadResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Parse metadata if provided
    let metadata: Record<string, any> = {};
    if (body.metadata) {
      try {
        metadata = JSON.parse(body.metadata);
      } catch {
        this.logger.warn('Invalid metadata JSON, using empty object');
      }
    }

    // Use provided key or generate one
    const key = body.key || this.generateTraceKey(file.originalname, metadata);

    const result = await this.storageService.uploadBuffer(file.buffer, file.originalname, {
      originalName: file.originalname,
      contentType: file.mimetype,
      ...metadata,
    });

    this.logger.log(`Uploaded file: ${result.key} (${result.size} bytes)`);

    return {
      key: result.key,
      url: result.url,
      size: result.size,
      contentType: result.contentType,
    };
  }

  /**
   * Download a file from storage.
   * Returns the file content directly.
   */
  @Get('download')
  async download(
    @Query('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!key) {
      throw new BadRequestException('Key parameter is required');
    }

    const info = await this.storageService.getFileInfo(key);
    if (!info) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    const stream = await this.storageService.downloadStream(key);

    res.set({
      'Content-Type': info.contentType,
      'Content-Length': info.size,
      'Content-Disposition': `attachment; filename="${this.getFilename(key)}"`,
    });

    return new StreamableFile(stream);
  }

  /**
   * Get file content as JSON (for trace files).
   */
  @Get('json')
  async getJson(@Query('key') key: string): Promise<any> {
    if (!key) {
      throw new BadRequestException('Key parameter is required');
    }

    const info = await this.storageService.getFileInfo(key);
    if (!info) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    const buffer = await this.storageService.downloadBuffer(key);
    const content = buffer.toString('utf-8');

    try {
      return JSON.parse(content);
    } catch {
      throw new BadRequestException('File is not valid JSON');
    }
  }

  /**
   * Get a direct URL for a file.
   * For MinIO, this returns the public URL.
   */
  @Get('url')
  async getUrl(@Query('key') key: string): Promise<UrlResponse> {
    if (!key) {
      throw new BadRequestException('Key parameter is required');
    }

    const info = await this.storageService.getFileInfo(key);
    if (!info) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    // For MinIO with public bucket, return direct URL
    // In production, you'd generate a presigned URL
    const url = await this.buildFileUrl(key);

    return {
      url,
      key,
    };
  }

  /**
   * Delete a file from storage.
   */
  @Delete('delete')
  async delete(@Query('key') key: string): Promise<{ success: boolean; key: string }> {
    if (!key) {
      throw new BadRequestException('Key parameter is required');
    }

    const exists = await this.storageService.fileExists(key);
    if (!exists) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    await this.storageService.deleteFile(key);
    this.logger.log(`Deleted file: ${key}`);

    return { success: true, key };
  }

  /**
   * List files with optional prefix.
   * Useful for listing all traces for a test.
   */
  @Get('list')
  async list(
    @Query('prefix') prefix?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    files: Array<{ key: string; size: number; lastModified: string }>;
    count: number;
  }> {
    const maxKeys = limit ? parseInt(limit, 10) : 100;
    const files = await this.storageService.listFiles(prefix, maxKeys);

    return {
      files: files.map((f) => ({
        key: f.key,
        size: f.size,
        lastModified: f.lastModified.toISOString(),
      })),
      count: files.length,
    };
  }

  /**
   * Get file info without downloading.
   */
  @Get('info')
  async info(@Query('key') key: string): Promise<{
    key: string;
    size: number;
    contentType: string;
    lastModified: string;
    metadata: Record<string, string>;
  }> {
    if (!key) {
      throw new BadRequestException('Key parameter is required');
    }

    const info = await this.storageService.getFileInfo(key);
    if (!info) {
      throw new NotFoundException(`File not found: ${key}`);
    }

    return {
      key,
      size: info.size,
      contentType: info.contentType,
      lastModified: info.lastModified.toISOString(),
      metadata: info.metadata,
    };
  }

  /**
   * Generate a key for trace files.
   */
  private generateTraceKey(filename: string, metadata: Record<string, any>): string {
    const timestamp = Date.now();
    const testId = metadata.testId || 'unknown';
    const type = metadata.type || 'file';

    // Determine prefix based on type
    let prefix = 'uploads';
    if (type === 'screenshot' || filename.endsWith('.png')) {
      prefix = 'screenshots';
    } else if (type === 'trace' || filename.includes('trace')) {
      prefix = 'traces';
    } else if (type === 'console_logs' || type === 'network_log') {
      prefix = 'logs';
    }

    return `${prefix}/${testId}/${timestamp}-${filename}`;
  }

  /**
   * Build the public URL for a file.
   */
  private async buildFileUrl(key: string): Promise<string> {
    // For MinIO, construct direct URL
    // In production, use presigned URLs
    const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
    const bucket = process.env.S3_BUCKET || 'qa-agent-files';
    return `${endpoint}/${bucket}/${key}`;
  }

  /**
   * Extract filename from storage key.
   */
  private getFilename(key: string): string {
    const parts = key.split('/');
    return parts[parts.length - 1] || 'download';
  }
}
