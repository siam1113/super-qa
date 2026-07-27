import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as crypto from 'crypto';

export interface StoredFile {
  key: string;
  bucket: string;
  url: string;
  size: number;
  contentType: string;
  checksum: string;
}

export interface FileMetadata {
  sourceId?: string;
  documentId?: string;
  originalName: string;
  contentType: string;
  [key: string]: any;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private bucket: string;
  private endpoint: string;

  constructor(private configService: ConfigService) {
    this.endpoint = this.configService.get('S3_ENDPOINT') || 'http://localhost:9000';
    this.bucket = this.configService.get('S3_BUCKET') || 'qa-agent-files';

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region: this.configService.get('S3_REGION') || 'us-east-1',
      credentials: {
        accessKeyId: this.configService.get('S3_ACCESS_KEY') || 'qaagent',
        secretAccessKey: this.configService.get('S3_SECRET_KEY') || 'qaagent123',
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket '${this.bucket}' exists`);
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        this.logger.log(`Creating bucket '${this.bucket}'...`);
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket '${this.bucket}' created`);
      } else {
        this.logger.warn(`Could not check bucket: ${error.message}`);
      }
    }
  }

  /**
   * Upload a file from buffer
   */
  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    metadata: FileMetadata,
  ): Promise<StoredFile> {
    const key = this.generateKey(filename, metadata);
    const checksum = this.computeChecksum(buffer);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: metadata.contentType,
        Metadata: {
          originalName: metadata.originalName,
          checksum,
          sourceId: metadata.sourceId || '',
          documentId: metadata.documentId || '',
        },
      }),
    );

    return {
      key,
      bucket: this.bucket,
      url: this.getFileUrl(key),
      size: buffer.length,
      contentType: metadata.contentType,
      checksum,
    };
  }

  /**
   * Upload a file from stream (for large files)
   */
  async uploadStream(
    stream: Readable,
    filename: string,
    metadata: FileMetadata,
    size?: number,
  ): Promise<StoredFile> {
    const key = this.generateKey(filename, metadata);

    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: metadata.contentType,
        Metadata: {
          originalName: metadata.originalName,
          sourceId: metadata.sourceId || '',
          documentId: metadata.documentId || '',
        },
      },
    });

    await upload.done();

    // Get the actual size after upload
    const head = await this.getFileInfo(key);

    return {
      key,
      bucket: this.bucket,
      url: this.getFileUrl(key),
      size: head?.size || size || 0,
      contentType: metadata.contentType,
      checksum: '',
    };
  }

  /**
   * Download a file as buffer
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Get a readable stream for a file
   */
  async downloadStream(key: string): Promise<Readable> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return response.Body as Readable;
  }

  /**
   * Delete a file
   */
  async deleteFile(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * Delete all files with a given prefix (e.g., all files for a source)
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    const files = await this.listFiles(prefix);
    let count = 0;

    for (const file of files) {
      await this.deleteFile(file.key);
      count++;
    }

    return count;
  }

  /**
   * Get file info
   */
  async getFileInfo(key: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    metadata: Record<string, string>;
  } | null> {
    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        metadata: response.Metadata || {},
      };
    } catch {
      return null;
    }
  }

  /**
   * List files with optional prefix
   */
  async listFiles(
    prefix?: string,
    maxKeys = 1000,
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    const response = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    );

    return (response.Contents || []).map((item) => ({
      key: item.Key || '',
      size: item.Size || 0,
      lastModified: item.LastModified || new Date(),
    }));
  }

  /**
   * Check if a file exists
   */
  async fileExists(key: string): Promise<boolean> {
    const info = await this.getFileInfo(key);
    return info !== null;
  }

  /**
   * Generate a unique key for a file
   */
  private generateKey(filename: string, metadata: FileMetadata): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = filename.split('.').pop() || '';
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

    if (metadata.sourceId) {
      return `sources/${metadata.sourceId}/${timestamp}-${random}-${safeName}`;
    }
    if (metadata.documentId) {
      return `documents/${metadata.documentId}/${timestamp}-${random}-${safeName}`;
    }
    return `uploads/${timestamp}-${random}-${safeName}`;
  }

  /**
   * Get the public URL for a file
   */
  private getFileUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  /**
   * Compute MD5 checksum of a buffer
   */
  private computeChecksum(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }
}
