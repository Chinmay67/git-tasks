import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';

export function registerDeleteCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.deleteTask', async (item?: TaskTreeItem) => {
      const taskId = item?.entry.id;
      if (!taskId) {
        return;
      }

      const task = await taskManager.getFullTask(taskId);
      const confirm = await vscode.window.showWarningMessage(
        `Delete task "${task.name}"? This cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') {
        return;
      }

      try {
        await taskManager.deleteTask(taskId);
        vscode.window.showInformationMessage(`Task "${task.name}" deleted.`);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to delete: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
