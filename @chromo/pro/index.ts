#!/usr/bin/env bun
import { Command } from 'commander';
import { createSnapshot } from './scripts/snapshot';
import { restoreSnapshot } from './scripts/restore';
import { startDaemon } from './scripts/daemon';
import { browseHistory } from './scripts/browse';
import { syncRemote } from './scripts/teleport';
import { cleanupHistory } from './scripts/janitor';
import { showDiff } from './scripts/diff-engine';
import { searchHistory } from './scripts/indexer';
import { showGraph, showLog } from './scripts/graph';
import { pruneHistory } from './scripts/prune';
import { optimizeDatabase } from './scripts/optimize';
import { manageIgnores } from './scripts/ignore';
import { checkIntegrity } from './scripts/check';
import { showStatus } from './scripts/status';
import { resetHistory } from './scripts/reset';
import { showStats } from './scripts/stats';

const program = new Command();

program
  .name('chromo')
  .description('Powerful checkpoint tools with block-level deduplication and undo tree')
  .version('1.0.0');

// Core commands
program
  .command('snapshot')
  .description('Create a new checkpoint')
  .option('-m, --message <message>', 'Add a message to the snapshot')
  .option('-a, --all', 'Include all files in the current directory')
  .option('--auto', 'Automatic snapshot with intent detection')
  .action(createSnapshot);

program
  .command('restore')
  .description('Restore from a checkpoint (creates new branch if going to past)')
  .argument('<id>', 'Checkpoint ID to restore')
  .option('-p, --partial <lines>', 'Restore specific lines only')
  .option('-f, --force', 'Force restore without confirmation')
  .action(restoreSnapshot);

program
  .command('browse')
  .description('Browse history with TUI interface')
  .option('-t, --time-travel', 'Enable time-travel mode')
  .action(browseHistory);

// System commands
program
  .command('daemon')
  .description('Start the chromo daemon for file watching')
  .option('-b, --background', 'Run in background')
  .action(startDaemon);

program
  .command('sync')
  .description('Sync with remote storage')
  .option('--push', 'Push local history to remote')
  .option('--pull', 'Pull remote history to local')
  .action(syncRemote);

program
  .command('cleanup')
  .description('Clean up old snapshots')
  .option('--dry-run', 'Show what would be deleted')
  .action(cleanupHistory);

// Utility commands
program
  .command('diff')
  .description('Show diff between checkpoints')
  .argument('<from>', 'From checkpoint ID')
  .argument('[to]', 'To checkpoint ID (default: current state)')
  .action(showDiff);

program
  .command('search')
  .description('Search through history')
  .argument('<query>', 'Search query')
  .option('--file <pattern>', 'Search in specific files')
  .action(searchHistory);

// Undo Tree commands
program
  .command('graph')
  .description('Show the undo tree visualization')
  .action(showGraph);

program
  .command('log')
  .description('Show checkpoint history with parent relationships')
  .action(showLog);

// Management commands
program
  .command('prune')
  .description('Intelligently merge redundant snapshots to reduce history size')
  .option('--dry-run', 'Show what would be pruned without actually doing it')
  .option('--aggressive', 'Be more aggressive in pruning (merge more checkpoints)')
  .action(pruneHistory);

program
  .command('optimize')
  .description('Optimize database and compress blobs to reduce storage')
  .option('--compress-blobs', 'Compress text blobs with Brotli')
  .option('--vacuum-db', 'Run VACUUM on SQLite database')
  .option('--deduplicate', 'Re-scan for duplicate chunks')
  .action(optimizeDatabase);

program
  .command('ignore')
  .description('Manage files and directories to exclude from snapshots')
  .argument('[pattern]', 'Pattern to add/remove (use --remove to remove)')
  .option('--list', 'List current ignore patterns')
  .option('--remove', 'Remove the specified pattern')
  .option('--suggest', 'Suggest patterns to ignore based on large directories')
  .option('--add <pattern>', 'Add a pattern to ignore')
  .action(manageIgnores);

program
  .command('check')
  .description('Verify integrity of checkpoints and blobs')
  .option('--deep', 'Perform deep integrity check (slower but more thorough)')
  .option('--fix', 'Attempt to fix any issues found')
  .action(checkIntegrity);

program
  .command('status')
  .description('Show quick overview of history status and disk usage')
  .action(showStatus);

program
  .command('stats')
  .description('Show advanced data-heavy statistics and code density')
  .option('--id <hash>', 'Compare a past snapshot against current state')
  .option('--exclude-blank', 'Exclude blank lines from code line counts')
  .option('--author <name>', 'Forensic author view + current workspace health')
  .action(showStats);

// Reset commands
program
  .command('reset')
  .description('Reset history with different archive strategies')
  .option('--soft', 'Archive current history to zip and start fresh (safe)')
  .option('--hard', 'Permanently delete all history (dangerous)')
  .option('--clear-blobs', 'Keep database but delete old blob files (dangerous)')
  .action(resetHistory);

program.parse();
