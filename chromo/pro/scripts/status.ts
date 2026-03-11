import { ChromoCore } from './core';
import { stat, readdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export async function showStatus() {
  const core = new ChromoCore();
  
  try {
    console.log('📊 Chromo Status - History Overview\n');
    
    // Get metadata
    const metadata = core['getMetadata']();
    const checkpoints = await core['listCheckpoints']();
    
    // Current branch and HEAD
    console.log('🏷️  Current State:');
    console.log(`   Branch: ${chalk.cyan(metadata.currentBranch)}`);
    if (metadata.headCheckpointId) {
      console.log(`   HEAD: ${chalk.green(metadata.headCheckpointId)}`);
    } else {
      console.log(`   HEAD: ${chalk.gray('(none - no snapshots yet)')}`);
    }
    console.log('');
    
    // Checkpoint statistics
    console.log('📈 Checkpoint Statistics:');
    console.log(`   Total checkpoints: ${chalk.yellow(checkpoints.length)}`);
    
    if (checkpoints.length > 0) {
      const oldest = checkpoints[checkpoints.length - 1];
      const newest = checkpoints[0];
      
      const timeSpan = newest.timestamp - oldest.timestamp;
      const days = Math.floor(timeSpan / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeSpan % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      console.log(`   Time span: ${days} days, ${hours} hours`);
      console.log(`   Oldest: ${new Date(oldest.timestamp).toLocaleString()}`);
      console.log(`   Newest: ${new Date(newest.timestamp).toLocaleString()}`);
      
      // Branch statistics
      const branches = new Set(checkpoints.map(cp => cp.branch));
      console.log(`   Branches: ${branches.size}`);
    }
    console.log('');
    
    // Disk usage
    console.log('💾 Disk Usage:');
    const usage = await calculateDiskUsage(core);
    console.log(`   History directory: ${chalk.cyan(formatBytes(usage.total))}`);
    console.log(`   Database: ${chalk.cyan(formatBytes(usage.database))}`);
    console.log(`   Blobs: ${chalk.cyan(formatBytes(usage.blobs))}`);
    console.log(`   Metadata: ${chalk.cyan(formatBytes(usage.metadata))}`);
    console.log('');
    
    // Unsaved changes
    const hasUnsaved = await core['hasUnsavedChanges']();
    console.log('📝 Working Directory:');
    console.log(`   Unsaved changes: ${hasUnsaved ? chalk.red('Yes ⚠️') : chalk.green('No ✓')}`);
    if (hasUnsaved) {
      console.log('   💡 Run "chromo snapshot" to save your changes');
    }
    console.log('');
    
    // Recent activity
    console.log('🕒 Recent Activity:');
    const recent = checkpoints.slice(0, 5);
    if (recent.length === 0) {
      console.log('   No recent activity');
    } else {
      for (const cp of recent) {
        const timeAgo = getTimeAgo(cp.timestamp);
        const message = cp.message || cp.intent || 'No message';
        console.log(`   ${chalk.green(cp.id)} ${chalk.gray(timeAgo)} - ${message}`);
      }
    }
    console.log('');
    
    // Health indicators
    console.log('🏥 Health Indicators:');
    const health = await checkHealth(core);
    console.log(`   Database integrity: ${health.database ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`   Blob consistency: ${health.blobs ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`   Parent relationships: ${health.parents ? chalk.green('✓') : chalk.red('✗')}`);
    
    if (!health.database || !health.blobs || !health.parents) {
      console.log(`\n⚠️  Issues detected! Run "${chalk.cyan('chromo check')}" for details.`);
    } else {
      console.log(`\n🎉 All systems healthy!`);
    }
    
  } catch (error) {
    console.error('Error showing status:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

async function calculateDiskUsage(core: ChromoCore): Promise<{
  total: number;
  database: number;
  blobs: number;
  metadata: number;
}> {
  const historyDir = core['historyDir'];
  const blobsDir = core['blobsDir'];
  
  let total = 0;
  let database = 0;
  let blobs = 0;
  let metadata = 0;
  let calculationError = false;
  
  try {
    // Database file
    const dbPath = join(historyDir, 'index.db');
    try {
      const dbStat = await stat(dbPath);
      database = dbStat.size;
      total += database;
    } catch (dbError) {
      calculationError = true;
    }
    
    // Blobs directory
    try {
      const blobFiles = await readdir(blobsDir);
      for (const file of blobFiles) {
        try {
          const filePath = join(blobsDir, file);
          const fileStat = await stat(filePath);
          blobs += fileStat.size;
        } catch (fileError) {
          // Skip files we can't access
        }
      }
      total += blobs;
    } catch (blobsError) {
      calculationError = true;
    }
    
    // Other metadata files
    const ignoreFile = join(historyDir, '.chromoignore');
    try {
      const ignoreStat = await stat(ignoreFile);
      metadata += ignoreStat.size;
    } catch (ignoreError) {
      // Ignore file doesn't exist - this is OK
    }
    total += metadata;
    
  } catch (error) {
    calculationError = true;
  }
  
  if (calculationError) {
    console.warn('Warning: Could not calculate disk usage completely');
  }
  
  return { total, database, blobs, metadata };
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

async function checkHealth(core: ChromoCore): Promise<{
  database: boolean;
  blobs: boolean;
  parents: boolean;
}> {
  const db = core['db'];
  let database = true;
  let blobs = true;
  let parents = true;
  
  try {
    // Quick database check
    const checkpointCount = db.query('SELECT COUNT(*) as count FROM checkpoints').get() as any;
    if (typeof checkpointCount.count !== 'number') {
      database = false;
    }
    
    // Quick blob check (sample)
    const chunkCount = db.query('SELECT COUNT(*) as count FROM chunks LIMIT 100').get() as any;
    if (typeof chunkCount.count !== 'number') {
      blobs = false;
    }
    
    // Quick parent check
    const orphans = db.query(`
      SELECT COUNT(*) as count FROM checkpoints c
      WHERE c.parent_id IS NOT NULL AND c.parent_id != 'root'
      AND NOT EXISTS (SELECT 1 FROM checkpoints p WHERE p.id = c.parent_id)
    `).get() as any;
    
    if (orphans.count > 0) {
      parents = false;
    }
    
  } catch {
    database = false;
    blobs = false;
    parents = false;
  }
  
  return { database, blobs, parents };
}
