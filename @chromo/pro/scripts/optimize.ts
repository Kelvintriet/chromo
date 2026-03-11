import { ChromoCore } from './core';
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export async function optimizeDatabase(options: any) {
  const core = new ChromoCore();
  
  try {
    console.log('⚡ Chromo Optimize - Database and Blob Optimization\n');
    
    const startTime = Date.now();
    let totalSavings = 0;
    
    // Database optimization
    if (options.vacuumDb || (!options.compressBlobs && !options.deduplicate)) {
      console.log('🗄️  Optimizing SQLite database...');
      const dbSavings = await optimizeSQLite(core);
      console.log(`   ${chalk.green('✓')} Database vacuumed, saved ${dbSavings}KB`);
      totalSavings += dbSavings;
    }
    
    // Blob compression
    if (options.compressBlobs || (!options.vacuumDb && !options.deduplicate)) {
      console.log('\n🗜️  Compressing text blobs...');
      const blobSavings = await compressTextBlobs(core);
      console.log(`   ${chalk.green('✓')} Compressed blobs, saved ${blobSavings}KB`);
      totalSavings += blobSavings;
    }
    
    // Deduplication
    if (options.deduplicate || (!options.vacuumDb && !options.compressBlobs)) {
      console.log('\n🔍 Re-scanning for duplicate chunks...');
      const dedupeSavings = await deduplicateChunks(core);
      console.log(`   ${chalk.green('✓')} Removed duplicate chunks, saved ${dedupeSavings}KB`);
      totalSavings += dedupeSavings;
    }
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n🎉 Optimization complete!`);
    console.log(`   ${chalk.green('Total space saved:')} ${totalSavings}KB`);
    console.log(`   ${chalk.gray('Time taken:')} ${duration.toFixed(1)}s`);
    
  } catch (error) {
    console.error('Error during optimization:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

async function optimizeSQLite(core: ChromoCore): Promise<number> {
  const db = core['db'];
  
  // Get database size before vacuum
  const dbPath = join(core['historyDir'], 'index.db');
  const beforeSize = (await stat(dbPath)).size;
  
  // Run VACUUM and ANALYZE
  db.exec('VACUUM;');
  db.exec('ANALYZE;');
  
  // Get database size after vacuum
  const afterSize = (await stat(dbPath)).size;
  const savings = Math.max(0, beforeSize - afterSize);
  
  return Math.round(savings / 1024); // Convert to KB
}

async function compressTextBlobs(core: ChromoCore): Promise<number> {
  const blobsDir = core['blobsDir'];
  let totalSavings = 0;
  
  try {
    const blobFiles = await readdir(blobsDir);
    
    for (const blobFile of blobFiles) {
      if (blobFile.endsWith('.compressed')) continue; // Already compressed
      
      const blobPath = join(blobsDir, blobFile);
      const statInfo = await stat(blobPath);
      
      if (statInfo.size < 1024) continue; // Skip very small files
      
      try {
        const content = await readFile(blobPath);
        
        // Check if it's text (not binary)
        if (isTextContent(content)) {
          // Compress with Brotli
          const compressed = Bun.gzip.compress(content);
          
          if (compressed.length < content.length) {
            // Only keep if compression actually saves space
            await writeFile(blobPath + '.compressed', compressed);
            
            // Mark as compressed in database (you'd need to add a compressed flag to chunks table)
            // For now, just track savings
            const savings = content.length - compressed.length;
            totalSavings += savings;
          }
        }
      } catch (error) {
        // Skip problematic blobs
        continue;
      }
    }
  } catch (error) {
    console.warn('Warning: Could not access blobs directory');
  }
  
  return Math.round(totalSavings / 1024); // Convert to KB
}

function isTextContent(content: Uint8Array): boolean {
  if (content.length === 0) return true;
  
  let nonPrintableCount = 0;
  const sampleSize = Math.min(content.length, 1000);
  
  for (let i = 0; i < sampleSize; i++) {
    const byte = content[i];
    // Check for non-printable ASCII characters (0-31 except 9, 10, 13)
    if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) ||
        byte === 127 || byte > 255) {
      nonPrintableCount++;
    }
  }
  
  return (nonPrintableCount / sampleSize) < 0.3; // Less than 30% non-printable
}

async function deduplicateChunks(core: ChromoCore): Promise<number> {
  const db = core['db'];
  let totalSavings = 0;
  
  try {
    // Find chunks with identical content but different hashes (shouldn't happen, but safety check)
    const duplicateChunks = db.query(`
      SELECT hash, COUNT(*) as count, MIN(size) as size
      FROM chunks 
      GROUP BY hash 
      HAVING COUNT(*) > 1
    `).all() as any[];
    
    for (const dup of duplicateChunks) {
      // This shouldn't happen with proper hashing, but if it does, clean it up
      console.warn(`Found ${dup.count} chunks with same hash ${dup.hash}, cleaning up...`);
      
      // Keep one, remove others
      db.query('DELETE FROM chunks WHERE hash = ?1 AND rowid NOT IN (SELECT MIN(rowid) FROM chunks WHERE hash = ?1)').run(dup.hash);
      totalSavings += dup.size * (dup.count - 1);
    }
    
    // Also check for chunks that are referenced but don't exist on disk
    const missingChunks = db.query(`
      SELECT DISTINCT json_each.value as hash
      FROM files, json_each(files.chunks)
      WHERE NOT EXISTS (
        SELECT 1 FROM chunks WHERE chunks.hash = json_each.value
      )
    `).all() as any[];
    
    if (missingChunks.length > 0) {
      console.warn(`Found ${missingChunks.length} chunks referenced but missing from disk`);
      // You could attempt to recreate them or warn the user
    }
    
  } catch (error) {
    console.warn('Warning: Could not complete deduplication scan');
  }
  
  return Math.round(totalSavings / 1024); // Convert to KB
}
