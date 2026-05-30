import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';
import { TaskDetailsPanel } from '../ui/TaskDetailsPanel';

export function registerOpenTaskDetailsCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'git-tasks.openTaskDetails',
      async (item?: TaskTreeItem) => {
        const taskId = item?.entry.id;
        if (!taskId) {
          return;
        }
        try {
          const task = await taskManager.getFullTask(taskId);
          TaskDetailsPanel.show(task, taskManager, context.extensionUri);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to open task: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    )
  );
}

export function registerViewFilesCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.viewFiles', async (item?: TaskTreeItem) => {
      const taskId = item?.entry.id;
      if (!taskId) {
        return;
      }
      try {
        const task = await taskManager.getFullTask(taskId);
        TaskDetailsPanel.show(task, taskManager, context.extensionUri);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to view files: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
