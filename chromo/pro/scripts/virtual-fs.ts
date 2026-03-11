import { ChromoCore } from './core';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { rmSync } from 'fs';

export class VirtualFilesystem {
  private core: ChromoCore;
  private mountDir: string;

  constructor(core: ChromoCore, mountDir: string = '.chromo/mount') {
    this.core = core;
    this.mountDir = mountDir;
  }

  async mount(checkpointId: string): Promise<string> {
    const checkpoint = await this.core.getCheckpoint(checkpointId);
    
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    const mountPath = join(process.cwd(), this.mountDir, checkpointId);
    
    // Clean up existing mount
    try {
      rmSync(mountPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Create mount directory
    await mkdir(mountPath, { recursive: true });

    // Reconstruct files
    for (const file of checkpoint.files) {
      const fileBuffer = await this.core.reconstructFile(file.path, checkpointId);
      
      if (fileBuffer) {
        const targetPath = join(mountPath, file.path);
        const targetDir = join(targetPath, '..');
        
        await mkdir(targetDir, { recursive: true });
        await writeFile(targetPath, fileBuffer);
      }
    }

    console.log(`✓ Mounted checkpoint ${checkpointId} to ${mountPath}`);
    console.log(`  Files: ${checkpoint.files.length}`);
    console.log(`  Timestamp: ${new Date(checkpoint.timestamp).toISOString()}`);
    
    return mountPath;
  }

  async unmount(checkpointId: string): Promise<void> {
    const mountPath = join(process.cwd(), this.mountDir, checkpointId);
    
    try {
      rmSync(mountPath, { recursive: true, force: true });
      console.log(`✓ Unmounted checkpoint ${checkpointId}`);
    } catch (error) {
      console.error(`Error unmounting checkpoint:`, error);
    }
  }

  async browse(checkpointId: string): Promise<void> {
    const mountPath = await this.mount(checkpointId);
    
    console.log('\n📁 Browse mode: You can now explore the mounted checkpoint');
    console.log(`📂 Mount point: ${mountPath}`);
    console.log('\nPress Ctrl+C to exit browse mode');
    
    // In a real implementation, this would open a file explorer or TUI
    // For now, we'll just keep the mount active until user exits
  }

  async partialRestore(checkpointId: string, filePath: string, lines?: number[]): Promise<void> {
    const fileBuffer = await this.core.reconstructFile(filePath, checkpointId);
    
    if (!fileBuffer) {
      throw new Error(`File ${filePath} not found in checkpoint ${checkpointId}`);
    }

    const content = fileBuffer.toString('utf-8');
    
    if (lines && lines.length > 0) {
      // Restore specific lines
      const allLines = content.split('\n');
      const selectedLines = lines.map(lineNum => allLines[lineNum - 1]).join('\n');
      
      console.log(`Restoring lines ${lines.join(', ')} from ${filePath}`);
      console.log(selectedLines);
      
      // Ask user if they want to apply these lines
      // In a real implementation, this would integrate with the editor
    } else {
      // Show the file content
      console.log(`\n📄 ${filePath} (from checkpoint ${checkpointId})`);
      console.log('─'.repeat(80));
      console.log(content);
    }
  }
}

// Zero-copy clone using reflinks (on supported filesystems)
export async function zeroCopyClone(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    // On APFS (macOS) and Btrfs (Linux), we can use reflinks
    // This is a simplified implementation - in production, use proper reflink API
    
    // For now, we'll use a regular copy as fallback
    const content = await readFile(sourcePath);
    await writeFile(destPath, content);
    
    console.log(`✓ Cloned ${sourcePath} to ${destPath}`);
    return true;
    
  } catch (error) {
    console.error(`Error cloning file:`, error);
    return false;
  }
}

// Check if filesystem supports reflinks
export function supportsReflinks(): boolean {
  const platform = process.platform;
  const fs = require('fs');
  
  try {
    // Check if we're on APFS (macOS) or Btrfs (Linux)
    if (platform === 'darwin') {
      // macOS with APFS
      const stat = fs.statSync('/');
      return true; // Assume APFS on modern macOS
    } else if (platform === 'linux') {
      // Check for Btrfs
      try {
        const output = require('child_process').execSync('df -T / | awk \'{print $2}\' | tail -1', {
          encoding: 'utf-8'
        });
        return output.trim() === 'btrfs';
      } catch {
        return false;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}
