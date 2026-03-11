import { ChromoCore } from './core';
import chalk from 'chalk';

export async function showGraph() {
  const core = new ChromoCore();
  
  try {
    // Use direct database access instead of class methods
    const metadata = getMetadataDirect(core);
    const checkpoints = await listCheckpointsDirect(core);
    
    if (checkpoints.length === 0) {
      console.log('No checkpoints found. Create one with: chromo snapshot');
      return;
    }
    
    console.log('\n🌳 Chromo Undo Tree\n');
    
    // Build a tree structure
    const tree = buildCheckpointTreeDirect(checkpoints);
    
    // Find root nodes (checkpoints with no parent)
    const roots = checkpoints.filter((cp: any) => !cp.parentId);
    
    // Display the tree
    for (const root of roots) {
      displayNode(root, tree, '', metadata.headCheckpointId, true);
    }
    
    console.log('\n📌 Legend:');
    console.log(`  ${chalk.green('*')} = Checkpoint`);
    console.log(`  ${chalk.yellow('[HEAD]')} = Current position`);
    console.log(`  ${chalk.cyan('|')} = Parent-child relationship`);
    console.log(`  ${chalk.gray('/')} = Branch point`);
    
    console.log(`\n💡 Tip: Use "chromo restore <id>" to jump to any checkpoint`);
    console.log(`         This creates a new branch if you jump to a past checkpoint\n`);
    
  } catch (error) {
    console.error('Error showing graph:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}

interface TreeNode {
  checkpoint: any;
  children: TreeNode[];
}

function getMetadataDirect(core: any): any {
  const db = core['db'];
  const headResult = db.query('SELECT value FROM metadata WHERE key = ?1').get('head');
  const branchResult = db.query('SELECT value FROM metadata WHERE key = ?1').get('branch');
  
  return {
    headCheckpointId: headResult?.value || undefined,
    currentBranch: branchResult?.value || 'main'
  };
}

async function listCheckpointsDirect(core: any): Promise<any[]> {
  const db = core['db'];
  const checkpoints = db.query('SELECT * FROM checkpoints ORDER BY timestamp DESC').all();
  
  return checkpoints.map((cp: any) => ({
    id: cp.id,
    timestamp: cp.timestamp,
    message: cp.message,
    intent: cp.intent,
    parentId: cp.parent_id,
    branch: cp.branch
  }));
}

function buildCheckpointTreeDirect(checkpoints: any[]): Map<string, TreeNode> {
  const nodeMap = new Map<string, TreeNode>();
  
  // Create nodes for all checkpoints
  for (const cp of checkpoints) {
    nodeMap.set(cp.id, {
      checkpoint: cp,
      children: []
    });
  }
  
  // Build the tree structure
  for (const cp of checkpoints) {
    if (cp.parentId && nodeMap.has(cp.parentId)) {
      const parentNode = nodeMap.get(cp.parentId)!;
      parentNode.children.push(nodeMap.get(cp.id)!);
    }
  }
  
  return nodeMap;
}

function displayNode(
  checkpoint: any,
  tree: Map<string, TreeNode>,
  prefix: string,
  headId: string | undefined,
  isLast: boolean = true
): void {
  const isHead = checkpoint.id === headId;
  const node = tree.get(checkpoint.id);
  const children = node?.children || [];
  
  // Choose symbols based on position
  const branchSymbol = isLast ? '└──' : '├──';
  const continueSymbol = isLast ? '    ' : '│   ';
  const bulletSymbol = isHead ? '🚀' : '📍';
  
  // Format the checkpoint line with colors
  const timestamp = new Date(checkpoint.timestamp).toLocaleTimeString();
  const message = checkpoint.message || checkpoint.intent || 'No message';
  const headMarker = isHead ? chalk.bgGreen.black(' HEAD ') : '';
  const branchInfo = chalk.gray(`[${checkpoint.branch || 'main'}]`);
  
  // Truncate long messages
  const shortMessage = message.length > 60 ? message.substring(0, 57) + '...' : message;
  
  // Build the display line
  const line = `${prefix}${chalk.cyan(branchSymbol)} ${bulletSymbol} ${chalk.green(checkpoint.id)} ${headMarker} ${chalk.white(shortMessage)} ${branchInfo}`;
  const timeLine = `${prefix}${chalk.gray(continueSymbol)} ${chalk.gray('🕒')} ${chalk.gray(timestamp)}`;
  
  console.log(line);
  console.log(timeLine);
  
  // Display children
  if (children.length > 0) {
    const newPrefix = prefix + chalk.gray(continueSymbol);
    
    // Sort children by timestamp (newest first)
    const sortedChildren = [...children].sort((a, b) => 
      b.checkpoint.timestamp - a.checkpoint.timestamp
    );
    
    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i];
      const isLastChild = i === sortedChildren.length - 1;
      displayNode(child.checkpoint, tree, newPrefix, headId, isLastChild);
    }
  }
}

export async function showLog() {
  const core = new ChromoCore();
  
  try {
    const metadata = getMetadataDirect(core);
    const checkpoints = await listCheckpointsDirect(core);
    
    if (checkpoints.length === 0) {
      console.log('No checkpoints found.');
      return;
    }
    
    console.log('\n📜 Chromo Log\n');
    
    // Display checkpoints in reverse chronological order
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const isHead = cp.id === metadata.headCheckpointId;
      const timestamp = new Date(cp.timestamp).toLocaleString();
      const message = cp.message || cp.intent || 'No message';
      const branch = cp.branch || 'main';
      const parent = cp.parentId || 'root';
      
      const headMarker = isHead ? chalk.yellow(' [HEAD]') : '';
      const branchMarker = chalk.cyan(`(${branch})`);
      
      console.log(`${chalk.green(cp.id)} ${headMarker} ${branchMarker}`);
      console.log(`  ${chalk.gray(timestamp)} - ${chalk.white(message)}`);
      console.log(`  Parent: ${chalk.cyan(parent)}`);
      console.log('');
    }
    
  } catch (error) {
    console.error('Error showing log:', error);
    process.exit(1);
  } finally {
    core.close();
  }
}
