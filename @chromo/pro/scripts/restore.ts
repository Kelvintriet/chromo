import { ChromoCore } from './core';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import inquirer from 'inquirer';
import { glob } from 'glob';
import chalk from 'chalk';
import { showDiff } from './diff-engine';

export async function restoreSnapshot(checkpointId: string, options: any) {
  const core = new ChromoCore();
  
  try {
    const checkpoint = await core['getCheckpoint'](checkpointId);
    
    if (!checkpoint) {
      console.error(`Checkpoint ${checkpointId} not found`);
      process.exit(1);
    }
    
    const metadata = core['getMetadata']();
    
    console.log(`Restoring checkpoint: ${checkpointId}`);
    console.log(`Timestamp: ${new Date(checkpoint.timestamp).toISOString()}`);
    if (checkpoint.message) {
      console.log(`Message: ${checkpoint.message}`);
    }
    if (checkpoint.intent) {
      console.log(`Intent: ${checkpoint.intent}`);
    }
    
    // Check if this is creating a new branch
    const isBranching = metadata.headCheckpointId && metadata.headCheckpointId !== checkpointId;
    
    if (isBranching) {
      const headCheckpoint = await core['getCheckpoint'](metadata.headCheckpointId!);
      if (headCheckpoint) {
        // Check if checkpointId is an ancestor of HEAD
        const isAncestor = await isCheckpointAncestor(core, checkpointId, metadata.headCheckpointId!);
        
        if (!isAncestor) {
          console.log(`\n⚠️  This will create a new timeline branch!`);
          console.log(`   Current HEAD: ${metadata.headCheckpointId}`);
          console.log(`   Restoring to: ${checkpointId}`);
          console.log(`   This is a parallel timeline, not a rollback.`);
        }
      }
    }
    
    // Check for unsaved changes
    const hasUnsavedChanges = await core['hasUnsavedChanges']();
    if (hasUnsavedChanges && !options.force) {
      console.log('\n⚠️  You have unsaved changes!');
      console.log('   Restoring will overwrite your current work.');

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Do you want to proceed anyway?',
          default: false
        }
      ]);

      if (!proceed) {
        console.log('Restore cancelled');
        return;
      }
    }

    // Analyze what will be deleted
    console.log('\n🔍 Analyzing restore impact...');
    const filesToBeDeleted = await getFilesToBeDeleted(checkpoint, core);
    const totalLinesToBeDeleted = await countLinesInFiles(filesToBeDeleted);

    // Show full diff analysis using the diff engine
    console.log('\n📊 Full Diff Analysis:');
    console.log('═══════════════════════════════════════');
    console.log('The following shows exactly what will change:');
    console.log('═══════════════════════════════════════\n');

    // Call the diff engine to show actual diffs
    await showDiff(checkpointId, undefined, true);

    // Show summary of deletions if any
    if (filesToBeDeleted.length > 0) {
      console.log(chalk.bold.red('\n⚠️  ADDITIONAL FILES TO BE DELETED:'));
      console.log(chalk.bold.red('═════════════════════════════════════════'));
      console.log(chalk.bold.red(`   Files to be deleted: ${filesToBeDeleted.length}`));
      console.log(chalk.bold.red(`   Total lines to be lost: ${totalLinesToBeDeleted}`));
      console.log(chalk.bold.red('═════════════════════════════════════════\n'));

      console.log(chalk.red.bold('Files that will be deleted:'));
      for (const filePath of filesToBeDeleted) {
        const lineCount = await countLinesInFile(filePath);
        console.log(chalk.red(`   🗑️  ${filePath} (${lineCount} lines)`));
      }
      console.log('');
    }
    
    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to restore this checkpoint?',
          default: false
        }
      ]);
      
      if (!confirm) {
        console.log('Restore cancelled');
        return;
      }
    }
    
    // Restore each file
    let restoreSuccess = true;
    console.log('\n📝 Restoring files from checkpoint...');
    for (const file of checkpoint.files) {
      const fileBuffer = await core['reconstructFile'](file.path, checkpointId);

      if (fileBuffer) {
        if (options.partial) {
          // Partial restore - only specific lines
          const lines = fileBuffer.toString('utf-8').split('\n');
          const lineNumbers = options.partial.split(',').map((n: string) => parseInt(n) - 1);
          const partialContent = lineNumbers.map((n: number) => lines[n]).join('\n');
          await writeFile(file.path, partialContent);
          console.log(`  ✓ Partially restored: ${file.path} (lines ${options.partial})`);
        } else {
          await writeFile(file.path, fileBuffer);
          console.log(`  ✓ Restored: ${file.path}`);
        }
      } else {
        console.error(`  ✗ Failed to restore: ${file.path}`);
        restoreSuccess = false;
      }
    }

    // Delete files that don't exist in the checkpoint
    if (filesToBeDeleted.length > 0 && !options.partial) {
      console.log('\n🗑️  Deleting files not in checkpoint...');
      for (const filePath of filesToBeDeleted) {
        try {
          await unlink(filePath);
          console.log(chalk.red(`  ✗ Deleted: ${filePath}`));
        } catch (error) {
          console.warn(`  ⚠️  Could not delete: ${filePath}`);
        }
      }
    }
    
    // Update HEAD only if restore was successful
    if (restoreSuccess) {
      core['updateHead'](checkpointId, checkpoint.branch || 'main');
      
      // Restore environment if captured
      if (checkpoint.envState) {
        console.log('\nEnvironment state captured:');
        for (const [envFile, content] of Object.entries(checkpoint.envState)) {
          console.log(`  - ${envFile}`);
        }
      }
      
      // Show process information if available
      if (checkpoint.processes && checkpoint.processes.length > 0) {
        console.log('\nProcesses running at checkpoint time:');
        for (const proc of checkpoint.processes) {
          console.log(`  - ${proc.name} (PID: ${proc.pid})`);
        }
        console.log('\nNote: You may need to restart these processes manually.');
      }
      
      console.log('\n✓ Restore complete!');
      console.log(`  HEAD is now at: ${checkpointId}`);
    } else {
      console.log('\n❌ Restore failed due to missing files!');
      console.log('  HEAD was NOT updated.');
      console.log('  Consider using "chromo reset --soft" to start fresh.');
    }
    
  } catch (error) {
    console.error('Error restoring snapshot:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

// Helper function to check if checkpoint A is an ancestor of checkpoint B
async function isCheckpointAncestor(core: ChromoCore, ancestorId: string, descendantId: string): Promise<boolean> {
  let currentId = descendantId;
  const visited = new Set<string>();
  
  while (currentId) {
    if (currentId === ancestorId) {
      return true;
    }
    
    if (visited.has(currentId)) {
      // Cycle detected
      return false;
    }
    
    visited.add(currentId);
    
    const checkpoint = await core['getCheckpoint'](currentId);
    if (!checkpoint || !checkpoint.parentId) {
      return false;
    }
    
    currentId = checkpoint.parentId;
  }
  
  return false;
}

// Helper function to get files that will be deleted when restoring
async function getFilesToBeDeleted(checkpoint: any, core: ChromoCore): Promise<string[]> {
  // Get all files in current directory
  const currentFiles = await glob('**/*', {
    cwd: process.cwd(),
    ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**'],
    nodir: true
  });

  // Get files that exist in checkpoint
  const checkpointFilePaths = new Set(checkpoint.files.map((f: any) => f.path));

  // Files to delete are those that exist now but not in checkpoint
  const filesToBeDeleted: string[] = [];
  for (const filePath of currentFiles) {
    const fullPath = `${process.cwd()}/${filePath}`;
    if (!checkpointFilePaths.has(fullPath)) {
      filesToBeDeleted.push(fullPath);
    }
  }

  return filesToBeDeleted;
}

// Helper function to count lines in a file
async function countLinesInFile(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').length;
  } catch (error) {
    return 0;
  }
}

// Helper function to count total lines in multiple files
async function countLinesInFiles(filePaths: string[]): Promise<number> {
  let totalLines = 0;
  for (const filePath of filePaths) {
    totalLines += await countLinesInFile(filePath);
  }
  return totalLines;
}
