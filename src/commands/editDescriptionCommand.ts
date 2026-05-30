import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';

export function registerEditDescriptionCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.editDescription', async (item?: TaskTreeItem) => {
      const taskId = item?.entry.id;
      if (!taskId) {
        return;
      }

      const task = await taskManager.getFullTask(taskId);
      const description = await vscode.window.showInputBox({
        title: 'Edit Description',
        value: task.description ?? '',
        prompt: 'Enter a description (leave blank to clear)',
      });

      if (description === undefined) {
        return; // cancelled
      }

      try {
        await taskManager.editDescription(taskId, description.trim() || null);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to update description: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
