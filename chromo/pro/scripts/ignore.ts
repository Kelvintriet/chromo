import { ChromoCore } from './core';
import { readdir } from 'fs/promises';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

export async function manageIgnores(pattern: string | undefined, options: any) {
  const core = new ChromoCore();
  
  try {
    const ignoreFile = join(core['historyDir'], '.chromoignore');
    
    if (options.list) {
      // List current ignore patterns
      console.log('📋 Current ignore patterns:\n');
      
      try {
        const content = await Bun.file(ignoreFile).text();
        const patterns = content.split('\n').filter((line: string) => line.trim() && !line.startsWith('#'));
        
        if (patterns.length === 0) {
          console.log('   No ignore patterns configured.');
        } else {
          patterns.forEach((pattern: string) => {
            console.log(`   ${chalk.cyan('❌')} ${pattern}`);
          });
        }
      } catch {
        console.log('   No ignore patterns configured.');
      }
      return;
    }
    
    if (options.suggest) {
      // Suggest patterns to ignore based on large directories
      await suggestIgnores(core);
      return;
    }
    
    if (options.add) {
      // Add a pattern
      await addIgnorePattern(ignoreFile, options.add);
      console.log(`✅ Added ignore pattern: ${options.add}`);
      return;
    }
    
    if (options.remove && pattern) {
      // Remove a pattern
      await removeIgnorePattern(ignoreFile, pattern);
      console.log(`✅ Removed ignore pattern: ${pattern}`);
      return;
    }
    
    if (pattern && !options.remove) {
      // Add a pattern (default behavior)
      await addIgnorePattern(ignoreFile, pattern);
      console.log(`✅ Added ignore pattern: ${pattern}`);
      return;
    }
    
    // Show help
    console.log('💡 Usage:');
    console.log('   chromo ignore "*.log"           # Add a pattern');
    console.log('   chromo ignore --add "node_modules"  # Add a pattern');
    console.log('   chromo ignore --remove "*.tmp"      # Remove a pattern');
    console.log('   chromo ignore --list                 # List patterns');
    console.log('   chromo ignore --suggest              # Get suggestions');
    
  } catch (error) {
    console.error('Error managing ignores:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

async function addIgnorePattern(ignoreFile: string, pattern: string): Promise<void> {
  try {
    let content = '';
    try {
      content = await Bun.file(ignoreFile).text();
    } catch {
      // File doesn't exist, create it
    }
    
    // Add the pattern if it doesn't already exist
    const patterns = content.split('\n');
    if (!patterns.includes(pattern)) {
      patterns.push(pattern);
    }
    
    await Bun.write(ignoreFile, patterns.join('\n'));
  } catch (error) {
    throw new Error(`Failed to add ignore pattern: ${error}`);
  }
}

async function removeIgnorePattern(ignoreFile: string, pattern: string): Promise<void> {
  try {
    let content = '';
    try {
      content = await Bun.file(ignoreFile).text();
    } catch {
      return; // File doesn't exist, nothing to remove
    }
    
    const patterns = content.split('\n').filter(p => p.trim() !== pattern);
    await Bun.write(ignoreFile, patterns.join('\n'));
  } catch (error) {
    throw new Error(`Failed to remove ignore pattern: ${error}`);
  }
}

async function suggestIgnores(core: ChromoCore): Promise<void> {
  console.log('🔍 Scanning for large directories to suggest ignoring...\n');
  
  try {
    const entries = await readdir(process.cwd(), { withFileTypes: true });
    const suggestions: { path: string; size: number; reason: string }[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const dirPath = join(process.cwd(), entry.name);
      
      // Skip common small directories
      if (['.git', '.vscode', '.idea'].includes(entry.name)) continue;
      
      try {
        const size = await getDirectorySize(dirPath);
        
        if (size > 100 * 1024 * 1024) { // > 100MB
          suggestions.push({
            path: entry.name,
            size: Math.round(size / (1024 * 1024)),
            reason: 'Very large directory (>100MB)'
          });
        } else if (entry.name === 'node_modules' && size > 50 * 1024 * 1024) { // > 50MB
          suggestions.push({
            path: entry.name,
            size: Math.round(size / (1024 * 1024)),
            reason: 'Large node_modules directory'
          });
        } else if (['dist', 'build', 'out', 'target'].includes(entry.name) && size > 10 * 1024 * 1024) { // > 10MB
          suggestions.push({
            path: entry.name,
            size: Math.round(size / (1024 * 1024)),
            reason: 'Build output directory'
          });
        } else if (entry.name.startsWith('.') && size > 5 * 1024 * 1024) { // > 5MB
          suggestions.push({
            path: entry.name,
            size: Math.round(size / (1024 * 1024)),
            reason: 'Large hidden directory'
          });
        }
      } catch {
        // Skip directories we can't access
        continue;
      }
    }
    
    if (suggestions.length === 0) {
      console.log('🎉 No large directories found that need ignoring!');
      return;
    }
    
    // Sort by size descending
    suggestions.sort((a, b) => b.size - a.size);
    
    console.log('📊 Suggested ignore patterns:');
    console.log('');
    
    for (const suggestion of suggestions) {
      console.log(`   ${chalk.yellow('💡')} ${suggestion.path} (${suggestion.size}MB) - ${suggestion.reason}`);
    }
    
    console.log('');
    const { addAll } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addAll',
        message: 'Add all these patterns to your ignore list?',
        default: false
      }
    ]);
    
    if (addAll) {
      const ignoreFile = join(core['historyDir'], '.chromoignore');
      for (const suggestion of suggestions) {
        await addIgnorePattern(ignoreFile, suggestion.path + '/**');
      }
      console.log(`✅ Added ${suggestions.length} ignore patterns`);
    }
    
  } catch (error) {
    console.error('Error scanning directories:', error);
  }
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  
  async function scanDir(path: string): Promise<void> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = join(path, entry.name);
        
        if (entry.isDirectory()) {
          await scanDir(entryPath);
        } else {
          try {
            const stat = await Bun.file(entryPath).stat();
            totalSize += stat.size;
          } catch {
            // Skip files we can't access
          }
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }
  
  await scanDir(dirPath);
  return totalSize;
}
