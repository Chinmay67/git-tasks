import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitAdapter } from '../git/GitAdapter';
import { StorageAdapter } from '../storage/StorageAdapter';
import type { RepositoryContext } from '../domain/RepositoryContext';
import type { Task } from '../domain/Task';
import { generateId } from '../utils/IdGenerator';
import { log } from '../utils/Logger';

const SNAPSHOT_SIZE_WARN_BYTES = 10 * 1024 * 1024;
const SNAPSHOT_SIZE_BLOCK_BYTES = 200 * 1024 * 1024;

export class PauseService {
  constructor(
    private readonly git: GitAdapter,
    private readonly storage: StorageAdapter
  ) {}

  async pause(
    context: RepositoryContext,
    taskName: string,
    description: string | null
  ): Promise<Task> {
    const gitVersion = await this.git.getVersion();
    const now = new Date().toISOString();
    const taskId = generateId();

    const tasksDir = path.join(context.gitTasksDir, 'tasks');
    const tmpDir = path.join(tasksDir, `${taskId}.tmp`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      // Capture diffs
      const { trackedDiff, stagedDiff } = await this.git.captureDiffs();
      const untrackedFiles = await this.git.captureUntrackedFiles();

      // Estimate snapshot size and warn if needed
      const totalSize = Buffer.byteLength(trackedDiff) + Buffer.byteLength(stagedDiff);
      if (totalSize > SNAPSHOT_SIZE_BLOCK_BYTES) {
        throw new Error(
          `Snapshot is too large (${Math.round(totalSize / 1024 / 1024)} MB). ` +
          'Please exclude large files before pausing.'
        );
      }
      if (totalSize > SNAPSHOT_SIZE_WARN_BYTES) {
        log(`Large snapshot warning: ${Math.round(totalSize / 1024 / 1024)} MB`);
      }

      // Write snapshot files to tmp directory
      await fs.writeFile(path.join(tmpDir, 'changes.diff'), trackedDiff, 'utf8');
      await fs.writeFile(path.join(tmpDir, 'staged.diff'), stagedDiff, 'utf8');
      await fs.writeFile(
        path.join(tmpDir, 'untracked.json'),
        JSON.stringify({ capturedAt: now, gitVersion, files: untrackedFiles }, null, 2),
        'utf8'
      );

      // Count changed files
      const status = await this.git.getStatus();
      const changedFileCount =
        new Set([...status.trackedChangedFiles, ...status.stagedFiles]).size +
        status.untrackedFiles.length;

      // Write meta.json to tmp directory
      const task: Task = {
        id: taskId,
        name: taskName,
        description,
        status: 'paused',
        repositoryRoot: context.repositoryRoot,
        branchName: context.activeBranch,
        baseCommitHash: context.headCommitHash,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        changedFileCount,
        snapshotRef: taskId,
      };
      await fs.writeFile(path.join(tmpDir, 'meta.json'), JSON.stringify(task, null, 2), 'utf8');

      // Atomically promote tmp -> final
      const finalDir = path.join(tasksDir, taskId);
      await fs.rename(tmpDir, finalDir);

      // Update persistent metadata (meta.json already in final dir, now sync index)
      await this.storage.tasks.writeMeta(task); // ensures meta in canonical location (same dir)
      await this.storage.index.upsertEntry({
        id: task.id,
        name: task.name,
        status: task.status,
        changedFileCount: task.changedFileCount,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });

      // Clean working tree only after snapshot is safely on disk
      await this.git.cleanWorkingTree();

      return task;
    } catch (err) {
      // Rollback: clean up tmp directory — working tree was never touched
      await fs.rm(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }
}
