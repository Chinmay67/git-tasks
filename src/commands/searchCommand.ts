import * as vscode from 'vscode';
import type { TaskManager } from '../core/TaskManager';

export function registerSearchCommand(
  context: vscode.ExtensionContext,
  taskManager: TaskManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.searchTasks', async () => {
      const allTasks = await taskManager.getAllTasks().catch(() => []);

      const pick = await vscode.window.showQuickPick(
        allTasks.map(t => ({
          label: t.name,
          description: t.status,
          detail: `${t.changedFileCount} file(s) · ${new Date(t.createdAt).toLocaleDateString()}`,
          id: t.id,
        })),
        {
          title: 'Search Tasks',
          placeHolder: 'Type to filter tasks by name…',
          matchOnDescription: true,
          matchOnDetail: true,
        }
      );

      if (pick) {
        await vscode.commands.executeCommand('git-tasks.openTaskDetails', { entry: { id: pick.id } });
      }
    })
  );
}
