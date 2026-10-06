#!/usr/bin/env ts-node
/**
 * Context Cleanup Script
 *
 * This script helps clean up business items (context) from the database.
 * It supports various filtering criteria and provides dry-run mode for safety.
 *
 * Usage:
 *   npm run cleanup:context -- [options]
 *
 * Options:
 *   --dry-run              Show what would be deleted without actually deleting
 *   --verification-status  Delete items by verification status (unverified|verified|rejected)
 *   --confidence          Delete items by confidence level (high|medium|low|inferred)
 *   --type                Delete items by type (flow|fact|entity|rule|etc)
 *   --source-id           Delete items from specific source
 *   --all                 Delete ALL business items (use with caution!)
 *   --rejected-only       Delete only rejected items
 *   --unverified-low      Delete unverified items with low/inferred confidence
 *
 * Examples:
 *   # Dry run - see what would be deleted
 *   npm run cleanup:context -- --dry-run --rejected-only
 *
 *   # Delete all rejected items
 *   npm run cleanup:context -- --rejected-only
 *
 *   # Delete unverified items with low confidence
 *   npm run cleanup:context -- --unverified-low
 *
 *   # Delete items by specific type
 *   npm run cleanup:context -- --type flow
 *
 *   # Delete all items (DANGEROUS!)
 *   npm run cleanup:context -- --all
 */

import { DataSource } from 'typeorm';
import * as readline from 'readline';

// Database configuration
const DB_CONFIG = {
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'qaagent',
  password: process.env.DATABASE_PASSWORD || 'qaagent123',
  database: process.env.DATABASE_NAME || 'qaagent',
};

interface CleanupOptions {
  dryRun: boolean;
  yes?: boolean;
  verificationStatus?: 'unverified' | 'verified' | 'rejected';
  confidence?: 'high' | 'medium' | 'low' | 'inferred';
  type?: string;
  sourceId?: string;
  all?: boolean;
  rejectedOnly?: boolean;
  unverifiedLow?: boolean;
}

interface BusinessItem {
  id: string;
  type: string;
  name: string;
  confidence: string;
  verificationStatus: string;
  sourceId?: string;
  createdAt: Date;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes') || args.includes('-y'),
  };

  const verificationIndex = args.indexOf('--verification-status');
  if (verificationIndex !== -1 && args[verificationIndex + 1]) {
    options.verificationStatus = args[verificationIndex + 1] as any;
  }

  const confidenceIndex = args.indexOf('--confidence');
  if (confidenceIndex !== -1 && args[confidenceIndex + 1]) {
    options.confidence = args[confidenceIndex + 1] as any;
  }

  const typeIndex = args.indexOf('--type');
  if (typeIndex !== -1 && args[typeIndex + 1]) {
    options.type = args[typeIndex + 1];
  }

  const sourceIndex = args.indexOf('--source-id');
  if (sourceIndex !== -1 && args[sourceIndex + 1]) {
    options.sourceId = args[sourceIndex + 1];
  }

  options.all = args.includes('--all');
  options.rejectedOnly = args.includes('--rejected-only');
  options.unverifiedLow = args.includes('--unverified-low');

  return options;
}

async function getItemsToDelete(
  dataSource: DataSource,
  options: CleanupOptions
): Promise<BusinessItem[]> {
  let query = dataSource
    .createQueryBuilder()
    .select([
      'id',
      'type',
      'name',
      'confidence',
      '"verificationStatus"',
      '"sourceId"',
      '"createdAt"',
    ])
    .from('business_items', 'item');

  // Apply filters
  if (options.rejectedOnly) {
    query = query.where('"verificationStatus" = :status', { status: 'rejected' });
  } else if (options.unverifiedLow) {
    query = query.where(
      '("verificationStatus" = :status AND ("confidence" = :conf1 OR "confidence" = :conf2))',
      { status: 'unverified', conf1: 'low', conf2: 'inferred' }
    );
  } else {
    // Custom filters
    const conditions: string[] = [];
    const parameters: any = {};

    if (options.verificationStatus) {
      conditions.push('"verificationStatus" = :verificationStatus');
      parameters.verificationStatus = options.verificationStatus;
    }

    if (options.confidence) {
      conditions.push('"confidence" = :confidence');
      parameters.confidence = options.confidence;
    }

    if (options.type) {
      conditions.push('type = :type');
      parameters.type = options.type;
    }

    if (options.sourceId) {
      conditions.push('"sourceId" = :sourceId');
      parameters.sourceId = options.sourceId;
    }

    if (conditions.length > 0) {
      query = query.where(conditions.join(' AND '), parameters);
    } else if (!options.all) {
      console.log('\n⚠️  No filter criteria specified. Use --all to delete everything.');
      return [];
    }
  }

  const items = await query.getRawMany();
  return items;
}

async function displayStats(
  dataSource: DataSource,
  items: BusinessItem[]
): Promise<void> {
  console.log('\n📊 Items to be deleted:');
  console.log('━'.repeat(60));
  console.log(`Total: ${items.length} items\n`);

  // Group by type
  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  const byVerification: Record<string, number> = {};

  items.forEach((item) => {
    byType[item.type] = (byType[item.type] || 0) + 1;
    byConfidence[item.confidence] = (byConfidence[item.confidence] || 0) + 1;
    byVerification[item.verificationStatus] = (byVerification[item.verificationStatus] || 0) + 1;
  });

  console.log('By Type:');
  Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(20)} ${count}`);
    });

  console.log('\nBy Confidence:');
  Object.entries(byConfidence).forEach(([conf, count]) => {
    console.log(`  ${conf.padEnd(20)} ${count}`);
  });

  console.log('\nBy Verification Status:');
  Object.entries(byVerification).forEach(([status, count]) => {
    console.log(`  ${status.padEnd(20)} ${count}`);
  });

  console.log('━'.repeat(60));

  // Show current database stats
  const totalCount = await dataSource
    .createQueryBuilder()
    .select('COUNT(*)', 'count')
    .from('business_items', 'item')
    .getRawOne();

  console.log(`\n📈 Current database: ${totalCount.count} total items`);
  console.log(`📉 After deletion: ${totalCount.count - items.length} items will remain\n`);
}

async function deleteItems(
  dataSource: DataSource,
  items: BusinessItem[]
): Promise<void> {
  if (items.length === 0) {
    console.log('✨ No items to delete.');
    return;
  }

  const itemIds = items.map((item) => item.id);

  // Delete in transaction
  await dataSource.transaction(async (manager) => {
    // Delete relationships first (foreign key constraints)
    await manager
      .createQueryBuilder()
      .delete()
      .from('business_relationships')
      .where('"fromItemId" IN (:...ids)', { ids: itemIds })
      .orWhere('"toItemId" IN (:...ids)', { ids: itemIds })
      .execute();

    // Delete business items
    await manager
      .createQueryBuilder()
      .delete()
      .from('business_items')
      .where('id IN (:...ids)', { ids: itemIds })
      .execute();
  });

  console.log(`✅ Successfully deleted ${items.length} items and their relationships.`);
}

async function main() {
  console.log('🧹 Context Cleanup Script\n');

  const options = parseArgs();

  // Validate options
  if (!options.dryRun && !options.all && !options.rejectedOnly && !options.unverifiedLow) {
    if (!options.verificationStatus && !options.confidence && !options.type && !options.sourceId) {
      console.log('❌ Error: No cleanup criteria specified.');
      console.log('\nPlease specify one of:');
      console.log('  --all                Delete all items');
      console.log('  --rejected-only      Delete rejected items');
      console.log('  --unverified-low     Delete unverified items with low/inferred confidence');
      console.log('  --verification-status <status>');
      console.log('  --confidence <level>');
      console.log('  --type <type>');
      console.log('  --source-id <id>');
      console.log('\nAdd --dry-run to preview without deleting.');
      process.exit(1);
    }
  }

  // Connect to database
  console.log('📡 Connecting to database...');
  const dataSource = new DataSource({
    ...DB_CONFIG,
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database\n');

    // Get items to delete
    const items = await getItemsToDelete(dataSource, options);

    if (items.length === 0) {
      console.log('✨ No items match the criteria.');
      await dataSource.destroy();
      rl.close();
      return;
    }

    // Display statistics
    await displayStats(dataSource, items);

    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - Nothing will be deleted.\n');
      console.log('Sample items:');
      items.slice(0, 5).forEach((item, idx) => {
        console.log(`  ${idx + 1}. [${item.type}] ${item.name}`);
        console.log(`     Confidence: ${item.confidence}, Status: ${item.verificationStatus}`);
      });
      if (items.length > 5) {
        console.log(`  ... and ${items.length - 5} more items\n`);
      }
      console.log('💡 Remove --dry-run to actually delete these items.');
    } else {
      // Confirm deletion
      if (options.yes) {
        console.log('⚠️  Skipping confirmation (--yes flag provided)\n');
        console.log('🗑️  Deleting items...');
        await deleteItems(dataSource, items);
      } else {
        console.log('⚠️  WARNING: This will permanently delete these items!\n');
        const answer = await askQuestion('Are you sure? Type "yes" to confirm: ');

        if (answer.toLowerCase() === 'yes') {
          console.log('\n🗑️  Deleting items...');
          await deleteItems(dataSource, items);
        } else {
          console.log('\n❌ Deletion cancelled.');
        }
      }
    }

    await dataSource.destroy();
    rl.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await dataSource.destroy();
    rl.close();
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
