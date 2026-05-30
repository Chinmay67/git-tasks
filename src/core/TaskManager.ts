import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitAdapter } from '../git/GitAdapter';
import { StorageAdapter } from '../storage/StorageAdapter';
import { RepositoryResolver } from '../repository/RepositoryResolver';
import { PauseService } from './PauseService';
import { ResumeService } from './ResumeService';
import { ArchiveService } from './ArchiveService';
import { MetadataService } from './MetadataService';
import { SearchService } from './SearchService';
import { eventBus } from '../state/EventBus';
import { extensionState } from '../state/ExtensionState';
import { log, logError } from '../utils/Logger';
import type { RepositoryContext } from '../domain/RepositoryContext';
import type { Task, TaskIndexEntry } from '../domain/Task';

export class TaskManager {
  private storageMap = new Map<string, StorageAdapter>();
  private gitMap = new Map<string, GitAdapter>();

  constructor(
    private readonly resolver: RepositoryResolver,
    private readonly workspaceState: vscode.Memento
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async activate(): Promise<void> {
    const ctx = await this.resolver.resolve();
    if (!ctx) {
      return;
    }

    const storage = await this.getStorage(ctx);
    const stale = await storage.cleanupStaleTmpDirs();
    if (stale.length > 0) {
      log(`Cleaned up ${stale.length} stale tmp directories from previous crash`);
    }

    await this.checkResumeInProgress(ctx);
    await this.refreshState(ctx, storage);
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  async pauseCurrentWork(taskName: string, description: string | null): Promise<Task> {
    const { ctx, storage, git } = await this.resolveAll();

    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, taskName, description);

    // If a task was active, mark it as paused in state
    const index = await storage.index.read();
    if (index.activeTaskId && index.activeTaskId !== task.id) {
      const prevTask = await storage.tasks.readMeta(index.activeTaskId).catch(() => null);
      if (prevTask) {
        const updated = { ...prevTask, status: 'paused' as const, updatedAt: new Date().toISOString() };
        await storage.tasks.writeMeta(updated);
        await storage.index.upsertEntry({
          id: updated.id, name: updated.name, status: updated.status,
          changedFileCount: updated.changedFileCount,
          createdAt: updated.createdAt, updatedAt: updated.updatedAt,
        });
      }
    }
    await storage.index.setActiveTaskId(null);

    await this.refreshState(ctx, storage);
    eventBus.emit('task-paused', task);
    eventBus.emit('tasks-changed', undefined);
    return task;
  }

  async resumeTask(taskId: string): Promise<void> {
    const { ctx, storage, git } = await this.resolveAll();

    const task = await storage.tasks.readMeta(taskId);
    if (task.status !== 'paused') {
      throw new Error(`Task "${task.name}" is not paused (status: ${task.status})`);
    }

    // Mark resume-in-progress for crash detection
    await this.workspaceState.update('git-tasks.resumeInProgress', taskId);

    const resumeService = new ResumeService(git, storage);
    const conflict = await resumeService.resume(ctx, task);

    if (conflict) {
      await this.workspaceState.update('git-tasks.resumeInProgress', undefined);
      throw new Error(
        `Could not restore task "${task.name}" — patch conflicts in:\n` +
        conflict.files.join('\n')
      );
    }

    await this.workspaceState.update('git-tasks.resumeInProgress', undefined);

    const resumedTask = await storage.tasks.readMeta(taskId);
    await this.refreshState(ctx, storage);
    eventBus.emit('task-resumed', resumedTask);
    eventBus.emit('active-task-changed', resumedTask);
    eventBus.emit('tasks-changed', undefined);
  }

  async archiveTask(taskId: string): Promise<void> {
    const { ctx, storage } = await this.resolveAll();
    const task = await storage.tasks.readMeta(taskId);

    const archiveService = new ArchiveService(storage);
    const archived = await archiveService.archive(task);

    await this.refreshState(ctx, storage);
    eventBus.emit('task-archived', archived);
    eventBus.emit('tasks-changed', undefined);
  }

  async deleteTask(taskId: string): Promise<void> {
    const { ctx, storage } = await this.resolveAll();
    const task = await storage.tasks.readMeta(taskId);

    if (task.status === 'active') {
      throw new Error('Cannot delete the currently active task. Pause it first.');
    }

    const archiveService = new ArchiveService(storage);
    await archiveService.delete(task);

    await this.refreshState(ctx, storage);
    eventBus.emit('task-deleted', taskId);
    eventBus.emit('tasks-changed', undefined);
  }

  async renameTask(taskId: string, newName: string): Promise<Task> {
    const { ctx, storage } = await this.resolveAll();
    const task = await storage.tasks.readMeta(taskId);

    const metaService = new MetadataService(storage);
    const updated = await metaService.rename(task, newName);

    await this.refreshState(ctx, storage);
    eventBus.emit('task-renamed', updated);
    eventBus.emit('tasks-changed', undefined);
    return updated;
  }

  async editDescription(taskId: string, description: string | null): Promise<Task> {
    const { ctx, storage } = await this.resolveAll();
    const task = await storage.tasks.readMeta(taskId);

    const metaService = new MetadataService(storage);
    const updated = await metaService.editDescription(task, description);

    await this.refreshState(ctx, storage);
    eventBus.emit('tasks-changed', undefined);
    return updated;
  }

  async getFullTask(taskId: string): Promise<Task> {
    const { storage } = await this.resolveAll();
    return storage.tasks.readMeta(taskId);
  }

  async getAllTasks(): Promise<TaskIndexEntry[]> {
    const { storage } = await this.resolveAll();
    const index = await storage.index.read();
    return index.tasks;
  }

  async searchTasks(query: string): Promise<TaskIndexEntry[]> {
    const { storage } = await this.resolveAll();
    const searchService = new SearchService(storage);
    return searchService.search(query);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async resolveAll(): Promise<{
    ctx: RepositoryContext;
    storage: StorageAdapter;
    git: GitAdapter;
  }> {
    const ctx = await this.resolver.resolve();
    if (!ctx) {
      throw new Error('No Git repository found in the current workspace.');
    }
    const storage = await this.getStorage(ctx);
    const git = this.getGit(ctx);
    return { ctx, storage, git };
  }

  private async getStorage(ctx: RepositoryContext): Promise<StorageAdapter> {
    if (!this.storageMap.has(ctx.repositoryRoot)) {
      const storage = new StorageAdapter(ctx.gitTasksDir);
      await storage.initialize();
      this.storageMap.set(ctx.repositoryRoot, storage);
    }
    return this.storageMap.get(ctx.repositoryRoot)!;
  }

  private getGit(ctx: RepositoryContext): GitAdapter {
    if (!this.gitMap.has(ctx.repositoryRoot)) {
      this.gitMap.set(ctx.repositoryRoot, new GitAdapter(ctx.repositoryRoot));
    }
    return this.gitMap.get(ctx.repositoryRoot)!;
  }

  private async refreshState(ctx: RepositoryContext, storage: StorageAdapter): Promise<void> {
    const index = await storage.index.read();
    const activeTask = index.activeTaskId
      ? await storage.tasks.readMeta(index.activeTaskId).catch(() => null)
      : null;

    extensionState.update({
      activeTask,
      tasks: index.tasks,
      repositoryRoot: ctx.repositoryRoot,
    });

    this.workspaceState.update('git-tasks.lastRepoRoot', ctx.repositoryRoot);
  }

  private async checkResumeInProgress(ctx: RepositoryContext): Promise<void> {
    const inProgress = this.workspaceState.get<string>('git-tasks.resumeInProgress');
    if (!inProgress) {
      return;
    }

    log(`Detected interrupted resume for task ${inProgress}`);
    await this.workspaceState.update('git-tasks.resumeInProgress', undefined);

    vscode.window.showWarningMessage(
      'A resume operation may have been interrupted. The working tree may be in a partial state.',
      'Reset Working Tree',
      'Leave As Is'
    ).then(async choice => {
      if (choice === 'Reset Working Tree') {
        const git = this.getGit(ctx);
        await git.cleanWorkingTree().catch(e => logError('Failed to reset working tree', e));
      }
    });
  }
}
