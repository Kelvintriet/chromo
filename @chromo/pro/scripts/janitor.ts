import { ChromoCore } from './core';
import { unlink, readdir } from 'fs/promises';
import { join } from 'path';

interface PruneRule {
  age: number; // milliseconds
  keepInterval: number; // milliseconds
}

export async function cleanupHistory(options: any) {
  const core = new ChromoCore();
  
  try {
    console.log('🧹 Starting cleanup...');
    
    const checkpoints = await core.listCheckpoints();
    const now = Date.now();
    
    // Smart decay rules
    const rules: PruneRule[] = [
      { age: 60 * 60 * 1000, keepInterval: 60 * 1000 }, // Keep every minute for 1 hour
      { age: 24 * 60 * 60 * 1000, keepInterval: 60 * 60 * 1000 }, // Keep every hour for 1 day
      { age: 7 * 24 * 60 * 60 * 1000, keepInterval: 24 * 60 * 60 * 1000 }, // Keep every day for 1 week
      { age: 30 * 24 * 60 * 60 * 1000, keepInterval: 7 * 24 * 60 * 60 * 1000 }, // Keep every week for 1 month
    ];
    
    const toDelete: string[] = [];
    const toKeep: string[] = [];
    
    // Sort by timestamp (oldest first)
    const sortedCheckpoints = [...checkpoints].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const checkpoint of sortedCheckpoints) {
      const age = now - checkpoint.timestamp;
      
      // Find applicable rule
      const rule = rules.find(r => age <= r.age);
      
      if (!rule) {
        // Checkpoint is older than all rules - mark for deletion
        toDelete.push(checkpoint.id);
        continue;
      }
      
      // Check if this checkpoint should be kept based on interval
      const shouldKeep = shouldKeepCheckpoint(checkpoint, sortedCheckpoints, rule.keepInterval);
      
      if (shouldKeep) {
        toKeep.push(checkpoint.id);
      } else {
        toDelete.push(checkpoint.id);
      }
    }
    
    // Also check for cold storage offloading
    const toOffload = await checkForColdStorage(checkpoints, now);
    
    if (options.dryRun) {
      console.log('\n📊 Dry run results:');
      console.log(`  Checkpoints to delete: ${toDelete.length}`);
      console.log(`  Checkpoints to keep: ${toKeep.length}`);
      console.log(`  Checkpoints to offload: ${toOffload.length}`);
      
      if (toDelete.length > 0) {
        console.log('\n  To delete:');
        for (const id of toDelete) {
          const cp = checkpoints.find(c => c.id === id);
          console.log(`    - ${id} (${new Date(cp!.timestamp).toISOString()})`);
        }
      }
      
      if (toOffload.length > 0) {
        console.log('\n  To offload to cold storage:');
        for (const id of toOffload) {
          const cp = checkpoints.find(c => c.id === id);
          console.log(`    - ${id} (${new Date(cp!.timestamp).toISOString()})`);
        }
      }
    } else {
      // Perform actual cleanup
      console.log(`\nDeleting ${toDelete.length} checkpoints...`);
      for (const id of toDelete) {
        await deleteCheckpoint(core, id);
        console.log(`  ✓ Deleted: ${id}`);
      }
      
      // Offload old checkpoints
      if (toOffload.length > 0) {
        console.log(`\nOffloading ${toOffload.length} checkpoints to cold storage...`);
        for (const id of toOffload) {
          await offloadCheckpoint(core, id);
          console.log(`  ✓ Offloaded: ${id}`);
        }
      }
      
      // Clean up orphaned chunks
      await cleanupOrphanedChunks(core);
      
      console.log('\n✓ Cleanup complete!');
    }
    
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

function shouldKeepCheckpoint(checkpoint: any, allCheckpoints: any[], interval: number): boolean {
  // Always keep the most recent checkpoint
  if (checkpoint === allCheckpoints[allCheckpoints.length - 1]) {
    return true;
  }
  
  // Check if there's a checkpoint within the interval before this one
  const previousCheckpoint = allCheckpoints
    .filter(cp => cp.timestamp < checkpoint.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  
  if (!previousCheckpoint) {
    return true; // Keep if no previous checkpoint
  }
  
  const timeDiff = checkpoint.timestamp - previousCheckpoint.timestamp;
  return timeDiff >= interval;
}

async function checkForColdStorage(checkpoints: any[], now: number): Promise<string[]> {
  const toOffload: string[] = [];
  const coldStorageAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  for (const checkpoint of checkpoints) {
    const age = now - checkpoint.timestamp;
    if (age >= coldStorageAge) {
      toOffload.push(checkpoint.id);
    }
  }
  
  return toOffload;
}

async function deleteCheckpoint(core: ChromoCore, checkpointId: string) {
  // Get all files for this checkpoint
  const files = core['db'].query('SELECT chunks FROM files WHERE checkpoint_id = ?1').all(checkpointId) as any[];
  
  // Decrement chunk reference counts
  for (const file of files) {
    const chunks = JSON.parse(file.chunks) as string[];
    for (const chunkHash of chunks) {
      core['db'].query('UPDATE chunks SET ref_count = ref_count - 1 WHERE hash = ?1').run(chunkHash);
      
      // Delete chunk if ref_count is 0
      const chunk = core['db'].query('SELECT ref_count FROM chunks WHERE hash = ?1').get(chunkHash) as any;
      if (chunk && chunk.ref_count <= 0) {
        const chunkPath = join(core['blobsDir'], chunkHash);
        try {
          await unlink(chunkPath);
        } catch (error) {
          // Ignore if file doesn't exist
        }
        core['db'].query('DELETE FROM chunks WHERE hash = ?1').run(chunkHash);
      }
    }
  }
  
  // Delete files
  core['db'].query('DELETE FROM files WHERE checkpoint_id = ?1').run(checkpointId);
  
  // Delete checkpoint
  core['db'].query('DELETE FROM checkpoints WHERE id = ?1').run(checkpointId);
}

async function offloadCheckpoint(core: ChromoCore, checkpointId: string) {
  // In a real implementation, this would compress and move to cold storage
  const coldStorageDir = join(core['historyDir'], 'cold');
  
  // Create cold storage directory
  await mkdir(coldStorageDir, { recursive: true });
  
  // For now, just mark as offloaded in metadata
  console.log(`  Note: Actual offloading to cold storage not implemented yet`);
}

async function cleanupOrphanedChunks(core: ChromoCore) {
  // Find chunks with ref_count = 0
  const orphanedChunks = core['db'].query('SELECT hash FROM chunks WHERE ref_count = 0').all() as any[];
  
  console.log(`\nCleaning up ${orphanedChunks.length} orphaned chunks...`);
  
  for (const chunk of orphanedChunks) {
    const chunkPath = join(core['blobsDir'], chunk.hash);
    try {
      await unlink(chunkPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    core['db'].query('DELETE FROM chunks WHERE hash = ?1').run(chunk.hash);
  }
}
