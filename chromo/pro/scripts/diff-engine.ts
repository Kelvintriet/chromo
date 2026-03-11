import { ChromoCore } from './core';
import chalk from 'chalk';
import { glob } from 'glob';
import { stat } from 'fs/promises';

export async function showDiff(fromId: string, toId?: string, reverseDiff: boolean = false) {
  const core = new ChromoCore();

  try {
    const fromCheckpoint = await core.getCheckpoint(fromId);

    if (!fromCheckpoint) {
      console.error(`Checkpoint ${fromId} not found`);
      process.exit(1);
    }

    let toCheckpoint: any = null;

    if (toId) {
      toCheckpoint = await core.getCheckpoint(toId);
      if (!toCheckpoint) {
        console.error(`Checkpoint ${toId} not found`);
        process.exit(1);
      }
    } else {
      // Compare with current state - scan all files in current directory
      console.log('🔍 Scanning current directory for files...');

      const files = await glob('**/*', {
        cwd: process.cwd(),
        ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**'],
        nodir: true
      });

      const currentFiles = [];
      for (const filePath of files) {
        const fullPath = `${process.cwd()}/${filePath}`;
        try {
          const fileStat = await stat(fullPath);
          const fileHash = await Bun.hash(await Bun.file(fullPath).arrayBuffer());

          currentFiles.push({
            path: fullPath,
            size: fileStat.size,
            mtime: fileStat.mtimeMs,
            chunks: [], // Not needed for diff
            hash: fileHash.toString(16)
          });
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      toCheckpoint = {
        id: 'current',
        files: currentFiles
      };
    }

    console.log(`\n📊 Diff: ${fromCheckpoint.id} → ${toCheckpoint.id}`);
    console.log(`From: ${new Date(fromCheckpoint.timestamp).toISOString()}`);
    if (toCheckpoint.timestamp) {
      console.log(`To: ${new Date(toCheckpoint.timestamp).toISOString()}`);
    }
    console.log('');

    // Compare files
    const allFiles = new Set([
      ...fromCheckpoint.files.map(f => f.path),
      ...toCheckpoint.files.map((f: any) => f.path)
    ]);

    let hasChanges = false;
    let changedFilesCount = 0;

    for (const filePath of allFiles) {
      const fromFile = fromCheckpoint.files.find(f => f.path === filePath);
      const toFile = toCheckpoint.files.find((f: any) => f.path === filePath);

      let fromContent = '';
      let toContent = '';

      if (fromFile) {
        const buffer = await core.reconstructFile(filePath, fromId);
        if (buffer) {
          // Decode Uint8Array to UTF-8 string
          fromContent = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        }
      }

      if (toFile) {
        if (toId) {
          const buffer = await core.reconstructFile(filePath, toId);
          if (buffer) {
            toContent = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
          }
        } else {
          // Current state
          try {
            toContent = await Bun.file(filePath).text();
          } catch {
            toContent = '';
          }
        }
      }

      // Skip binary files
      if (isBinaryContent(fromContent) || isBinaryContent(toContent)) {
        if (fromContent !== toContent) {
          hasChanges = true;
          changedFilesCount++;
          console.log(chalk.bold.yellow(`\n${filePath} (BINARY FILE - content changed)`));
          console.log(chalk.gray('─'.repeat(80)));
          console.log(chalk.gray('  Binary file - diff not shown'));
        }
        continue;
      }

      // Check if file changed
      if (!fromFile && toFile) {
        hasChanges = true;
        changedFilesCount++;
        if (reverseDiff) {
          console.log(chalk.bold.red(`\n${filePath} (WILL BE DELETED)`));
        } else {
          console.log(chalk.bold.green(`\n${filePath} (NEW FILE)`));
        }
        console.log(chalk.gray('─'.repeat(80)));

        // Skip if binary
        if (isBinaryContent(toContent)) {
          console.log(chalk.gray('  Binary file - content not shown'));
          continue;
        }

        // Show all lines as added (or removed if reverse)
        const lines = toContent.split('\n');
        for (const line of lines) {
          if (reverseDiff) {
            console.log(chalk.red(`- ${line}`));
          } else {
            console.log(chalk.green(`+ ${line}`));
          }
        }
      } else if (fromFile && !toFile) {
        hasChanges = true;
        changedFilesCount++;
        if (reverseDiff) {
          console.log(chalk.bold.green(`\n${filePath} (WILL BE RESTORED)`));
        } else {
          console.log(chalk.bold.red(`\n${filePath} (DELETED)`));
        }
        console.log(chalk.gray('─'.repeat(80)));

        // Skip if binary
        if (isBinaryContent(fromContent)) {
          console.log(chalk.gray('  Binary file - content not shown'));
          continue;
        }

        // Show all lines as removed (or added if reverse)
        const lines = fromContent.split('\n');
        for (const line of lines) {
          if (reverseDiff) {
            console.log(chalk.green(`+ ${line}`));
          } else {
            console.log(chalk.red(`- ${line}`));
          }
        }
      } else if (fromContent !== toContent) {
        hasChanges = true;
        changedFilesCount++;

        console.log(chalk.bold.cyan(`\n${filePath}`));
        console.log(chalk.gray('─'.repeat(80)));

        // Show unified diff
        const unifiedDiff = generateUnifiedDiff(fromContent, toContent, reverseDiff);

        for (const line of unifiedDiff) {
          if (line.type === 'context') {
            console.log(chalk.gray(`  ${line.content}`));
          } else if (line.type === 'removed') {
            if (reverseDiff) {
              console.log(chalk.green(`+ ${line.content}`));
            } else {
              console.log(chalk.red(`- ${line.content}`));
            }
          } else if (line.type === 'added') {
            if (reverseDiff) {
              console.log(chalk.red(`- ${line.content}`));
            } else {
              console.log(chalk.green(`+ ${line.content}`));
            }
          }
        }
      }
    }

    if (!hasChanges) {
      console.log(chalk.yellow('\nNo changes detected between checkpoints.'));
    }

    // Show summary
    console.log(chalk.bold('\n📈 Change Summary:'));
    console.log(`  From checkpoint: ${fromCheckpoint.id}`);
    console.log(`  To checkpoint: ${toCheckpoint.id}`);
    console.log(`  Files changed: ${changedFilesCount}`);

  } catch (error) {
    console.error('Error showing diff:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

function isBinaryContent(content: string): boolean {
  // Check if content contains non-printable characters
  // A simple heuristic: if more than 30% of characters are non-printable, it's likely binary
  let nonPrintableCount = 0;
  const sampleSize = Math.min(content.length, 1000);

  if (sampleSize === 0) return false;

  for (let i = 0; i < sampleSize; i++) {
    const charCode = content.charCodeAt(i);
    // Check for non-printable ASCII characters (0-31 except 9, 10, 13)
    if ((charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) ||
      charCode === 127 || charCode > 255) {
      nonPrintableCount++;
    }
  }

  return (nonPrintableCount / sampleSize) > 0.3;
}

interface DiffLine {
  type: 'context' | 'removed' | 'added';
  content: string;
}

function generateUnifiedDiff(fromContent: string, toContent: string, reverseDiff: boolean = false): DiffLine[] {
  const result: DiffLine[] = [];

  const fromLines = fromContent.split('\n');
  const toLines = toContent.split('\n');

  // Create a map to track which lines in "to" have been matched
  const toMatched = new Set<number>();

  // For each line in "from", try to find a match in "to"
  let toIndex = 0;
  for (let fromIndex = 0; fromIndex < fromLines.length; fromIndex++) {
    const fromLine = fromLines[fromIndex];

    // Try to find this line in "to" starting from current position
    let matchFound = false;
    for (let j = toIndex; j < toLines.length; j++) {
      if (!toMatched.has(j) && fromLine === toLines[j]) {
        // Output any added lines before this match
        for (let k = toIndex; k < j; k++) {
          result.push({ type: 'added', content: toLines[k] });
          toMatched.add(k);
        }

        // Output the matching line as context
        result.push({ type: 'context', content: fromLine });
        toMatched.add(j);

        toIndex = j + 1;
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      // This line was removed
      result.push({ type: 'removed', content: fromLine });
    }
  }

  // Output any remaining lines in "to" as added
  for (let k = toIndex; k < toLines.length; k++) {
    if (!toMatched.has(k)) {
      result.push({ type: 'added', content: toLines[k] });
    }
  }

  return result;
}

export async function calculateHeatmap(checkpointId: string, hours: number = 1) {
  const core = new ChromoCore();

  try {
    const checkpoints = await core.listCheckpoints();
    const now = Date.now();
    const timeWindow = hours * 60 * 60 * 1000;

    // Filter checkpoints within time window
    const recentCheckpoints = checkpoints.filter(
      cp => now - cp.timestamp <= timeWindow
    );

    // Count file changes
    const fileChangeCount = new Map<string, number>();

    for (const checkpoint of recentCheckpoints) {
      const fullCheckpoint = await core.getCheckpoint(checkpoint.id);
      if (fullCheckpoint) {
        for (const file of fullCheckpoint.files) {
          const count = fileChangeCount.get(file.path) || 0;
          fileChangeCount.set(file.path, count + 1);
        }
      }
    }

    // Find max for normalization
    const maxChanges = Math.max(...fileChangeCount.values(), 1);

    console.log(`\n🔥 File Change Heatmap (last ${hours} hour(s))`);
    console.log(chalk.gray('─'.repeat(80)));

    // Sort by change count
    const sortedFiles = [...fileChangeCount.entries()]
      .sort((a, b) => b[1] - a[1]);

    for (const [filePath, count] of sortedFiles) {
      const intensity = count / maxChanges;
      let color: any;

      if (intensity > 0.7) {
        color = chalk.red;
      } else if (intensity > 0.4) {
        color = chalk.yellow;
      } else {
        color = chalk.green;
      }

      const bar = '█'.repeat(Math.round(intensity * 20));
      const spaces = ' '.repeat(20 - Math.round(intensity * 20));

      console.log(`${color(bar + spaces)} ${count} changes - ${filePath}`);
    }

  } catch (error) {
    console.error('Error calculating heatmap:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}
