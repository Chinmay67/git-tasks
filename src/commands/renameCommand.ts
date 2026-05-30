import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';

export function registerRenameCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.renameTask', async (item?: TaskTreeItem) => {
      const taskId = item?.entry.id;
      if (!taskId) {
        return;
      }

      const task = await taskManager.getFullTask(taskId);
      const newName = await vscode.window.showInputBox({
        title: 'Rename Task',
        value: task.name,
        prompt: 'Enter a new name',
        validateInput(value) {
          if (!value || !value.trim()) {
            return 'Task name cannot be empty';
          }
          if (value.trim().length > 100) {
            return 'Task name must be 100 characters or less';
          }
          return null;
        },
      });

      if (!newName || newName.trim() === task.name) {
        return;
      }

      try {
        await taskManager.renameTask(taskId, newName.trim());
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to rename: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
