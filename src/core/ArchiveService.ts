import { StorageAdapter } from '../storage/StorageAdapter';
import type { Task } from '../domain/Task';

export class ArchiveService {
  constructor(private readonly storage: StorageAdapter) {}

  async archive(task: Task): Promise<Task> {
    const now = new Date().toISOString();
    const updated: Task = { ...task, status: 'archived', updatedAt: now };
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

  async delete(task: Task): Promise<void> {
    // Remove from index first (index is the read cache)
    await this.storage.index.removeEntry(task.id);
    // Then delete snapshot directory
    await this.storage.tasks.deleteTaskDir(task.id);
  }
}
