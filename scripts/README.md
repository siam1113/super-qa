# Utility Scripts

This directory contains utility scripts for managing the QA Agent application.

## cleanup-context.ts

A powerful script to clean up business items (context) from the database with various filtering options.

### Prerequisites

Make sure you have installed dependencies:
```bash
npm install
```

### Usage

```bash
npm run cleanup:context -- [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview what would be deleted without actually deleting anything |
| `--verification-status <status>` | Delete items by verification status (`unverified`, `verified`, or `rejected`) |
| `--confidence <level>` | Delete items by confidence level (`high`, `medium`, `low`, or `inferred`) |
| `--type <type>` | Delete items by type (e.g., `flow`, `fact`, `entity`, `rule`, etc.) |
| `--source-id <id>` | Delete items from a specific source |
| `--all` | Delete ALL business items (⚠️ use with caution!) |
| `--rejected-only` | Delete only rejected items |
| `--unverified-low` | Delete unverified items with low or inferred confidence |

### Examples

#### Preview rejected items (safe - won't delete)
```bash
npm run cleanup:context -- --dry-run --rejected-only
```

#### Delete all rejected items
```bash
npm run cleanup:context -- --rejected-only
```

#### Delete unverified items with low confidence
```bash
npm run cleanup:context -- --unverified-low
```

#### Delete items by specific type
```bash
npm run cleanup:context -- --type flow --dry-run  # Preview first
npm run cleanup:context -- --type flow             # Actually delete
```

#### Delete items by confidence level
```bash
npm run cleanup:context -- --confidence inferred
```

#### Delete items by verification status
```bash
npm run cleanup:context -- --verification-status unverified
```

#### Delete items from a specific source
```bash
npm run cleanup:context -- --source-id abc-123-def
```

#### Delete ALL items (dangerous!)
```bash
npm run cleanup:context -- --all
```

### Safety Features

1. **Dry Run Mode**: Always use `--dry-run` first to preview what would be deleted
2. **Statistics Display**: Shows detailed breakdown of items to be deleted
3. **Confirmation Prompt**: Requires typing "yes" before actually deleting
4. **Transaction Safety**: All deletions happen in a database transaction
5. **Relationship Cleanup**: Automatically cleans up related relationships

### What Gets Deleted

The script will:
- Delete the business items matching your criteria
- Delete all relationships (incoming and outgoing) for those items
- Show before/after statistics

### Environment Variables

The script uses the same database configuration as the API:

```bash
DATABASE_HOST=localhost      # Default
DATABASE_PORT=5432          # Default
DATABASE_USER=qaagent       # Default
DATABASE_PASSWORD=qaagent123 # Default
DATABASE_NAME=qaagent       # Default
```

You can override these in your `.env` file or environment.

### Common Workflows

#### Clean up AI-generated items that haven't been verified
```bash
# See what would be deleted
npm run cleanup:context -- --dry-run --unverified-low

# Delete them
npm run cleanup:context -- --unverified-low
```

#### Remove all rejected items
```bash
# Preview
npm run cleanup:context -- --dry-run --rejected-only

# Execute
npm run cleanup:context -- --rejected-only
```

#### Reset context for a specific source
```bash
# Get the source ID from the database or API
npm run cleanup:context -- --source-id <your-source-id>
```

#### Nuclear option - delete everything
```bash
# ⚠️ WARNING: This deletes ALL business items!
npm run cleanup:context -- --dry-run --all  # Preview first!
npm run cleanup:context -- --all            # Only if you're absolutely sure
```

### Tips

- **Always use `--dry-run` first** to see what will be deleted
- The script shows detailed statistics before deletion
- You can combine multiple criteria (e.g., `--type flow --confidence low`)
- Deletion is permanent - there's no undo!
- The script will display sample items during dry-run mode

### Troubleshooting

**Connection Error**: Make sure your database is running and the connection details are correct.

**Permission Error**: Ensure your database user has DELETE permissions.

**No items to delete**: The criteria you specified doesn't match any items in the database.
