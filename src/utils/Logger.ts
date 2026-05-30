import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(name: string): void {
  outputChannel = vscode.window.createOutputChannel(name);
}

export function getLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    throw new Error('Logger not initialized. Call initLogger() first.');
  }
  return outputChannel;
}

export function log(message: string): void {
  getLogger().appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? `: ${err.message}` : '';
  getLogger().appendLine(`[${new Date().toISOString()}] ERROR ${message}${detail}`);
}

export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
