import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';

export function registerArchiveCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.archiveTask', async (item?: TaskTreeItem | { taskId: string }) => {
      let taskId: string | undefined;

      if (item && 'taskId' in item) {
        taskId = item.taskId;
      } else if (item && 'entry' in item) {
        taskId = (item as TaskTreeItem).entry.id;
      }

      if (!taskId) {
        return;
      }

      try {
        await taskManager.archiveTask(taskId);
        const task = await taskManager.getFullTask(taskId);
        vscode.window.showInformationMessage(`Task "${task.name}" archived.`);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to archive: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );
}
