import { StorageAdapter } from '../storage/StorageAdapter';
import type { Task } from '../domain/Task';
import type { TaskIndexEntry } from '../domain/Task';

export class SearchService {
  private descriptionCache = new Map<string, string | null>();

  constructor(private readonly storage: StorageAdapter) {}

  async search(query: string): Promise<TaskIndexEntry[]> {
    const index = await this.storage.index.read();
    const q = query.toLowerCase();

    const results: TaskIndexEntry[] = [];

    for (const entry of index.tasks) {
      if (entry.name.toLowerCase().includes(q)) {
        results.push(entry);
        continue;
      }

      const description = await this.getDescription(entry.id);
      if (description && description.toLowerCase().includes(q)) {
        results.push(entry);
      }
    }

    return results;
  }

  clearCache(): void {
    this.descriptionCache.clear();
  }

  private async getDescription(taskId: string): Promise<string | null> {
    if (this.descriptionCache.has(taskId)) {
      return this.descriptionCache.get(taskId)!;
    }
    try {
      const meta = await this.storage.tasks.readMeta(taskId);
      this.descriptionCache.set(taskId, meta.description);
      return meta.description;
    } catch {
      this.descriptionCache.set(taskId, null);
      return null;
    }
  }
}
