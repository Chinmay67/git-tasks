import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { Task } from '../domain/Task';
import type { TaskManager } from '../core/TaskManager';

export class TaskDetailsPanel {
  private static current: TaskDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private task: Task;

  static show(task: Task, taskManager: TaskManager, extensionUri: vscode.Uri): void {
    if (TaskDetailsPanel.current) {
      TaskDetailsPanel.current.update(task);
      TaskDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    TaskDetailsPanel.current = new TaskDetailsPanel(task, taskManager, extensionUri);
  }

  private constructor(task: Task, private readonly taskManager: TaskManager, private readonly extensionUri: vscode.Uri) {
    this.task = task;
    this.panel = vscode.window.createWebviewPanel(
      'git-tasks.taskDetails',
      `Task: ${task.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
      }
    );

    this.panel.webview.html = this.buildHtml(task);

    this.panel.webview.onDidReceiveMessage(async (msg: { command: string; taskId?: string }) => {
      switch (msg.command) {
        case 'resume':
          if (msg.taskId) {
            await vscode.commands.executeCommand('git-tasks.resumeTask', { taskId: msg.taskId });
          }
          break;
        case 'archive':
          if (msg.taskId) {
            await vscode.commands.executeCommand('git-tasks.archiveTask', { taskId: msg.taskId });
          }
          break;
      }
    });

    this.panel.onDidDispose(() => {
      TaskDetailsPanel.current = undefined;
    });
  }

  update(task: Task): void {
    this.task = task;
    this.panel.title = `Task: ${task.name}`;
    this.panel.webview.html = this.buildHtml(task);
  }

  private buildHtml(task: Task): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';`;

    const statusBadgeClass = task.status === 'active' ? 'active' : task.status === 'paused' ? 'paused' : 'archived';
    const createdDate = new Date(task.createdAt).toLocaleString();
    const updatedDate = new Date(task.updatedAt).toLocaleString();

    const actionButtons = task.status === 'paused'
      ? `<button onclick="send('resume', '${task.id}')">Resume</button>
         <button onclick="send('archive', '${task.id}')">Archive</button>`
      : task.status === 'active'
        ? `<button onclick="send('pause', '${task.id}')">Pause</button>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Details</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h1 { font-size: 1.2em; margin-bottom: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; }
    .active { background: var(--vscode-testing-runAction); }
    .paused { background: var(--vscode-statusBarItem-warningBackground); }
    .archived { background: var(--vscode-disabledForeground); }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td { padding: 4px 8px; }
    td:first-child { font-weight: bold; width: 30%; }
    button { margin-right: 8px; padding: 6px 14px; cursor: pointer; }
    .description { white-space: pre-wrap; font-style: italic; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>${escapeHtml(task.name)}</h1>
  <span class="badge ${statusBadgeClass}">${task.status}</span>

  ${task.description ? `<p class="description">${escapeHtml(task.description)}</p>` : ''}

  <table>
    <tr><td>Branch</td><td>${escapeHtml(task.branchName)}</td></tr>
    <tr><td>Base commit</td><td><code>${task.baseCommitHash.substring(0, 8)}</code></td></tr>
    <tr><td>Changed files</td><td>${task.changedFileCount}</td></tr>
    <tr><td>Created</td><td>${createdDate}</td></tr>
    <tr><td>Last updated</td><td>${updatedDate}</td></tr>
  </table>

  <div>${actionButtons}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function send(command, taskId) {
      vscode.postMessage({ command, taskId });
    }
  </script>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
