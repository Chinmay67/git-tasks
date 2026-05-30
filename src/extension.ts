import * as vscode from 'vscode';
import { TaskManager } from './core/TaskManager';
import { RepositoryResolver } from './repository/RepositoryResolver';
import { TaskTreeProvider } from './ui/TaskTreeProvider';
import { StatusBarItem } from './ui/StatusBarItem';
import { initLogger, disposeLogger } from './utils/Logger';

import { registerPauseCommand } from './commands/pauseCommand';
import { registerResumeCommand } from './commands/resumeCommand';
import { registerDeleteCommand } from './commands/deleteCommand';
import { registerArchiveCommand } from './commands/archiveCommand';
import { registerRenameCommand } from './commands/renameCommand';
import { registerEditDescriptionCommand } from './commands/editDescriptionCommand';
import { registerOpenTaskDetailsCommand, registerViewFilesCommand } from './commands/viewFilesCommand';
import { registerSearchCommand } from './commands/searchCommand';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger('git-tasks');

  const resolver = new RepositoryResolver();
  const taskManager = new TaskManager(resolver, context.workspaceState);

  // UI components
  const treeProvider = new TaskTreeProvider();
  const statusBarItem = new StatusBarItem();

  const treeView = vscode.window.createTreeView('git-tasks.taskList', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  // Register all commands
  registerPauseCommand(context, taskManager);
  registerResumeCommand(context, taskManager);
  registerDeleteCommand(context, taskManager);
  registerArchiveCommand(context, taskManager);
  registerRenameCommand(context, taskManager);
  registerEditDescriptionCommand(context, taskManager);
  registerOpenTaskDetailsCommand(context, taskManager);
  registerViewFilesCommand(context, taskManager);
  registerSearchCommand(context, taskManager);

  context.subscriptions.push(treeView, { dispose: () => statusBarItem.dispose() });

  // Activate: run startup checks and load state
  await taskManager.activate();
}

export function deactivate(): void {
  disposeLogger();
}
