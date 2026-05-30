import * as vscode from 'vscode';
import * as path from 'path';
import { runGit } from '../git/GitRunner';
import { getBuiltinGitApi } from './GitExtensionAdapter';
import type { RepositoryContext } from '../domain/RepositoryContext';

export class RepositoryResolver {
  /**
   * Resolves the active repository context for the current workspace state.
   * Returns null if no Git repository is found.
   */
  async resolve(): Promise<RepositoryContext | null> {
    const root = await this.findRepositoryRoot();
    if (!root) {
      return null;
    }

    const [branchResult, headResult, statusResult] = await Promise.all([
      runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
      runGit(['rev-parse', 'HEAD'], root),
      runGit(['status', '--porcelain', '-u'], root),
    ]);

    const activeBranch = branchResult.stdout.trim();
    const headCommitHash = headResult.stdout.trim();
    const isClean = statusResult.stdout.trim().length === 0;

    return {
      repositoryRoot: root,
      activeBranch,
      headCommitHash,
      isClean,
      gitTasksDir: path.join(root, '.git', 'git-tasks'),
    };
  }

  private async findRepositoryRoot(): Promise<string | null> {
    // Strategy 1: VS Code built-in Git extension
    const gitApi = getBuiltinGitApi();
    if (gitApi && gitApi.repositories.length > 0) {
      const repo = this.pickActiveRepo(gitApi.repositories.map(r => r.rootUri.fsPath));
      if (repo) {
        return repo;
      }
    }

    // Strategy 2: fallback — git rev-parse from workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    for (const folder of workspaceFolders) {
      const result = await runGit(
        ['rev-parse', '--show-toplevel'],
        folder.uri.fsPath
      ).catch(() => null);
      if (result && result.exitCode === 0) {
        return result.stdout.trim();
      }
    }

    return null;
  }

  private pickActiveRepo(roots: string[]): string | null {
    if (roots.length === 0) {
      return null;
    }
    // Prefer the repo containing the currently active editor file
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activeFile) {
      const match = roots.find(r => activeFile.startsWith(r));
      if (match) {
        return match;
      }
    }
    // Fallback: first repo
    return roots[0];
  }
}
