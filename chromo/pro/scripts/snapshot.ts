import { ChromoCore } from './core';
import { generateIntent } from './intent';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';

export async function createSnapshot(options: any) {
  const core = new ChromoCore();
  
  try {
    let files: string[] = [];
    
    if (options.all) {
      // Get all files in current directory
      const entries = await readdir(process.cwd(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          files.push(join(process.cwd(), entry.name));
        }
      }
    } else {
      // Use git-like behavior - track modified files
      files = await glob('**/*', { 
        cwd: process.cwd(),
        ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**'],
        nodir: true
      });
      files = files.map(f => join(process.cwd(), f));
    }
    
    // Generate intent if auto mode
    let intent = options.message;
    if (options.auto && !intent) {
      intent = await generateIntent(files);
    }
    
    console.log(`Creating snapshot with ${files.length} files...`);
    
    const checkpointId = await core.createCheckpoint(files, options.message, intent);
    
    console.log(`✓ Snapshot created: ${checkpointId}`);
    if (intent) {
      console.log(`  Intent: ${intent}`);
    }
    
  } catch (error) {
    console.error('Error creating snapshot:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}
