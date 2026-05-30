import * as vscode from 'vscode';

export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
  };
}

export interface GitExtensionAPI {
  repositories: GitRepository[];
}

/**
 * Attempts to get the VS Code built-in Git extension API (version 1).
 * Returns null if the extension is not available.
 */
export function getBuiltinGitApi(): GitExtensionAPI | null {
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: 1): GitExtensionAPI }>(
    'vscode.git'
  );
  if (!gitExtension) {
    return null;
  }
  if (!gitExtension.isActive) {
    return null;
  }
  try {
    return gitExtension.exports.getAPI(1);
  } catch {
    return null;
  }
}
