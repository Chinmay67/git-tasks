import * as fs from 'fs/promises';
import * as path from 'path';
import type { Task } from '../domain/Task';
import { atomicWrite } from '../utils/AtomicWriter';
import { pathExists, readJsonFile, listSubdirectories, ensureDir } from '../utils/FileUtils';

export class TaskStore {
  constructor(private readonly tasksDir: string) {}

  private taskDir(taskId: string): string {
    return path.join(this.tasksDir, taskId);
  }

  private metaPath(taskId: string): string {
    return path.join(this.taskDir(taskId), 'meta.json');
  }

  async readMeta(taskId: string): Promise<Task> {
    return readJsonFile<Task>(this.metaPath(taskId));
  }

  async writeMeta(task: Task): Promise<void> {
    await ensureDir(this.taskDir(task.id));
    await atomicWrite(this.metaPath(task.id), JSON.stringify(task, null, 2));
  }

  async taskDirExists(taskId: string): Promise<boolean> {
    return pathExists(this.taskDir(taskId));
  }

  async deleteTaskDir(taskId: string): Promise<void> {
    await fs.rm(this.taskDir(taskId), { recursive: true, force: true });
  }

  async scanAllMeta(): Promise<Task[]> {
    if (!(await pathExists(this.tasksDir))) {
      return [];
    }
    const dirs = await listSubdirectories(this.tasksDir);
    const tasks: Task[] = [];
    for (const dir of dirs) {
      // Skip .tmp and .bak directories
      if (dir.endsWith('.tmp') || dir.endsWith('.bak')) {
        continue;
      }
      try {
        const meta = await readJsonFile<Task>(
          path.join(this.tasksDir, dir, 'meta.json')
        );
        tasks.push(meta);
      } catch {
        // corrupted or missing meta — skip, handled by recovery
      }
    }
    return tasks;
  }

  /** Returns list of stale .tmp directories left by crashed operations */
  async findStaleTemporaryDirs(): Promise<string[]> {
    if (!(await pathExists(this.tasksDir))) {
      return [];
    }
    const dirs = await listSubdirectories(this.tasksDir);
    return dirs
      .filter(d => d.endsWith('.tmp'))
      .map(d => path.join(this.tasksDir, d));
  }

  getTaskDir(taskId: string): string {
    return this.taskDir(taskId);
  }
}
