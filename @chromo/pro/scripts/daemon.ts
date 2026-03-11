import { ChromoCore } from './core';
import { watch } from 'fs';
import { generateIntent } from './intent';
import { execSync } from 'child_process';

export async function startDaemon(options: any) {
  const core = new ChromoCore();
  const watchedFiles = new Set<string>();

  console.log('🚀 Starting Chromo daemon...');

  if (options.background) {
    console.log('Running in background mode');
    // In production, this would use process management
  }

  // Watch current directory recursively
  const watcher = watch(process.cwd(), { recursive: true }, async (eventType, filename) => {
    if (!filename) return;

    const filePath = `${process.cwd()}/${filename}`;

    // Ignore certain directories
    if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('.chromo')) {
      return;
    }

    // Debounce - only snapshot after a short pause
    if (watchedFiles.has(filePath)) {
      return;
    }

    watchedFiles.add(filePath);

    setTimeout(async () => {
      try {
        console.log(`\n📝 Change detected: ${filename}`);

        // Check if this is a dangerous command
        const isDangerous = await detectDangerousCommand(filePath);
        if (isDangerous) {
          console.log('⚠️  Dangerous command detected! Creating pre-emptive snapshot...');
          await core.createCheckpoint([filePath], 'OMEN: Pre-emptive snapshot before dangerous command');
        }

        // Generate intent and create snapshot
        const intent = await generateIntent([filePath]);
        await core.createCheckpoint([filePath], undefined, intent);

        console.log(`✓ Auto-snapshot created: ${intent}`);

      } catch (error) {
        console.error('Error in daemon:', error);
      } finally {
        watchedFiles.delete(filePath);
      }
    }, 1000); // 1 second debounce
  });

  console.log('👀 Watching for file changes...');
  console.log('Press Ctrl+C to stop');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping daemon...');
    watcher.close();
    core.close();
    process.exit(0);
  });
}

async function detectDangerousCommand(filePath: string): Promise<boolean> {
  try {
    const content = await Bun.file(filePath).text();

    const dangerousPatterns = [
      /rm\s+-rf/,
      /drop\s+table/i,
      /truncate\s+table/i,
      /delete\s+from.*where\s+1\s*=\s*1/i,
      /git\s+reset\s+--hard/,
      /rm\s+-rf\s+\//
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
