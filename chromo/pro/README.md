# Chromo - Powerful Checkpoint Tools

> Advanced checkpoint management with block-level deduplication, time-travel, and intelligent recovery

## 🌟 Features

### Core Architecture
- **Block-Level Deduplication**: Store only changed chunks, not entire files
- **Virtual Filesystem Layer**: Mount checkpoints as if they were live directories
- **Intent Engine**: Automatic intelligent tagging using local analysis (LLM-ready)

### God-Tier Features
- **Time-Travel & Recovery**: Point-in-time scrubbing with TUI interface
- **Omen (Pre-emptive Snapshot)**: Auto-detect dangerous commands and snapshot before execution
- **Partial Restore**: Restore specific lines from past versions
- **Env-Sync**: Track .env files and environment variables
- **Dependency Locking**: Snapshot node_modules dependency state
- **Process Ghosting**: Remember running processes at checkpoint time
- **Cold Storage Offloading**: Auto-compress and move old checkpoints
- **Ghost Diffs**: Visual heatmap of file changes
- **Zero-Copy Clones**: Reflink support on APFS/Btrfs

## 🚀 Installation

```bash
# Install dependencies
bun install

# Build the executable
bun build index.ts --compile --outfile chromo

# Or run directly with bun
bun run index.ts --help
```

## 📖 Usage

### Basic Commands

```bash
# Create a snapshot
chromo snapshot
chromo snapshot -m "Added login feature"
chromo snapshot --auto  # Auto-generate intent

# Restore from a checkpoint
chromo restore <checkpoint-id>
chromo restore <checkpoint-id> --partial 5,10,15  # Restore specific lines

# Browse history with TUI
chromo browse
chromo browse --time-travel  # Enable time-travel mode

# Show diff between checkpoints
chromo diff <from-id> [to-id]

# Search through history
chromo search "login logic"
chromo search "bug fix" --file "*.ts"

# Cleanup old snapshots
chromo cleanup
chromo cleanup --dry-run
```

### Daemon Mode

```bash
# Start the file watching daemon
chromo daemon

# Run in background
chromo daemon --background
```

### Remote Sync

```bash
# Push to remote storage
chromo sync --push

# Pull from remote storage
chromo sync --pull

# Configure remote
export CHROMO_REMOTE="s3://my-bucket/chromo"
export CHROMO_REMOTE="rsync://user@host:/path/to/chromo"
```

## 🏗️ Architecture

### Scripts Organization

| Script | Responsibility |
|--------|---------------|
| `daemon.ts` | High-speed file watching using Bun's native watch |
| `indexer.ts` | Manages SQLite index.db, handles full-text search |
| `compressor.ts` | Background Zstd compression of old blobs |
| `diff-engine.ts` | Calculates deltas for visual feedback |
| `janitor.ts` | Smart pruning with decay strategy |
| `teleport.ts` | Push/pull .history to remote servers |
| `core.ts` | Block-level deduplication system |
| `virtual-fs.ts` | Virtual filesystem layer for mounting |
| `intent.ts` | Intent engine for automatic tagging |
| `snapshot.ts` | Create checkpoint logic |
| `restore.ts` | Restore checkpoint logic |
| `browse.ts` | TUI history browser |

### Smart Decay Strategy

The janitor uses intelligent retention:
- Keep every minute for 1 hour
- Keep every hour for 1 day
- Keep every day for 1 week
- Keep every week for 1 month
- After 7 days: offload to cold storage

### Block-Level Deduplication

Files are split into 64KB chunks, each hashed with SHA-256:
- Only new chunks are stored
- Reference counting enables efficient cleanup
- Enables tracking 1GB databases with minimal overhead

## 🔧 Configuration

### Environment Variables

```bash
CHROMO_REMOTE="s3://bucket/path"  # Remote storage location
CHROMO_HISTORY_DIR=".chromo"       # History directory (default)
CHROMO_CHUNK_SIZE=65536            # Chunk size in bytes (default 64KB)
```

### Compression

Old blobs are automatically compressed after 7 days using Zstd:
- Configurable compression level (default: 6)
- Background compression runs every 60 minutes
- Significant space savings with fast decompression

## 🎯 Use Cases

### Development
- Quick rollback when experiments fail
- Track what changed between deployments
- Recover from accidental deletions

### Data Science
- Snapshot large datasets efficiently
- Track model training states
- Compare experiment results

### System Administration
- Pre-emptive snapshots before risky operations
- Track configuration changes
- Quick disaster recovery

## 🔮 Future Enhancements

- [ ] Full LLM integration for intent detection
- [ ] FUSE-based filesystem mounting
- [ ] Web UI for browsing history
- [ ] Collaboration features
- [ ] Cloud-native storage backends
- [ ] Advanced diff visualization
- [ ] Git integration
- [ ] Plugin system

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines.

## 🙏 Acknowledgments

Built with Bun for maximum performance and efficiency.
