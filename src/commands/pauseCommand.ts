import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';

export function registerPauseCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.pauseCurrentTask', async () => {
      // Check if working tree has changes
      const name = await vscode.window.showInputBox({
        title: 'Pause Current Task',
        prompt: 'Enter a name for this task',
        placeHolder: 'e.g. Fix auth bug',
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

      if (!name) {
        return; // User cancelled
      }

      const description = await vscode.window.showInputBox({
        title: 'Add a description (optional)',
        prompt: 'Optional notes for this task',
        placeHolder: 'Leave blank to skip',
      });

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Saving task…', cancellable: false },
        async () => {
          try {
            const task = await taskManager.pauseCurrentWork(
              name.trim(),
              description?.trim() || null
            );
            vscode.window.showInformationMessage(`Task "${task.name}" saved.`);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Failed to pause: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      );
    })
  );
}
