import { GitAdapter } from '../git/GitAdapter';
import { StorageAdapter } from '../storage/StorageAdapter';
import type { RepositoryContext } from '../domain/RepositoryContext';
import type { Task } from '../domain/Task';
import { log } from '../utils/Logger';

export interface ResumeConflict {
  type: 'apply-failed';
  files: string[];
  rawError: string;
}

export class ResumeService {
  constructor(
    private readonly git: GitAdapter,
    private readonly storage: StorageAdapter
  ) {}

  async resume(context: RepositoryContext, task: Task): Promise<ResumeConflict | null> {
    // Safety check: working tree must be clean
    const status = await this.git.getStatus();
    if (!status.isClean) {
      throw new Error(
        'Working tree has uncommitted changes. Pause or discard them before resuming.'
      );
    }

    // Warn if branch differs
    if (task.branchName !== context.activeBranch) {
      log(
        `Branch mismatch: task was created on "${task.branchName}", ` +
        `currently on "${context.activeBranch}"`
      );
    }

    // Warn if HEAD has moved
    if (task.baseCommitHash !== context.headCommitHash) {
      log(
        `HEAD moved since task was paused. ` +
        `Task base: ${task.baseCommitHash.substring(0, 8)}, ` +
        `Current: ${context.headCommitHash.substring(0, 8)}`
      );
    }

    const snapshot = await this.storage.snapshots.read(task.id);

    // Dry-run apply to detect conflicts before touching working tree
    const stagedConflict = await this.git.checkApply(snapshot.stagedDiff, true);
    if (stagedConflict) {
      return { type: 'apply-failed', files: stagedConflict.files, rawError: stagedConflict.rawError };
    }
    const trackedConflict = await this.git.checkApply(snapshot.trackedDiff, false);
    if (trackedConflict) {
      return { type: 'apply-failed', files: trackedConflict.files, rawError: trackedConflict.rawError };
    }

    // Apply — staged first, then working tree changes
    try {
      await this.git.applyDiff(snapshot.stagedDiff, true);
      await this.git.applyDiff(snapshot.trackedDiff, false);
      await this.git.restoreUntrackedFiles(snapshot.untrackedFiles);
    } catch (err) {
      // Rollback partial apply
      await this.git.cleanWorkingTree().catch(() => undefined);
      throw err;
    }

    // Update metadata
    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...task,
      status: 'active',
      lastOpenedAt: now,
      updatedAt: now,
    };

    await this.storage.tasks.writeMeta(updatedTask);
    await this.storage.index.upsertEntry({
      id: updatedTask.id,
      name: updatedTask.name,
      status: updatedTask.status,
      changedFileCount: updatedTask.changedFileCount,
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt,
    });
    await this.storage.index.setActiveTaskId(updatedTask.id);

    return null;
  }
}
