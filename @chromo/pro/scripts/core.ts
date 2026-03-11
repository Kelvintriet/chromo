import { mkdir, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { existsSync as existsSyncSync } from 'fs';

export interface Chunk {
  hash: string;
  data: Uint8Array;
  size: number;
}

export interface FileMetadata {
  path: string;
  size: number;
  mtime: number;
  chunks: string[];
  hash: string;
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  message?: string;
  intent?: string;
  files: FileMetadata[];
  envState?: Record<string, string>;
  dependencies?: string;
  processes?: Array<{ name: string, pid: number }>;
  parentId?: string;
  branch?: string;
  isGhost?: boolean;
}

export interface Metadata {
  headCheckpointId?: string;
  currentBranch?: string;
}

// Helper function to compute SHA256 hash
function sha256(data: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  if (typeof data === 'string') {
    hasher.update(data);
  } else {
    hasher.update(data);
  }
  return hasher.digest('hex');
}

export class ChromoCore {
  private db: Database;
  private historyDir: string;
  private blobsDir: string;
  private chunkSize = 64 * 1024; // 64KB chunks

  constructor(historyDir: string = '.chromo') {
    this.historyDir = historyDir;
    this.blobsDir = join(historyDir, 'blobs');

    // Create directories synchronously before creating database
    if (!existsSyncSync(historyDir)) {
      require('fs').mkdirSync(historyDir, { recursive: true });
    }
    if (!existsSyncSync(this.blobsDir)) {
      require('fs').mkdirSync(this.blobsDir, { recursive: true });
    }

    // Auto-create .chromoignore if it doesn't exist
    const ignoreFile = join(historyDir, '.chromoignore');
    if (!existsSyncSync(ignoreFile)) {
      require('fs').writeFileSync(ignoreFile, '');
    }

    this.db = new Database(join(historyDir, 'index.db'), { create: true });
    this.initializeDatabase();
    this.migrateDatabase();
  }

  private async initializeDatabase() {
    // Initialize database schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        hash TEXT PRIMARY KEY,
        size INTEGER,
        ref_count INTEGER DEFAULT 1,
        created_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS files (
        path TEXT,
        checkpoint_id TEXT,
        file_hash TEXT,
        size INTEGER,
        mtime INTEGER,
        chunks TEXT,
        PRIMARY KEY (path, checkpoint_id)
      );
      
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        message TEXT,
        intent TEXT,
        env_state TEXT,
        dependencies TEXT,
        processes TEXT
      );
      
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_files_checkpoint ON files(checkpoint_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp ON checkpoints(timestamp);
    `);

    // Initialize metadata if not exists
    const headExists = this.db.query('SELECT value FROM metadata WHERE key = ?1').get('head');
    if (!headExists) {
      this.db.query('INSERT INTO metadata (key, value) VALUES (?1, ?2)').run('head', '');
      this.db.query('INSERT INTO metadata (key, value) VALUES (?1, ?2)').run('branch', 'main');
    }
  }

  private migrateDatabase() {
    // Add parent_id column if it doesn't exist
    try {
      this.db.exec('ALTER TABLE checkpoints ADD COLUMN parent_id TEXT');
    } catch (error) {
      // Column already exists, ignore
    }

    // Add branch column if it doesn't exist
    try {
      this.db.exec('ALTER TABLE checkpoints ADD COLUMN branch TEXT DEFAULT "main"');
    } catch (error) {
      // Column already exists, ignore
    }

    // Add is_ghost column if it doesn't exist
    try {
      this.db.exec('ALTER TABLE checkpoints ADD COLUMN is_ghost INTEGER DEFAULT 0');
    } catch (error) {
      // Column already exists, ignore
    }

    // Create indexes for new columns
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoints_parent ON checkpoints(parent_id)');
    } catch (error) {
      // Ignore
    }

    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoints_branch ON checkpoints(branch)');
    } catch (error) {
      // Ignore
    }

    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoints_ghost ON checkpoints(is_ghost)');
    } catch (error) {
      // Ignore
    }
  }

  private async chunkFile(filePath: string): Promise<Chunk[]> {
    const fileBuffer = await readFile(filePath);
    const chunks: Chunk[] = [];

    for (let offset = 0; offset < fileBuffer.length; offset += this.chunkSize) {
      const chunkData = fileBuffer.subarray(offset, offset + this.chunkSize);
      const hash = sha256(chunkData);

      chunks.push({
        hash,
        data: chunkData,
        size: chunkData.length
      });
    }

    return chunks;
  }

  private async storeChunk(chunk: Chunk): Promise<void> {
    // Check if chunk already exists
    const existing = this.db.query('SELECT ref_count FROM chunks WHERE hash = ?1').get(chunk.hash) as any;

    if (existing) {
      // Increment reference count
      this.db.query('UPDATE chunks SET ref_count = ref_count + 1 WHERE hash = ?1').run(chunk.hash);
    } else {
      // Store new chunk
      const chunkPath = join(this.blobsDir, chunk.hash);
      await writeFile(chunkPath, chunk.data);

      this.db.query('INSERT INTO chunks (hash, size, ref_count, created_at) VALUES (?1, ?2, ?3, ?4)').run(
        chunk.hash,
        chunk.size,
        1,
        Date.now()
      );
    }
  }

  private async getFileHash(filePath: string): Promise<string> {
    try {
      const fileBuffer = await readFile(filePath);
      return sha256(fileBuffer);
    } catch {
      return '';
    }
  }

  async createCheckpoint(files: string[], message?: string, intent?: string, branch: string = 'main'): Promise<string> {
    // Ensure database is initialized
    await this.initializeDatabase();

    // Get current HEAD as parent
    const metadata = this.getMetadata();
    const parentId = (metadata.headCheckpointId && metadata.headCheckpointId.length > 0) ? metadata.headCheckpointId : null;

    const checkpointId = sha256(`${Date.now()}-${Math.random()}`).substring(0, 12);
    const timestamp = Date.now();

    const fileMetadata: FileMetadata[] = [];

    for (const filePath of files) {
      try {
        const fileStat = await stat(filePath);
        const fileHash = await this.getFileHash(filePath);
        const chunks = await this.chunkFile(filePath);

        // Store chunks
        for (const chunk of chunks) {
          await this.storeChunk(chunk);
        }

        const metadata: FileMetadata = {
          path: filePath,
          size: fileStat.size,
          mtime: fileStat.mtimeMs,
          chunks: chunks.map(c => c.hash),
          hash: fileHash
        };

        fileMetadata.push(metadata);

        // Store file metadata
        this.db.query('INSERT INTO files (path, checkpoint_id, file_hash, size, mtime, chunks) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').run(
          metadata.path,
          checkpointId,
          metadata.hash,
          metadata.size,
          metadata.mtime,
          JSON.stringify(metadata.chunks)
        );

      } catch (error) {
        console.warn(`Warning: Could not process file ${filePath}:`, error);
      }
    }

    // Capture environment state
    const envState = this.captureEnvironmentState();

    // Store checkpoint with parent_id
    this.db.query('INSERT INTO checkpoints (id, timestamp, message, intent, env_state, parent_id, branch, is_ghost) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').run(
      checkpointId,
      timestamp,
      message || null,
      intent || null,
      JSON.stringify(envState),
      parentId,
      branch,
      0  // is_ghost defaults to 0 (false)
    );

    // Update HEAD to this new checkpoint
    this.updateHead(checkpointId, branch);

    return checkpointId;
  }

  private captureEnvironmentState(): Record<string, string> {
    const envState: Record<string, string> = {};

    // Capture .env files if they exist
    try {
      const envFiles = ['.env', '.env.local', '.env.production'];
      for (const envFile of envFiles) {
        if (existsSyncSync(envFile)) {
          envState[envFile] = require('fs').readFileSync(envFile, 'utf-8');
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return envState;
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    const checkpoint = this.db.query('SELECT * FROM checkpoints WHERE id = ?1').get(checkpointId) as any;

    if (!checkpoint) return null;

    const files = this.db.query('SELECT * FROM files WHERE checkpoint_id = ?1').all(checkpointId) as any[];

    return {
      id: checkpoint.id,
      timestamp: checkpoint.timestamp,
      message: checkpoint.message,
      intent: checkpoint.intent,
      files: files.map(f => ({
        path: f.path,
        size: f.size,
        mtime: f.mtime,
        chunks: JSON.parse(f.chunks),
        hash: f.file_hash
      })),
      envState: checkpoint.env_state ? JSON.parse(checkpoint.env_state) : undefined,
      dependencies: checkpoint.dependencies ? JSON.parse(checkpoint.dependencies) : undefined,
      processes: checkpoint.processes ? JSON.parse(checkpoint.processes) : undefined,
      parentId: checkpoint.parent_id,
      branch: checkpoint.branch,
      isGhost: checkpoint.is_ghost === 1
    };
  }

  async reconstructFile(filePath: string, checkpointId: string): Promise<Uint8Array | null> {
    const file = this.db.query('SELECT chunks FROM files WHERE path = ?1 AND checkpoint_id = ?2').get(filePath, checkpointId) as any;

    if (!file) return null;

    const chunkHashes = JSON.parse(file.chunks) as string[];
    const chunks: Uint8Array[] = [];

    for (const hash of chunkHashes) {
      const chunkPath = join(this.blobsDir, hash);
      try {
        const chunkData = await readFile(chunkPath);
        chunks.push(chunkData);
      } catch (error) {
        console.error(`Failed to read chunk ${hash}:`, error);
        return null;
      }
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    const checkpoints = this.db.query('SELECT * FROM checkpoints ORDER BY timestamp DESC').all() as any[];

    return checkpoints.map(cp => ({
      id: cp.id,
      timestamp: cp.timestamp,
      message: cp.message,
      intent: cp.intent,
      files: [],
      envState: cp.env_state ? JSON.parse(cp.env_state) : undefined,
      dependencies: cp.dependencies ? JSON.parse(cp.dependencies) : undefined,
      processes: cp.processes ? JSON.parse(cp.processes) : undefined,
      parentId: cp.parent_id,
      branch: cp.branch
    }));
  }

  getMetadata(): Metadata {
    const headResult = this.db.query('SELECT value FROM metadata WHERE key = ?1').get('head') as any;
    const branchResult = this.db.query('SELECT value FROM metadata WHERE key = ?1').get('branch') as any;

    return {
      headCheckpointId: (headResult?.value && headResult.value.length > 0) ? headResult.value : undefined,
      currentBranch: branchResult?.value || 'main'
    };
  }

  updateHead(checkpointId: string, branch: string = 'main'): void {
    this.db.query('UPDATE metadata SET value = ?1 WHERE key = ?2').run(checkpointId, 'head');
    this.db.query('UPDATE metadata SET value = ?1 WHERE key = ?2').run(branch, 'branch');
  }

  async getCheckpointTree(): Promise<Map<string, Checkpoint[]>> {
    const checkpoints = await this.listCheckpoints();
    const tree = new Map<string, Checkpoint[]>();

    // Group by parent_id
    for (const checkpoint of checkpoints) {
      const parentId = checkpoint.parentId || 'root';
      if (!tree.has(parentId)) {
        tree.set(parentId, []);
      }
      tree.get(parentId)!.push(checkpoint);
    }

    return tree;
  }

  async hasUnsavedChanges(): Promise<boolean> {
    const metadata = this.getMetadata();
    if (!metadata.headCheckpointId) return false;

    const headCheckpoint = await this.getCheckpoint(metadata.headCheckpointId);
    if (!headCheckpoint) return false;

    // Check if any tracked files have been modified
    for (const file of headCheckpoint.files) {
      try {
        const currentHash = await this.getFileHash(file.path);
        if (currentHash !== file.hash) {
          return true;
        }
      } catch {
        // File doesn't exist anymore
        return true;
      }
    }

    return false;
  }

  close() {
    this.db.close();
  }
}