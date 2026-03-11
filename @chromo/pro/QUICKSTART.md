# Chromo Quick Start Guide

## Installation

```bash
# Install dependencies
bun install

# Build executable
bun build index.ts --compile --outfile chromo

# Or run directly
bun run index.ts --help
```

## Basic Usage

### Create a Snapshot

```bash
# Create a snapshot with a message
bun run index.ts snapshot -m "Added login feature"

# Create snapshot with auto intent detection
bun run index.ts snapshot --auto

# Snapshot all files in current directory
bun run index.ts snapshot --all
```

### Restore from Snapshot

```bash
# Restore a snapshot
bun run index.ts restore <checkpoint-id>

# Restore specific lines only
bun run index.ts restore <checkpoint-id> --partial 5,10,15

# Force restore without confirmation
bun run index.ts restore <checkpoint-id> --force
```

### Browse History

```bash
# Open TUI browser
bun run index.ts browse

# Enable time-travel mode
bun run index.ts browse --time-travel
```

### View Differences

```bash
# Show diff between two checkpoints
bun run index.ts diff <from-id> <to-id>

# Show diff between checkpoint and current state
bun run index.ts diff <from-id>
```

### Search History

```bash
# Search for text
bun run index.ts search "login logic"

# Search in specific files
bun run index.ts search "bug" --file "*.ts"
```

### Cleanup

```bash
# Show what would be deleted
bun run index.ts cleanup --dry-run

# Actually cleanup old snapshots
bun run index.ts cleanup
```

### Daemon Mode

```bash
# Start file watching daemon
bun run index.ts daemon

# Run in background
bun run index.ts daemon --background
```

### Remote Sync

```bash
# Configure remote
export CHROMO_REMOTE="s3://my-bucket/chromo"

# Push to remote
bun run index.ts sync --push

# Pull from remote
bun run index.ts sync --pull
```

## Project Structure

```
chromo/
├── index.ts              # Main CLI entry point
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── scripts/
│   ├── core.ts           # Block-level deduplication
│   ├── virtual-fs.ts     # Virtual filesystem layer
│   ├── intent.ts         # Intent engine
│   ├── daemon.ts         # File watching daemon
│   ├── indexer.ts        # SQLite database & search
│   ├── compressor.ts     # Background compression
│   ├── diff-engine.ts    # Delta calculations
│   ├── janitor.ts        # Smart pruning
│   ├── teleport.ts       # Remote sync
│   ├── snapshot.ts       # Create checkpoint
│   ├── restore.ts        # Restore checkpoint
│   └── browse.ts         # TUI browser
└── .chromo/              # History directory (created on first run)
    ├── index.db          # SQLite database
    └── blobs/            # Deduplicated chunks
```

## Key Features

1. **Block-Level Deduplication**: Only stores changed chunks (64KB blocks)
2. **Intent Engine**: Auto-generates meaningful checkpoint descriptions
3. **Virtual Filesystem**: Mount checkpoints as directories
4. **Smart Pruning**: Intelligent retention policy
5. **Cold Storage**: Auto-compress old checkpoints
6. **Ghost Diffs**: Visual change heatmaps
7. **Process Ghosting**: Remember running processes
8. **Env-Sync**: Track environment variables

## Building for Production

```bash
# Build single executable
bun build index.ts --compile --outfile chromo

# Make executable (Linux/Mac)
chmod +x chromo

# Move to PATH
sudo mv chromo /usr/local/bin/
```

## Tips

- Use `--auto` flag for automatic intent detection
- Run daemon in background for continuous protection
- Use `--dry-run` before cleanup to see what will be deleted
- Configure remote storage for backup and collaboration
- Use time-travel mode to inspect past states without restoring

## Troubleshooting

If you encounter database errors, delete the `.chromo` directory and start fresh:

```bash
rm -rf .chromo
bun run index.ts snapshot -m "Fresh start"
```
