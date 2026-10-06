// Global test setup
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set default timeout for all tests
jest.setTimeout(30000);

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
