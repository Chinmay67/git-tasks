import * as vscode from 'vscode';
import { TaskTreeItem, TaskGroupItem } from './TaskTreeItem';
import { extensionState } from '../state/ExtensionState';
import { eventBus } from '../state/EventBus';
import type { TaskIndexEntry } from '../domain/Task';

type TreeNode = TaskGroupItem | TaskTreeItem;

export class TaskTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    // Refresh tree whenever tasks change
    eventBus.on('tasks-changed', () => this.refresh());
    eventBus.on('active-task-changed', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof TaskGroupItem) {
      return element.children;
    }

    // Root level: three groups
    const tasks = extensionState.tasks;
    const activeTask = extensionState.activeTask;

    const activeTasks: TaskIndexEntry[] = tasks.filter(t => t.status === 'active');
    const pausedTasks: TaskIndexEntry[] = tasks.filter(t => t.status === 'paused');
    const archivedTasks: TaskIndexEntry[] = tasks.filter(t => t.status === 'archived');

    const activeItems = activeTasks.map(t => new TaskTreeItem(t, 'active'));
    const pausedItems = pausedTasks.map(t => new TaskTreeItem(t, 'paused'));
    const archivedItems = archivedTasks.map(t => new TaskTreeItem(t, 'archived'));

    return [
      new TaskGroupItem('Current', activeItems),
      new TaskGroupItem('Paused', pausedItems),
      new TaskGroupItem('Archived', archivedItems),
    ];
  }
}
