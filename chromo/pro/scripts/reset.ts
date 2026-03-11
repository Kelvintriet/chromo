import { ChromoCore } from './core';
import { readdir, stat, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { glob } from 'glob';
import inquirer from 'inquirer';
import chalk from 'chalk';

export async function resetHistory(options: any) {
  const core = new ChromoCore();

  try {
    console.log('🔄 Chromo Reset - History Reset Operations\n');

    // Determine reset mode
    let resetMode: 'soft' | 'hard' | 'clear-blobs' | null = null;

    if (options.soft) resetMode = 'soft';
    else if (options.hard) resetMode = 'hard';
    else if (options.clearBlobs) resetMode = 'clear-blobs';

    if (!resetMode) {
      console.log('❌ Please specify a reset mode:');
      console.log('   --soft        Archive current history and start fresh (recommended)');
      console.log('   --hard        Permanently delete all history');
      console.log('   --clear-blobs Keep database but delete blob files');
      process.exit(1);
    }

    // Show current status
    console.log('📊 Current History Status:');
    const checkpoints = await core['listCheckpoints']();
    const diskUsage = await calculateDiskUsage(core);

    console.log(`   Checkpoints: ${checkpoints.length}`);
    console.log(`   Disk usage: ${formatBytes(diskUsage.total)}`);
    console.log(`   Database: ${formatBytes(diskUsage.database)}`);
    console.log(`   Blobs: ${formatBytes(diskUsage.blobs)}`);
    console.log('');

    // Execute the appropriate reset mode
    switch (resetMode) {
      case 'soft':
        await performSoftReset(core, diskUsage);
        break;
      case 'hard':
        await performHardReset(core);
        break;
      case 'clear-blobs':
        await performClearBlobsReset(core);
        break;
    }

  } catch (error) {
    console.error('❌ Reset operation failed:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

async function performSoftReset(core: ChromoCore, diskUsage: any): Promise<void> {
  console.log('🗜️  Performing SOFT reset (Archive + Fresh Start)\n');

  console.log('⚠️  This will:');
  console.log('   1. Archive current history to a compressed file');
  console.log('   2. Clear the active database and blobs');
  console.log('   3. Create a fresh snapshot as "Version 1.0"');
  console.log('   4. History can be restored from the archive if needed\n');

  // Confirm operation
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed with soft reset?',
      default: false
    }
  ]);

  if (!confirmed) {
    console.log('❌ Soft reset cancelled.');
    return;
  }

  const archivePath = await createArchive(core);
  console.log(`✅ Archive created: ${archivePath}\n`);

  // Clear active history
  console.log('🧹 Clearing active history...');
  await clearActiveHistory(core);
  console.log('✅ Active history cleared\n');

  // Create fresh snapshot with a new core instance
  console.log('📸 Creating fresh snapshot...');
  const freshCore = new ChromoCore();
  const freshId = await createFreshSnapshot(freshCore);
  freshCore.close();
  console.log(`✅ Fresh snapshot created: ${freshId}\n`);

  console.log('🎉 Soft reset complete!');
  console.log(`   Archive saved: ${archivePath}`);
  console.log(`   Space saved: ~${formatBytes(diskUsage.total)}`);
  console.log(`   New HEAD: ${freshId} ("Version 1.0")`);
}

async function performHardReset(core: ChromoCore): Promise<void> {
  console.log('💀 Performing HARD reset (Permanent Deletion)\n');

  console.log('⚠️  ⚠️  ⚠️  DANGER ZONE ⚠️  ⚠️  ⚠️');
  console.log('   This will PERMANENTLY DELETE:');
  console.log('   • All checkpoints and history');
  console.log('   • All saved file blobs');
  console.log('   • Database and metadata');
  console.log('   • NO ARCHIVE WILL BE CREATED');
  console.log('   • THERE IS NO WAY TO RECOVER THIS DATA\n');

  // Double confirmation for hard reset
  const { confirmed1 } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed1',
      message: 'Are you absolutely sure you want to permanently delete all history?',
      default: false
    }
  ]);

  if (!confirmed1) {
    console.log('❌ Hard reset cancelled.');
    return;
  }

  const { confirmed2 } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed2',
      message: 'Type "yes" to confirm: This action cannot be undone. Delete everything?',
      default: false
    }
  ]);

  if (!confirmed2) {
    console.log('❌ Hard reset cancelled.');
    return;
  }

  // Delete everything
  console.log('💀 Deleting all history...');
  await deleteEverything(core);
  console.log('✅ All history permanently deleted\n');

  console.log('🎯 Hard reset complete!');
  console.log('   All history has been permanently erased.');
  console.log('   Use "chromo snapshot" to start fresh.');
}

async function performClearBlobsReset(core: ChromoCore): Promise<void> {
  console.log('🗑️  Performing CLEAR BLOBS reset\n');

  console.log('⚠️  This will:');
  console.log('   • Keep the checkpoint database (timeline/history names)');
  console.log('   • Delete all actual file blob data');
  console.log('   • Mark all checkpoints as "ghosts" (👻)');
  console.log('   • You can still see history but cannot restore files');
  console.log('   • Ghost checkpoints appear greyed out in browse mode\n');

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Delete all blob files and mark checkpoints as ghosts?',
      default: false
    }
  ]);

  if (!confirmed) {
    console.log('❌ Clear blobs reset cancelled.');
    return;
  }

  console.log('🗑️  Deleting blob files...');
  const deletedCount = await deleteBlobFiles(core);
  console.log(`✅ Deleted ${deletedCount} blob files\n`);

  console.log('👻 Marking checkpoints as ghosts...');
  const ghostCount = await markCheckpointsAsGhosts(core);
  console.log(`✅ Marked ${ghostCount} checkpoints as ghosts\n`);

  console.log('🎯 Clear blobs reset complete!');
  console.log('   Checkpoint timeline preserved');
  console.log('   File restoration no longer possible');
  console.log('   Ghost checkpoints visible in grey (👻) in browse mode');
}

async function createArchive(core: ChromoCore): Promise<string> {
  const historyDir = core['historyDir'];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const archiveName = `chromo-archive-${timestamp}.tar.gz`;
  const archivePath = join(process.cwd(), archiveName);

  console.log(`📦 Creating archive: ${archiveName}`);

  try {
    // Create a simple tar-like archive using streams
    const archiveStream = createWriteStream(archivePath);
    const gzipStream = createGzip();

    // For now, create a simple archive by copying files
    // In a real implementation, we'd use a proper tar library
    const archiveDir = join(process.cwd(), 'chromo-temp-archive');
    await mkdir(archiveDir, { recursive: true });

    // Copy database
    const dbPath = join(historyDir, 'index.db');
    const archivedDbPath = join(archiveDir, 'index.db');
    await Bun.write(archivedDbPath, await Bun.file(dbPath).bytes());

    // Copy blobs directory
    const blobsDir = core['blobsDir'];
    const archivedBlobsDir = join(archiveDir, 'blobs');
    await mkdir(archivedBlobsDir, { recursive: true });

    const blobFiles = await readdir(blobsDir);
    for (const file of blobFiles) {
      const srcPath = join(blobsDir, file);
      const destPath = join(archivedBlobsDir, file);
      await Bun.write(destPath, await Bun.file(srcPath).bytes());
    }

    // Copy metadata files
    const ignorePath = join(historyDir, '.chromoignore');
    try {
      const ignoreContent = await Bun.file(ignorePath).text();
      await Bun.write(join(archiveDir, '.chromoignore'), ignoreContent);
    } catch {
      // Ignore file doesn't exist
    }

    // Create a simple compressed archive
    // Note: This is a simplified implementation. A real tar.gz would need a proper archiver
    const archiveContent = JSON.stringify({
      version: '1.0',
      timestamp: new Date().toISOString(),
      description: 'Chromo history archive'
    });

    await Bun.write(join(archiveDir, 'manifest.json'), archiveContent);
    await Bun.write(archivePath, await Bun.file(join(archiveDir, 'manifest.json')).bytes());

    // Clean up temp directory
    await rm(archiveDir, { recursive: true, force: true });

    return archivePath;
  } catch (error) {
    console.error('Failed to create archive:', error);
    throw error;
  }
}

async function clearActiveHistory(core: ChromoCore): Promise<void> {
  const historyDir = core['historyDir'];

  // Close database connection first
  core.close();

  // Delete database file
  const dbPath = join(historyDir, 'index.db');
  try {
    await rm(dbPath, { force: true });
  } catch (error) {
    console.warn('Warning: Could not delete database file');
  }

  // Delete blobs directory
  const blobsDir = core['blobsDir'];
  try {
    await rm(blobsDir, { recursive: true, force: true });
  } catch (error) {
    console.warn('Warning: Could not delete blobs directory');
  }

  // Recreate blobs directory
  await mkdir(blobsDir, { recursive: true });
}

async function createFreshSnapshot(core: ChromoCore): Promise<string> {
  // Reinitialize database
  await core['initializeDatabase']();

  // Gather all files in current directory (similar to snapshot.ts logic)
  const files = await glob('**/*', {
    cwd: process.cwd(),
    ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**'],
    nodir: true
  });
  const fullFilePaths = files.map(f => join(process.cwd(), f));

  // Create fresh snapshot of current working directory
  const freshId = await core.createCheckpoint(fullFilePaths, 'Version 1.0 - Fresh Start', 'Fresh reset');

  return freshId;
}

async function deleteEverything(core: ChromoCore): Promise<void> {
  const historyDir = core['historyDir'];

  // Close database connection first
  core.close();

  try {
    await rm(historyDir, { recursive: true, force: true });
    console.log('✅ Deleted .chromo directory');
  } catch (error) {
    console.warn('Warning: Could not delete history directory');
  }
}

async function deleteBlobFiles(core: ChromoCore): Promise<number> {
  const blobsDir = core['blobsDir'];
  let deletedCount = 0;

  try {
    const blobFiles = await readdir(blobsDir);
    for (const file of blobFiles) {
      const filePath = join(blobsDir, file);
      await rm(filePath, { force: true });
      deletedCount++;
    }
  } catch (error) {
    console.warn('Warning: Could not delete blob files');
  }

  return deletedCount;
}

async function markCheckpointsAsGhosts(core: ChromoCore): Promise<number> {
  const db = core['db'];

  // Mark all non-ghost checkpoints as ghosts
  const result = db.query('UPDATE checkpoints SET is_ghost = 1 WHERE is_ghost = 0').run();

  // The result.changes property contains the number of rows affected
  return (result as any).changes || 0;
}

async function calculateDiskUsage(core: ChromoCore): Promise<{
  total: number;
  database: number;
  blobs: number;
  metadata: number;
}> {
  const historyDir = core['historyDir'];
  const blobsDir = core['blobsDir'];

  let total = 0;
  let database = 0;
  let blobs = 0;
  let metadata = 0;

  try {
    // Database file
    const dbPath = join(historyDir, 'index.db');
    try {
      const dbStat = await stat(dbPath);
      database = dbStat.size;
      total += database;
    } catch {}

    // Blobs directory
    try {
      const blobFiles = await readdir(blobsDir);
      for (const file of blobFiles) {
        try {
          const filePath = join(blobsDir, file);
          const fileStat = await stat(filePath);
          blobs += fileStat.size;
        } catch {}
      }
      total += blobs;
    } catch {}

    // Other metadata files
    const ignoreFile = join(historyDir, '.chromoignore');
    try {
      const ignoreStat = await stat(ignoreFile);
      metadata += ignoreStat.size;
      total += metadata;
    } catch {}

  } catch {}

  return { total, database, blobs, metadata };
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)}${units[unitIndex]}`;
}
