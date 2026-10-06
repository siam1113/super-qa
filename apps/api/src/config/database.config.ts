import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'qaagent',
  password: process.env.DATABASE_PASSWORD || 'qaagent123',
  database: process.env.DATABASE_NAME || 'qaagent',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV !== 'production',
  extra: {
    // Set query timeout to prevent long-running queries from hanging the server
    // Value is in milliseconds. 0 means no timeout.
    statement_timeout: parseInt(
      process.env.DATABASE_QUERY_TIMEOUT || '30000',
      10,
    ),
    // Additional connection pool settings for stability
    max: 20, // Maximum number of clients in the pool
    connectionTimeoutMillis: 10000, // 10 seconds to acquire connection
  },
};
