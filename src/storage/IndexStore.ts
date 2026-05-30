import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskIndex } from '../domain/TaskIndex';
import type { TaskIndexEntry } from '../domain/Task';
import { atomicWrite } from '../utils/AtomicWriter';
import { pathExists, readJsonFile } from '../utils/FileUtils';

const SCHEMA_VERSION = 1;

export class IndexStore {
  constructor(private readonly gitTasksDir: string) {}

  private get indexPath(): string {
    return path.join(this.gitTasksDir, 'index.json');
  }

  async read(): Promise<TaskIndex> {
    if (!(await pathExists(this.indexPath))) {
      return this.empty();
    }
    const raw = await readJsonFile<TaskIndex>(this.indexPath);
    return raw;
  }

  async write(index: TaskIndex): Promise<void> {
    await atomicWrite(this.indexPath, JSON.stringify(index, null, 2));
  }

  async upsertEntry(entry: TaskIndexEntry): Promise<void> {
    const index = await this.read();
    const idx = index.tasks.findIndex(t => t.id === entry.id);
    if (idx >= 0) {
      index.tasks[idx] = entry;
    } else {
      index.tasks.push(entry);
    }
    await this.write(index);
  }

  async removeEntry(taskId: string): Promise<void> {
    const index = await this.read();
    index.tasks = index.tasks.filter(t => t.id !== taskId);
    if (index.activeTaskId === taskId) {
      index.activeTaskId = null;
    }
    await this.write(index);
  }

  async setActiveTaskId(taskId: string | null): Promise<void> {
    const index = await this.read();
    index.activeTaskId = taskId;
    await this.write(index);
  }

  private empty(): TaskIndex {
    return { version: SCHEMA_VERSION, activeTaskId: null, tasks: [] };
  }

  /**
   * Rebuilds the index from task meta files on disk. Used for recovery.
   */
  async rebuild(taskStore: { scanAllMeta: () => Promise<import('../domain/Task').Task[]> }): Promise<void> {
    const tasks = await taskStore.scanAllMeta();

    // Detect multiple active: resolve by setting all to paused
    const activeTasks = tasks.filter(t => t.status === 'active');
    if (activeTasks.length > 1) {
      for (const t of activeTasks) {
        t.status = 'paused';
      }
    }

    const entries: TaskIndexEntry[] = tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      changedFileCount: t.changedFileCount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    const activeTaskId = activeTasks.length === 1 ? activeTasks[0].id : null;
    const index: TaskIndex = { version: SCHEMA_VERSION, activeTaskId, tasks: entries };
    await this.write(index);
  }
}
