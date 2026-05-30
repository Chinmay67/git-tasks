import * as fs from 'fs/promises';
import * as path from 'path';
import { runGit, getGitVersion } from './GitRunner';
import type { WorkingTreeStatus } from './DiffParser';
import type { UntrackedFileEntry } from '../domain/TaskSnapshot';

const MAX_UNTRACKED_FILES = 1000;
const MAX_UNTRACKED_FILE_BYTES = 50 * 1024 * 1024;  // 50 MB per file
const MAX_UNTRACKED_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB total

export interface CaptureResult {
  trackedDiff: string;
  stagedDiff: string;
  untrackedFiles: UntrackedFileEntry[];
  gitVersion: string;
  capturedAt: string;
}

export interface ApplyConflict {
  files: string[];
  rawError: string;
}

export class GitAdapter {
  constructor(private readonly repositoryRoot: string) {}

  async getVersion(): Promise<string> {
    return getGitVersion(this.repositoryRoot);
  }

  async getStatus(): Promise<WorkingTreeStatus> {
    const result = await runGit(
      ['status', '--porcelain', '-u'],
      this.repositoryRoot
    );
    const lines = result.stdout.split('\n').filter(Boolean);

    const trackedChangedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    const stagedFiles: string[] = [];

    for (const line of lines) {
      const xy = line.substring(0, 2);
      const file = line.substring(3);
      const x = xy[0]; // index (staged) status
      const y = xy[1]; // working tree status

      if (xy === '??') {
        untrackedFiles.push(file);
      } else {
        if (x !== ' ' && x !== '?') {
          stagedFiles.push(file);
        }
        if (y !== ' ' && y !== '?') {
          trackedChangedFiles.push(file);
        }
      }
    }

    return {
      isClean: lines.length === 0,
      trackedChangedFiles,
      untrackedFiles,
      stagedFiles,
    };
  }

  async getCurrentBranch(): Promise<string> {
    const result = await runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      this.repositoryRoot
    );
    return result.stdout.trim();
  }

  async getHeadCommitHash(): Promise<string> {
    const result = await runGit(
      ['rev-parse', 'HEAD'],
      this.repositoryRoot
    );
    return result.stdout.trim();
  }

  async captureDiffs(): Promise<{ trackedDiff: string; stagedDiff: string }> {
    const [trackedResult, stagedResult] = await Promise.all([
      runGit(['diff', 'HEAD'], this.repositoryRoot),
      runGit(['diff', '--cached'], this.repositoryRoot),
    ]);
    return {
      trackedDiff: trackedResult.stdout,
      stagedDiff: stagedResult.stdout,
    };
  }

  async captureUntrackedFiles(): Promise<UntrackedFileEntry[]> {
    const result = await runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      this.repositoryRoot
    );
    const filePaths = result.stdout
      .split('\0')
      .filter(Boolean)
      .slice(0, MAX_UNTRACKED_FILES);

    const entries: UntrackedFileEntry[] = [];
    let totalBytes = 0;

    for (const filePath of filePaths) {
      const absPath = path.join(this.repositoryRoot, filePath);
      const stat = await fs.stat(absPath).catch(() => null);
      if (!stat) {
        continue;
      }

      if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
        continue; // skip files that exceed per-file cap
      }
      if (totalBytes + stat.size > MAX_UNTRACKED_TOTAL_BYTES) {
        break; // stop if total cap would be exceeded
      }

      const content = await fs.readFile(absPath);
      totalBytes += content.length;

      // Determine file mode
      const mode = (stat.mode & 0o111) ? '100755' : '100644';

      entries.push({
        path: filePath,
        content: content.toString('base64'),
        mode,
      });
    }

    return entries;
  }

  async cleanWorkingTree(): Promise<void> {
    // Step 1: reset the index back to HEAD (unstages all staged changes)
    await runGit(['reset', 'HEAD', '--'], this.repositoryRoot);
    // Step 2: restore tracked files in the working tree to HEAD
    await runGit(['checkout', '--', '.'], this.repositoryRoot);
    // Step 3: remove untracked files and directories
    await runGit(['clean', '-fd'], this.repositoryRoot);
  }

  /**
   * Dry-run apply of a diff. Returns conflict info if it would fail.
   */
  async checkApply(diffContent: string, cached: boolean): Promise<ApplyConflict | null> {
    if (!diffContent.trim()) {
      return null;
    }
    const args = ['apply', '--check'];
    if (cached) {
      args.push('--cached');
    }
    const result = await runGit(args, this.repositoryRoot, diffContent);
    if (result.exitCode !== 0) {
      const files = extractFilesFromApplyError(result.stderr);
      return { files, rawError: result.stderr };
    }
    return null;
  }

  async applyDiff(diffContent: string, cached: boolean): Promise<void> {
    if (!diffContent.trim()) {
      return;
    }
    const args = ['apply'];
    if (cached) {
      args.push('--cached');
    }
    const result = await runGit(args, this.repositoryRoot, diffContent);
    if (result.exitCode !== 0) {
      throw new Error(`git apply failed: ${result.stderr}`);
    }
  }

  async restoreUntrackedFiles(entries: UntrackedFileEntry[]): Promise<void> {
    for (const entry of entries) {
      const absPath = path.join(this.repositoryRoot, entry.path);
      const dir = path.dirname(absPath);
      await fs.mkdir(dir, { recursive: true });
      const buf = Buffer.from(entry.content, 'base64');
      await fs.writeFile(absPath, buf);
    }
  }
}

function extractFilesFromApplyError(stderr: string): string[] {
  const files: string[] = [];
  for (const line of stderr.split('\n')) {
    const m = line.match(/error: patch failed: (.+):\d+/);
    if (m) {
      files.push(m[1]);
    }
  }
  return [...new Set(files)];
}
