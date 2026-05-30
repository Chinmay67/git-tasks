import * as fs from 'fs/promises';
import * as path from 'path';
import { IndexStore } from './IndexStore';
import { TaskStore } from './TaskStore';
import { SnapshotStore } from './SnapshotStore';
import { ensureDir, pathExists } from '../utils/FileUtils';
import { log, logError } from '../utils/Logger';

const CURRENT_SCHEMA_VERSION = 1;

export class StorageAdapter {
  public readonly index: IndexStore;
  public readonly tasks: TaskStore;
  public readonly snapshots: SnapshotStore;

  constructor(public readonly gitTasksDir: string) {
    const tasksDir = path.join(gitTasksDir, 'tasks');
    this.index = new IndexStore(gitTasksDir);
    this.tasks = new TaskStore(tasksDir);
    this.snapshots = new SnapshotStore(tasksDir);
  }

  async initialize(): Promise<void> {
    await ensureDir(path.join(this.gitTasksDir, 'tasks'));

    const indexPath = path.join(this.gitTasksDir, 'index.json');
    if (!(await pathExists(indexPath))) {
      await this.index.write({ version: CURRENT_SCHEMA_VERSION, activeTaskId: null, tasks: [] });
    } else {
      await this.checkAndMigrate(indexPath);
    }
  }

  private async checkAndMigrate(indexPath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(indexPath, 'utf8');
      const data = JSON.parse(raw) as { version?: number };

      if (!data.version || data.version < CURRENT_SCHEMA_VERSION) {
        log(`Migrating index from version ${data.version ?? 'unknown'} to ${CURRENT_SCHEMA_VERSION}`);
        // Future migrations go here
      }
    } catch {
      logError('index.json is corrupt — rebuilding from task directories');
      // Backup corrupt file
      const ts = Date.now();
      await fs.rename(indexPath, `${indexPath}.corrupt.${ts}`).catch(() => undefined);
      await this.index.rebuild(this.tasks);
    }
  }

  /** Clean up any .tmp task directories left by crashed operations */
  async cleanupStaleTmpDirs(): Promise<string[]> {
    const stale = await this.tasks.findStaleTemporaryDirs();
    for (const dir of stale) {
      await fs.rm(dir, { recursive: true, force: true });
      log(`Removed stale tmp dir: ${dir}`);
    }
    return stale;
  }
}
