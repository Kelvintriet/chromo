import { execSync } from 'child_process';
import { readFile } from 'fs/promises';

export async function generateIntent(files: string[]): Promise<string> {
  try {
    // Try to get git diff to understand what changed
    let gitDiff = '';
    let gitStatus = '';
    
    try {
      gitStatus = execSync('git status --short', { 
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      
      gitDiff = execSync('git diff --cached', { 
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      
      if (!gitDiff) {
        gitDiff = execSync('git diff', { 
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
      }
    } catch (error) {
      // Not a git repo or git not available
    }
    
    // Analyze the changes
    const analysis = await analyzeChanges(files, gitDiff, gitStatus);
    
    return analysis;
    
  } catch (error) {
    console.error('Error generating intent:', error);
    return 'Manual checkpoint';
  }
}

async function analyzeChanges(files: string[], gitDiff: string, gitStatus: string): Promise<string> {
  const changes: string[] = [];
  
  // Analyze file types
  const fileTypes = new Map<string, number>();
  for (const file of files) {
    const ext = file.split('.').pop() || 'unknown';
    fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);
  }
  
  // Detect common patterns
  const patterns = {
    'Added': [/^\+\s*function/, /^\+\s*const/, /^\+\s*let/, /^\+\s*import/],
    'Removed': [/^-\s*function/, /^-\s*const/, /^-\s*let/, /^-\s*import/],
    'Modified': [/^[+-].*console\.log/, /^[+-].*TODO/, /^[+-].*FIXME/],
    'Fixed': [/bug/i, /fix/i, /error/i, /issue/i],
    'Refactored': [/refactor/i, /optimize/i, /clean/i],
    'Tests': [/test/i, /spec/i, /\.test\./, /\.spec\./],
    'Config': [/\.config\./, /\.env/, /package\.json/, /tsconfig\.json/],
    'Documentation': [/\.md$/, /README/, /\.txt$/],
    'Styles': [/\.css$/, /\.scss$/, /\.sass$/, /\.less$/],
    'UI': [/component/, /view/, /page/, /screen/],
    'API': [/api/, /endpoint/, /route/, /controller/],
    'Database': [/model/, /schema/, /migration/, /query/, /sql/],
    'Auth': [/auth/, /login/, /password/, /token/, /jwt/]
  };
  
  // Analyze git diff for patterns
  const diffLines = gitDiff.split('\n');
  
  for (const [action, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(gitDiff) || regex.test(gitStatus) || files.some(f => regex.test(f))) {
        if (!changes.includes(action)) {
          changes.push(action);
        }
      }
    }
  }
  
  // Analyze specific file content
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      
      // Look for specific keywords
      if (content.includes('export') && content.includes('function')) {
        if (!changes.includes('Added function')) {
          changes.push('Added function');
        }
      }
      
      if (content.includes('class ')) {
        if (!changes.includes('Added class')) {
          changes.push('Added class');
        }
      }
      
      if (content.includes('interface ') || content.includes('type ')) {
        if (!changes.includes('Added type definition')) {
          changes.push('Added type definition');
        }
      }
      
      if (content.includes('import')) {
        if (!changes.includes('Updated imports')) {
          changes.push('Updated imports');
        }
      }
      
    } catch (error) {
      // Ignore read errors
    }
  }
  
  // Build intent string
  if (changes.length === 0) {
    return `Updated ${files.length} file(s)`;
  }
  
  // Prioritize and format changes
  const prioritized = prioritizeChanges(changes);
  return prioritized.join(', ');
}

function prioritizeChanges(changes: string[]): string[] {
  const priority = [
    'Fixed',
    'Added',
    'Removed',
    'Refactored',
    'Tests',
    'API',
    'Database',
    'Auth',
    'UI',
    'Documentation',
    'Config',
    'Styles',
    'Added function',
    'Added class',
    'Added type definition',
    'Updated imports',
    'Modified'
  ];
  
  // Sort by priority
  return changes.sort((a, b) => {
    const indexA = priority.indexOf(a);
    const indexB = priority.indexOf(b);
    
    // If both are in priority list, sort by index
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    
    // If only one is in priority list, prioritize it
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    
    // Neither is in priority list, keep original order
    return 0;
  });
}

// Future: Integrate with local LLM for more sophisticated intent detection
export async function generateIntentWithLLM(files: string[], gitDiff: string): Promise<string> {
  // This would use a local LLM via Bun's FFI or API
  // For now, return the simple analysis
  return generateIntent(files);
}
