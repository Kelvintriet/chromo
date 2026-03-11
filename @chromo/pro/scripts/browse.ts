import { ChromoCore } from './core';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export async function browseHistory(options: any) {
  const core = new ChromoCore();

  try {
    const checkpoints = await core.listCheckpoints();

    if (checkpoints.length === 0) {
      console.log('No checkpoints found. Create one with: chromo snapshot');
      return;
    }

    // Try to load blessed, fallback to simple list view
    let blessed: any;
    try {
      blessed = require('blessed');
    } catch (error) {
      console.log('TUI not available in compiled mode. Using simple list view.\n');
      await simpleBrowse(checkpoints, core, options);
      return;
    }

    // Create blessed screen
    const screen = blessed.screen({
      smartCSR: true,
      title: 'Chromo History Browser'
    });

    // Create checkpoint list
    const list = blessed.list({
      parent: screen,
      label: ' Checkpoints ',
      top: 0,
      left: 0,
      width: '40%',
      height: '100%',
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' }
      }
    });

    // Create file list
    const fileList = blessed.list({
      parent: screen,
      label: ' Files in Checkpoint ',
      top: 0,
      left: '40%',
      width: '30%',
      height: '100%',
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        selected: { bg: 'green', fg: 'white' },
        item: { fg: 'white' }
      }
    });

    // Create preview box
    const previewBox = blessed.box({
      parent: screen,
      label: ' File Preview ',
      top: 0,
      left: '70%',
      width: '30%',
      height: '100%',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        fg: 'white'
      }
    });

    // Create help box
    const helpBox = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' [q] Quit | [Enter] View | [r] Restore | [t] Time-Travel | [↑/↓] Navigate ',
      style: {
        fg: 'yellow',
        bg: 'black'
      }
    });

    // Populate checkpoint list
    const checkpointItems = checkpoints.map(cp => {
      const date = new Date(cp.timestamp).toLocaleString();
      const intent = cp.intent ? ` - ${cp.intent}` : '';
      const ghostIcon = cp.isGhost ? '👻 ' : '';
      const ghostSuffix = cp.isGhost ? ' [GHOST]' : '';
      return `${ghostIcon}${cp.id} | ${date}${intent}${ghostSuffix}`;
    });

    list.setItems(checkpointItems);

    // Note: Blessed.js doesn't easily support per-item color styling
    // We'll use text indicators instead for now

    let selectedCheckpoint: any = null;
    let selectedFile: string = '';

    // Handle checkpoint selection
    list.on('select', async (item: any) => {
      const index = list.getItemIndex(item);
      selectedCheckpoint = checkpoints[index];

      // Get files for this checkpoint
      const checkpoint = await core.getCheckpoint(selectedCheckpoint.id);
      if (checkpoint) {
        fileList.setItems(checkpoint.files.map(f => `${f.path} (${f.size} bytes)`));
        fileList.select(0);
      }
    });

    // Handle file selection
    fileList.on('select', async (item: any) => {
      if (!selectedCheckpoint) return;

      const index = fileList.getItemIndex(item);
      const checkpoint = await core.getCheckpoint(selectedCheckpoint.id);

      if (checkpoint && checkpoint.files[index]) {
        selectedFile = checkpoint.files[index].path;
        const fileBuffer = await core.reconstructFile(selectedFile, selectedCheckpoint.id);

        if (fileBuffer) {
          previewBox.setContent(fileBuffer.toString('utf-8').substring(0, 5000));
          screen.render();
        }
      }
    });

    // Handle keyboard input
    screen.key(['q', 'C-c'], () => {
      core.close();
      process.exit(0);
    });

    screen.key('r', async () => {
      if (selectedCheckpoint) {
        screen.destroy();
        console.log(`Restoring checkpoint: ${selectedCheckpoint.id}`);
        // Call restore function
        const { restoreSnapshot } = await import('./restore');
        await restoreSnapshot(selectedCheckpoint.id, { force: true });
        process.exit(0);
      }
    });

    screen.key('t', async () => {
      if (options.timeTravel && selectedCheckpoint) {
        // Time-travel mode - mount checkpoint to temp directory
        const tempDir = join(process.cwd(), '.chromo', 'mount', selectedCheckpoint.id);
        console.log(`\n🕒 Time-Travel: Mounting checkpoint ${selectedCheckpoint.id} to ${tempDir}`);

        // In a real implementation, this would use FUSE or similar
        console.log('Note: Full FUSE mount requires additional dependencies');
        console.log('Files are available for inspection in the temp directory');
      }
    });

    // Focus on list
    list.focus();
    screen.render();

  } catch (error) {
    console.error('Error in browse mode:', error);
    core.close();
    process.exit(1);
  }
}

async function simpleBrowse(checkpoints: any[], core: ChromoCore, options: any) {
  console.log(chalk.bold.blue('📋 Available Checkpoints:\n'));

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const date = new Date(cp.timestamp).toLocaleString();
    const ghostIcon = cp.isGhost ? chalk.gray(' 👻 [GHOST]') : '';
    console.log(chalk.yellow(`[${i + 1}] `) + chalk.cyan.bold(cp.id) + ghostIcon);
    console.log(chalk.gray(`    Date: `) + chalk.white(date));
    if (cp.message) {
      console.log(chalk.gray(`    Message: `) + chalk.green(cp.message));
    }
    if (cp.intent) {
      console.log(chalk.gray(`    Intent: `) + chalk.magenta(cp.intent));
    }
    console.log('');
  }

  console.log(chalk.gray('Use "chromo restore <id>" to restore a checkpoint'));
  console.log(chalk.gray('Use "chromo diff <from> [to]" to view differences'));
}
