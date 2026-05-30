import * as vscode from 'vscode';
import { extensionState } from '../state/ExtensionState';
import { eventBus } from '../state/EventBus';

export class StatusBarItem {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'workbench.view.extension.git-tasks-sidebar';
    this.update();

    eventBus.on('active-task-changed', () => this.update());
    eventBus.on('tasks-changed', () => this.update());
  }

  update(): void {
    const active = extensionState.activeTask;
    if (active) {
      this.item.text = `$(play-circle) ${active.name}`;
      this.item.tooltip = `Active task: ${active.name}`;
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
