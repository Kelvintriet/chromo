import { ChromoCore } from './core';
import { readdir, readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class Compressor {
  private core: ChromoCore;
  private compressionLevel = 6; // Default compression level

  constructor(core: ChromoCore) {
    this.core = core;
  }

  async compressOldBlobs(daysOld: number = 7): Promise<void> {
    console.log(`🗜️  Compressing blobs older than ${daysOld} days...`);
    
    const blobsDir = this.core['blobsDir'];
    const compressedDir = join(this.core['historyDir'], 'compressed');
    
    await mkdir(compressedDir, { recursive: true });
    
    const files = await readdir(blobsDir);
    const now = Date.now();
    const ageThreshold = daysOld * 24 * 60 * 60 * 1000;
    
    let compressedCount = 0;
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;

    for (const file of files) {
      const filePath = join(blobsDir, file);
      const stats = await this.getFileStats(filePath);
      
      if (!stats) continue;
      
      const age = now - stats.mtimeMs;
      
      if (age >= ageThreshold) {
        const compressedPath = join(compressedDir, `/Users/s07904/CascadeProjects/scripts/virtual-fs.ts.gz`);
        
        // Check if already compressed
        try {
          await readFile(compressedPath);
          continue; // Already compressed
        } catch {
          // Not compressed yet
        }
        
        try {
          const content = await readFile(filePath);
          totalOriginalSize += content.length;
          
          const compressed = await gzipAsync(content, { level: this.compressionLevel });
          totalCompressedSize += compressed.length;
          
          await writeFile(compressedPath, compressed);
          
          // Delete original after successful compression
          await unlink(filePath);
          
          // Update database to mark as compressed
          this.core['db'].query('UPDATE chunks SET compressed = 1 WHERE hash = ?1').run(file);
          
          compressedCount++;
          
          if (compressedCount % 100 === 0) {
            console.log(`  Compressed ${compressedCount} blobs...`);
          }
          
        } catch (error) {
          console.error(`Error compressing blob /Users/s07904/CascadeProjects/scripts/virtual-fs.ts:`, error);
        }
      }
    }
    
    const ratio = totalOriginalSize > 0 ? ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(2) : 0;
    
    console.log(`✓ Compression complete!`);
    console.log(`  Compressed: ${compressedCount} blobs`);
    console.log(`  Original size: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Compressed size: ${(totalCompressedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Space saved: ${ratio}%`);
  }

  async decompressBlob(hash: string): Promise<Buffer | null> {
    const compressedDir = join(this.core['historyDir'], 'compressed');
    const compressedPath = join(compressedDir, `${hash}.gz`);
    
    try {
      const compressed = await readFile(compressedPath);
      const decompressed = await gunzipAsync(compressed);
      
      return decompressed;
    } catch (error) {
      console.error(`Error decompressing blob ${hash}:`, error);
      return null;
    }
  }

  async startBackgroundCompression(intervalMinutes: number = 60): Promise<void> {
    console.log(`🔄 Starting background compression (every ${intervalMinutes} minutes)...`);
    
    const interval = intervalMinutes * 60 * 1000;
    
    // Run immediately
    await this.compressOldBlobs();
    
    // Schedule recurring compression
    setInterval(async () => {
      console.log(`\n🕐 Running scheduled compression...`);
      await this.compressOldBlobs();
    }, interval);
  }

  private async getFileStats(filePath: string): Promise<any | null> {
    try {
      const { stat } = require('fs/promises');
      return await stat(filePath);
    } catch {
      return null;
    }
  }

  async getCompressionStats(): Promise<{
    totalBlobs: number;
    compressedBlobs: number;
    originalSize: number;
    compressedSize: number;
  }> {
    const blobsDir = this.core['blobsDir'];
    const compressedDir = join(this.core['historyDir'], 'compressed');
    
    const files = await readdir(blobsDir);
    const compressedFiles = await readdir(compressedDir).catch(() => []);
    
    let originalSize = 0;
    let compressedSize = 0;
    
    for (const file of files) {
      const filePath = join(blobsDir, file);
      const stats = await this.getFileStats(filePath);
      if (stats) {
        originalSize += stats.size;
      }
    }
    
    for (const file of compressedFiles) {
      const filePath = join(compressedDir, file);
      const stats = await this.getFileStats(filePath);
      if (stats) {
        compressedSize += stats.size;
      }
    }
    
    return {
      totalBlobs: files.length,
      compressedBlobs: compressedFiles.length,
      originalSize,
      compressedSize
    };
  }
}

// Cold storage offloading
export async function offloadToColdStorage(checkpointId: string, destination: string): Promise<void> {
  console.log(`📦 Offloading checkpoint ${checkpointId} to cold storage...`);
  
  // In a real implementation, this would:
  // 1. Compress the checkpoint
  // 2. Upload to S3, R2, or other cloud storage
  // 3. Update database with storage location
  // 4. Delete local copy
  
  console.log(`  Destination: ${destination}`);
  console.log('  Note: Cold storage offloading requires cloud provider configuration');
}

export async function restoreFromColdStorage(checkpointId: string, source: string): Promise<void> {
  console.log(`📥 Restoring checkpoint ${checkpointId} from cold storage...`);
  
  // In a real implementation, this would:
  // 1. Download from cloud storage
  // 2. Decompress
  // 3. Restore to local storage
  // 4. Update database
  
  console.log(`  Source: ${source}`);
  console.log('  Note: Cold storage restoration requires cloud provider configuration');
}
