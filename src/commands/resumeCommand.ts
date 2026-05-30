import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';
import type { TaskTreeItem } from '../ui/TaskTreeItem';

export function registerResumeCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'git-tasks.resumeTask',
      async (arg?: TaskTreeItem | { taskId: string }) => {
        let taskId: string | undefined;

        if (arg && 'taskId' in arg) {
          taskId = arg.taskId;
        } else if (arg && 'entry' in arg) {
          taskId = (arg as TaskTreeItem).entry.id;
        }

        if (!taskId) {
          // Launched from command palette — show quick pick
          const tasks = await taskManager.getAllTasks();
          const paused = tasks.filter(t => t.status === 'paused');
          if (paused.length === 0) {
            vscode.window.showInformationMessage('No paused tasks to resume.');
            return;
          }
          const pick = await vscode.window.showQuickPick(
            paused.map(t => ({
              label: t.name,
              detail: `${t.changedFileCount} file(s) · Created ${new Date(t.createdAt).toLocaleDateString()}`,
              id: t.id,
            })),
            { title: 'Resume Task', placeHolder: 'Select a task to resume' }
          );
          if (!pick) {
            return;
          }
          taskId = pick.id;
        }

        // Check working tree
        let hasUnsaved = false;
        try {
          const tasks = await taskManager.getAllTasks();
          const activeTask = tasks.find(t => t.status === 'active');
          hasUnsaved = !!activeTask;
        } catch { /* ignore */ }

        if (hasUnsaved) {
          const choice = await vscode.window.showWarningMessage(
            'You have unsaved work. Pause current task before resuming another?',
            'Pause & Continue',
            'Cancel'
          );
          if (choice !== 'Pause & Continue') {
            return;
          }
          // Pause the active work first
          const name = await vscode.window.showInputBox({
            title: 'Name the current task before pausing',
            prompt: 'Task name',
            validateInput: v => (!v?.trim() ? 'Name required' : null),
          });
          if (!name) {
            return;
          }
          await taskManager.pauseCurrentWork(name.trim(), null);
        }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Restoring task…', cancellable: false },
          async () => {
            try {
              await taskManager.resumeTask(taskId!);
              const task = await taskManager.getFullTask(taskId!);
              vscode.window.showInformationMessage(`Resumed task "${task.name}".`);
            } catch (err) {
              vscode.window.showErrorMessage(
                `Failed to resume: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        );
      }
    )
  );
}
