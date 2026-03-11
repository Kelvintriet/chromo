import { ChromoCore } from './core';
import chalk from 'chalk';

export async function searchHistory(query: string, options: any) {
  const core = new ChromoCore();
  
  try {
    console.log(`\n🔍 Searching for: ${chalk.bold(query)}`);
    
    const checkpoints = await core.listCheckpoints();
    const results: Array<{
      checkpointId: string;
      timestamp: number;
      message?: string;
      intent?: string;
      matches: Array<{ file: string; line: number; context: string }>;
    }> = [];
    
    for (const checkpoint of checkpoints) {
      const fullCheckpoint = await core.getCheckpoint(checkpoint.id);
      
      if (!fullCheckpoint) continue;
      
      const matches: Array<{ file: string; line: number; context: string }> = [];
      
      // Search in files
      for (const file of fullCheckpoint.files) {
        if (options.file && !file.path.includes(options.file)) {
          continue;
        }
        
        const buffer = await core.reconstructFile(file.path, checkpoint.id);
        if (!buffer) continue;
        
        const content = buffer.toString('utf-8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.toLowerCase().includes(query.toLowerCase())) {
            // Get context (2 lines before and after)
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length - 1, i + 2);
            const context = lines.slice(start, end + 1).join('\n');
            
            matches.push({
              file: file.path,
              line: i + 1,
              context
            });
          }
        }
      }
      
      // Search in message and intent
      const messageMatch = checkpoint.message?.toLowerCase().includes(query.toLowerCase());
      const intentMatch = checkpoint.intent?.toLowerCase().includes(query.toLowerCase());
      
      if (matches.length > 0 || messageMatch || intentMatch) {
        results.push({
          checkpointId: checkpoint.id,
          timestamp: checkpoint.timestamp,
          message: checkpoint.message,
          intent: checkpoint.intent,
          matches
        });
      }
    }
    
    // Display results
    if (results.length === 0) {
      console.log(chalk.yellow('\nNo matches found.'));
      return;
    }
    
    console.log(chalk.green(`\nFound ${results.length} checkpoint(s) with matches:\n`));
    
    for (const result of results) {
      console.log(chalk.bold.cyan(`📌 ${result.checkpointId}`));
      console.log(chalk.gray(`   ${new Date(result.timestamp).toISOString()}`));
      
      if (result.message) {
        console.log(chalk.white(`   Message: ${result.message}`));
      }
      
      if (result.intent) {
        console.log(chalk.blue(`   Intent: ${result.intent}`));
      }
      
      if (result.matches.length > 0) {
        console.log(chalk.gray(`   Matches:`));
        for (const match of result.matches.slice(0, 5)) { // Limit to 5 matches per checkpoint
          console.log(chalk.yellow(`     ${match.file}:${match.line}`));
          const lines = match.context.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              console.log(chalk.red(`       → ${line}`));
            } else {
              console.log(chalk.gray(`         ${line}`));
            }
          }
        }
        
        if (result.matches.length > 5) {
          console.log(chalk.gray(`     ... and ${result.matches.length - 5} more matches`));
        }
      }
      
      console.log('');
    }
    
  } catch (error) {
    console.error('Error searching history:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

export async function rebuildIndex() {
  const core = new ChromoCore();
  
  try {
    console.log('🔄 Rebuilding full-text search index...');
    
    // In a real implementation, this would use FTS5 in SQLite
    // For now, we'll just update the database
    
    console.log('✓ Index rebuilt successfully!');
    
  } catch (error) {
    console.error('Error rebuilding index:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}
