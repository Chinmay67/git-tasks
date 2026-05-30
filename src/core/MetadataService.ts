import { StorageAdapter } from '../storage/StorageAdapter';
import type { Task } from '../domain/Task';

export class MetadataService {
  constructor(private readonly storage: StorageAdapter) {}

  async rename(task: Task, newName: string): Promise<Task> {
    const now = new Date().toISOString();
    const updated: Task = { ...task, name: newName, updatedAt: now };
    await this.storage.tasks.writeMeta(updated);
    await this.storage.index.upsertEntry({
      id: updated.id,
      name: updated.name,
      status: updated.status,
      changedFileCount: updated.changedFileCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
    return updated;
  }

  async editDescription(task: Task, description: string | null): Promise<Task> {
    const now = new Date().toISOString();
    const updated: Task = { ...task, description, updatedAt: now };
    await this.storage.tasks.writeMeta(updated);
    // Description not stored in index — no index update needed
    return updated;
  }

  async getFullTask(taskId: string): Promise<Task> {
    return this.storage.tasks.readMeta(taskId);
  }
}
