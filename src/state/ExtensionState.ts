import type { Task, TaskIndexEntry } from '../domain/Task';

export interface ExtensionStateData {
  activeTask: Task | null;
  tasks: TaskIndexEntry[];
  repositoryRoot: string | null;
}

class ExtensionState {
  private _activeTask: Task | null = null;
  private _tasks: TaskIndexEntry[] = [];
  private _repositoryRoot: string | null = null;

  get activeTask(): Task | null {
    return this._activeTask;
  }

  get tasks(): TaskIndexEntry[] {
    return this._tasks;
  }

  get repositoryRoot(): string | null {
    return this._repositoryRoot;
  }

  update(data: Partial<ExtensionStateData>): void {
    if (data.activeTask !== undefined) {
      this._activeTask = data.activeTask;
    }
    if (data.tasks !== undefined) {
      this._tasks = data.tasks;
    }
    if (data.repositoryRoot !== undefined) {
      this._repositoryRoot = data.repositoryRoot;
    }
  }

  clear(): void {
    this._activeTask = null;
    this._tasks = [];
    this._repositoryRoot = null;
  }
}

export const extensionState = new ExtensionState();
