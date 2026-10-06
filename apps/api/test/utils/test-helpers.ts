import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Repository, DataSource } from 'typeorm';

export class TestHelpers {
  /**
   * Create a test database connection
   */
  static createTestDatabaseConfig() {
    return TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'ultimate_qa_test',
      entities: [__dirname + '/../../src/**/*.entity{.ts,.js}'],
      synchronize: true, // Auto-create tables in test environment
      dropSchema: false, // Don't drop schema between tests
      logging: false,
    });
  }

  /**
   * Create a test Redis/Bull queue configuration
   */
  static createTestQueueConfig() {
    return BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: 1, // Use a different Redis DB for tests
      },
    });
  }

  /**
   * Clean up all data from repositories
   */
  static async cleanDatabase(dataSource: DataSource): Promise<void> {
    const tables = dataSource.entityMetadatas
      .map(({ tablePath }) => `"${tablePath.split('.').map(part => part.replace(/"/g, '""')).join('"."')}"`)
      .join(', ');
    if (tables) await dataSource.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  }

  /**
   * Wait for a condition to be true
   */
  static async waitFor(
    condition: () => Promise<boolean>,
    timeout = 10000,
    interval = 100,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.sleep(interval);
    }

    throw new Error('Timeout waiting for condition');
  }

  /**
   * Sleep for a given duration
   */
  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a mock queue for testing
   */
  static createMockQueue() {
    return {
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      process: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      clean: jest.fn(),
      empty: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      getJobs: jest.fn().mockResolvedValue([]),
      getJob: jest.fn().mockResolvedValue(null),
    };
  }
}
