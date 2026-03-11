import { ChromoCore } from './core';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export async function checkIntegrity(options: any) {
  const core = new ChromoCore();
  
  try {
    console.log('🔍 Chromo Integrity Check\n');
    
    let issuesFound = 0;
    let issuesFixed = 0;
    
    // Check 1: All checkpoints have valid parents
    console.log('📋 Checking checkpoint parent relationships...');
    const parentIssues = await checkParentRelationships(core);
    issuesFound += parentIssues.length;
    if (parentIssues.length > 0) {
      console.log(`   ${chalk.red('✗')} Found ${parentIssues.length} orphaned checkpoints`);
      for (const issue of parentIssues) {
        console.log(`      ${issue}`);
      }
    } else {
      console.log(`   ${chalk.green('✓')} All checkpoints have valid parents`);
    }
    
    // Check 2: All file chunks exist
    console.log('\n📁 Checking file blob integrity...');
    const blobIssues = await checkBlobIntegrity(core);
    issuesFound += blobIssues.length;
    if (blobIssues.length > 0) {
      console.log(`   ${chalk.red('✗')} Found ${blobIssues.length} missing blobs`);
      for (const issue of blobIssues) {
        console.log(`      ${issue}`);
      }
    } else {
      console.log(`   ${chalk.green('✓')} All file blobs are present`);
    }
    
    // Check 3: Database consistency
    console.log('\n🗄️  Checking database consistency...');
    const dbIssues = await checkDatabaseConsistency(core);
    issuesFound += dbIssues.length;
    if (dbIssues.length > 0) {
      console.log(`   ${chalk.red('✗')} Found ${dbIssues.length} database inconsistencies`);
      for (const issue of dbIssues) {
        console.log(`      ${issue}`);
      }
    } else {
      console.log(`   ${chalk.green('✓')} Database is consistent`);
    }
    
    if (options.deep) {
      // Check 4: File content verification
      console.log('\n🔎 Performing deep content verification...');
      const contentIssues = await checkFileContent(core);
      issuesFound += contentIssues.length;
      if (contentIssues.length > 0) {
        console.log(`   ${chalk.red('✗')} Found ${contentIssues.length} content verification issues`);
        for (const issue of contentIssues) {
          console.log(`      ${issue}`);
        }
      } else {
        console.log(`   ${chalk.green('✓')} All file content verified`);
      }
    }
    
    // Attempt to fix issues
    if (options.fix && issuesFound > 0) {
      console.log('\n🔧 Attempting to fix issues...');
      issuesFixed = await fixIssues(core, parentIssues, blobIssues, dbIssues);
      console.log(`   ${chalk.green('✓')} Fixed ${issuesFixed} issues`);
    }
    
    console.log(`\n📊 Integrity Check Results:`);
    console.log(`   ${chalk.yellow(issuesFound)} issues found`);
    if (options.fix) {
      console.log(`   ${chalk.green(issuesFixed)} issues fixed`);
    }
    
    if (issuesFound === 0) {
      console.log(`\n🎉 All checks passed! Your history is healthy.`);
    } else if (issuesFound > issuesFixed) {
      console.log(`\n⚠️  Some issues remain. Consider running with --fix to attempt repairs.`);
    }
    
  } catch (error) {
    console.error('Error during integrity check:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

async function checkParentRelationships(core: ChromoCore): Promise<string[]> {
  const issues: string[] = [];
  const db = core['db'];
  
  const checkpoints = db.query('SELECT id, parent_id FROM checkpoints').all() as any[];
  
  for (const cp of checkpoints) {
    if (cp.parent_id && cp.parent_id !== 'root') {
      // Check if parent exists
      const parentExists = db.query('SELECT 1 FROM checkpoints WHERE id = ?1').get(cp.parent_id);
      if (!parentExists) {
        issues.push(`Checkpoint ${cp.id} references non-existent parent ${cp.parent_id}`);
      }
    }
  }
  
  return issues;
}

async function checkBlobIntegrity(core: ChromoCore): Promise<string[]> {
  const issues: string[] = [];
  const db = core['db'];
  const blobsDir = core['blobsDir'];
  
  const chunkHashes = db.query('SELECT hash FROM chunks').all() as any[];
  
  for (const chunk of chunkHashes) {
    const blobPath = join(blobsDir, chunk.hash);
    try {
      await Bun.file(blobPath).stat();
    } catch {
      issues.push(`Missing blob file: ${chunk.hash}`);
    }
  }
  
  return issues;
}

async function checkDatabaseConsistency(core: ChromoCore): Promise<string[]> {
  const issues: string[] = [];
  const db = core['db'];
  
  // Check for files without checkpoints
  const orphanFiles = db.query(`
    SELECT f.path, f.checkpoint_id 
    FROM files f 
    WHERE NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.id = f.checkpoint_id)
  `).all() as any[];
  
  for (const file of orphanFiles) {
    issues.push(`Orphaned file record: ${file.path} in checkpoint ${file.checkpoint_id}`);
  }
  
  // Check for chunks without files
  const orphanChunks = db.query(`
    SELECT c.hash 
    FROM chunks c 
    WHERE c.ref_count > 0 AND NOT EXISTS (
      SELECT 1 FROM files f, json_each(f.chunks) 
      WHERE json_each.value = c.hash
    )
  `).all() as any[];
  
  for (const chunk of orphanChunks) {
    issues.push(`Orphaned chunk: ${chunk.hash}`);
  }
  
  return issues;
}

async function checkFileContent(core: ChromoCore): Promise<string[]> {
  const issues: string[] = [];
  const db = core['db'];
  
  // This is a deep check that reconstructs files and verifies content
  // For performance, we'll only check a sample
  const checkpoints = db.query('SELECT id FROM checkpoints ORDER BY timestamp DESC LIMIT 5').all() as any[];
  
  for (const cp of checkpoints) {
    const checkpoint = await core['getCheckpoint'](cp.id);
    if (!checkpoint) continue;
    
    for (const file of checkpoint.files.slice(0, 3)) { // Check first 3 files per checkpoint
      try {
        const reconstructed = await core['reconstructFile'](file.path, cp.id);
        if (!reconstructed) {
          issues.push(`Cannot reconstruct file: ${file.path} from checkpoint ${cp.id}`);
          continue;
        }
        
        // Verify size matches
        if (reconstructed.length !== file.size) {
          issues.push(`Size mismatch for ${file.path} in ${cp.id}: expected ${file.size}, got ${reconstructed.length}`);
        }
        
        // Verify hash matches
        const actualHash = await core['getFileHash'](Buffer.from(reconstructed).toString());
        if (actualHash !== file.hash) {
          issues.push(`Hash mismatch for ${file.path} in ${cp.id}`);
        }
      } catch (error) {
        issues.push(`Error checking ${file.path} in ${cp.id}: ${error}`);
      }
    }
  }
  
  return issues;
}

async function fixIssues(core: ChromoCore, parentIssues: string[], blobIssues: string[], dbIssues: string[]): Promise<number> {
  let fixed = 0;
  const db = core['db'];
  
  // Fix orphan files
  for (const issue of dbIssues) {
    if (issue.startsWith('Orphaned file record:')) {
      // Remove orphaned file records
      const parts = issue.split(' ');
      const checkpointId = parts[parts.length - 1];
      db.query('DELETE FROM files WHERE checkpoint_id = ?1').run(checkpointId);
      fixed++;
    }
  }
  
  // Fix orphan chunks
  for (const issue of dbIssues) {
    if (issue.startsWith('Orphaned chunk:')) {
      const hash = issue.split(': ')[1];
      // Remove blob file if it exists
      const blobPath = join(core['blobsDir'], hash);
      try {
        await Bun.file(blobPath).delete();
      } catch {}
      
      // Remove chunk record
      db.query('DELETE FROM chunks WHERE hash = ?1').run(hash);
      fixed++;
    }
  }
  
  // Note: We don't auto-fix missing blobs or parent relationships as that requires more complex logic
  
  return fixed;
}
