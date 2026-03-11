import { ChromoCore } from './core';
import { stat } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export async function pruneHistory(options: any) {
  const core = new ChromoCore();
  
  try {
    console.log('🧹 Chromo Prune - Intelligent History Cleanup\n');
    
    const checkpoints = await core['listCheckpoints']();
    if (checkpoints.length === 0) {
      console.log('No checkpoints to prune.');
      return;
    }
    
    // Analyze checkpoints for redundancy
    const redundantGroups = await analyzeRedundancy(core, checkpoints);
    
    if (redundantGroups.length === 0) {
      console.log('No redundant checkpoints found. Your history is already optimal!');
      return;
    }
    
    console.log(`Found ${redundantGroups.length} groups of redundant checkpoints:`);
    
    let totalToPrune = 0;
    let totalSpaceSaved = 0;
    
    for (const group of redundantGroups) {
      console.log(`\n📦 Group: ${group.description}`);
      console.log(`   ${group.checkpoints.length} checkpoints can be merged into 1`);
      
      for (const cp of group.checkpoints) {
        const time = new Date(cp.timestamp).toLocaleTimeString();
        console.log(`   ${chalk.gray('├─')} ${cp.id} (${time}) - ${cp.message || cp.intent}`);
      }
      
      console.log(`   ${chalk.green('└─')} Will keep: ${group.keepId}`);
      console.log(`   ${chalk.yellow('   Space savings: ~${group.spaceSavings}KB')}`);
      
      totalToPrune += group.checkpoints.length - 1;
      totalSpaceSaved += group.spaceSavings;
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ${chalk.yellow(totalToPrune)} checkpoints will be removed`);
    console.log(`   ${chalk.green(totalSpaceSaved)}KB estimated space savings`);
    
    if (options.dryRun) {
      console.log(`\n${chalk.blue('💡 This is a dry run. Use --aggressive for more pruning or run without --dry-run to apply.')}`);
      return;
    }
    
    // Apply pruning
    console.log('\n🚀 Applying prune...');
    
    for (const group of redundantGroups) {
      await mergeCheckpointGroup(core, group);
    }
    
    console.log(`\n✅ Pruning complete!`);
    console.log(`   Removed ${totalToPrune} redundant checkpoints`);
    console.log(`   Estimated space saved: ${totalSpaceSaved}KB`);
    
  } catch (error) {
    console.error('Error during pruning:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

interface RedundantGroup {
  checkpoints: any[];
  keepId: string;
  description: string;
  spaceSavings: number;
}

async function analyzeRedundancy(core: ChromoCore, checkpoints: any[]): Promise<RedundantGroup[]> {
  const groups: RedundantGroup[] = [];
  
  // Group checkpoints by time windows (e.g., checkpoints within 5 minutes)
  const timeWindowMs = 5 * 60 * 1000; // 5 minutes
  const groupedByTime = new Map<number, any[]>();
  
  for (const cp of checkpoints) {
    const windowStart = Math.floor(cp.timestamp / timeWindowMs) * timeWindowMs;
    if (!groupedByTime.has(windowStart)) {
      groupedByTime.set(windowStart, []);
    }
    groupedByTime.get(windowStart)!.push(cp);
  }
  
  // Analyze each time window for redundancy
  for (const [windowStart, windowCheckpoints] of groupedByTime) {
    if (windowCheckpoints.length < 3) continue; // Need at least 3 to consider pruning
    
    // Sort by timestamp
    windowCheckpoints.sort((a, b) => a.timestamp - b.timestamp);
    
    // Look for checkpoints with small changes
    let groupStart = 0;
    let groupSize = 1;
    
    for (let i = 1; i < windowCheckpoints.length; i++) {
      const prevCp = windowCheckpoints[i - 1];
      const currCp = windowCheckpoints[i];
      
      // Check if this is a small change (few files, small total size)
      const changeSize = await estimateChangeSize(core, prevCp.id, currCp.id);
      
      if (changeSize < 1024 * 10) { // Less than 10KB total change
        groupSize++;
      } else {
        // End current group if it's large enough
        if (groupSize >= 3) {
          const group = windowCheckpoints.slice(groupStart, groupStart + groupSize);
          groups.push(createRedundantGroup(group, `Time window: ${new Date(windowStart).toLocaleTimeString()}`));
        }
        groupStart = i;
        groupSize = 1;
      }
    }
    
    // Check final group
    if (groupSize >= 3) {
      const group = windowCheckpoints.slice(groupStart);
      groups.push(createRedundantGroup(group, `Time window: ${new Date(windowStart).toLocaleTimeString()}`));
    }
  }
  
  return groups;
}

function createRedundantGroup(checkpoints: any[], description: string): RedundantGroup {
  // Keep the most recent checkpoint in each group
  const keepCheckpoint = checkpoints[checkpoints.length - 1];
  
  // Estimate space savings (rough approximation)
  const spaceSavings = checkpoints.length * 50; // Assume 50KB per checkpoint metadata
  
  return {
    checkpoints,
    keepId: keepCheckpoint.id,
    description,
    spaceSavings
  };
}

async function estimateChangeSize(core: ChromoCore, fromId: string, toId: string): Promise<number> {
  try {
    const fromCp = await core['getCheckpoint'](fromId);
    const toCp = await core['getCheckpoint'](toId);
    
    if (!fromCp || !toCp) return 0;
    
    let totalSize = 0;
    const processedFiles = new Set<string>();
    
    // Add sizes of new/modified files
    for (const file of toCp.files) {
      processedFiles.add(file.path);
      totalSize += file.size;
    }
    
    // Add sizes of deleted files (from previous checkpoint)
    for (const file of fromCp.files) {
      if (!processedFiles.has(file.path)) {
        totalSize += file.size;
      }
    }
    
    return totalSize;
  } catch {
    return 0;
  }
}

async function mergeCheckpointGroup(core: ChromoCore, group: RedundantGroup): Promise<void> {
  const db = core['db'];
  
  // Remove redundant checkpoints (keep the last one)
  for (const cp of group.checkpoints.slice(0, -1)) {
    // Delete checkpoint
    db.query('DELETE FROM checkpoints WHERE id = ?1').run(cp.id);
    
    // Delete file metadata
    db.query('DELETE FROM files WHERE checkpoint_id = ?1').run(cp.id);
    
    console.log(`   ${chalk.gray('├─')} Removed checkpoint ${cp.id}`);
  }
  
  // Clean up orphaned chunks (chunks no longer referenced by any file)
  const orphanedChunks = db.query(`
    SELECT hash FROM chunks c 
    WHERE ref_count > 0 AND NOT EXISTS (
      SELECT 1 FROM files f, json_each(f.chunks) 
      WHERE json_each.value = c.hash
    )
  `).all() as any[];
  
  for (const chunk of orphanedChunks) {
    // Delete the blob file
    const chunkPath = join(core['blobsDir'], chunk.hash);
    try {
      await Bun.file(chunkPath).delete();
    } catch {
      // Ignore if file doesn't exist
    }
    
    // Delete chunk metadata
    db.query('DELETE FROM chunks WHERE hash = ?1').run(chunk.hash);
  }
  
  if (orphanedChunks.length > 0) {
    console.log(`   ${chalk.gray('├─')} Cleaned up ${orphanedChunks.length} orphaned blobs`);
  }
}
