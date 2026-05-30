import * as vscode from 'vscode';
import type { Task, TaskIndexEntry, TaskStatus } from '../domain/Task';

export class TaskTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: TaskIndexEntry,
    public readonly taskStatus: TaskStatus
  ) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = entry.name;
    this.description = `${entry.changedFileCount} file${entry.changedFileCount !== 1 ? 's' : ''}`;
    this.contextValue = `git-tasks.task.${taskStatus}`;
    this.iconPath = this.resolveIcon(taskStatus);
  }

  private resolveIcon(status: TaskStatus): vscode.ThemeIcon {
    switch (status) {
      case 'active':
        return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('testing.runAction'));
      case 'paused':
        return new vscode.ThemeIcon('debug-pause');
      case 'archived':
        return new vscode.ThemeIcon('archive');
    }
  }
}

export class TaskGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly children: TaskTreeItem[]
  ) {
    super(
      groupLabel,
      children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = 'git-tasks.group';
    this.description = children.length > 0 ? String(children.length) : '';
  }
}
