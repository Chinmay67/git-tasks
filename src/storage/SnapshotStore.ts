import * as fs from 'fs/promises';
import * as path from 'path';
import type { UntrackedFileEntry } from '../domain/TaskSnapshot';
import { ensureDir, pathExists } from '../utils/FileUtils';

export interface SnapshotFiles {
  trackedDiff: string;
  stagedDiff: string;
  untrackedFiles: UntrackedFileEntry[];
  capturedAt: string;
  gitVersion: string;
}

export class SnapshotStore {
  constructor(private readonly tasksDir: string) {}

  private snapshotDir(taskId: string): string {
    return path.join(this.tasksDir, taskId);
  }

  async write(taskId: string, snapshot: SnapshotFiles): Promise<void> {
    const dir = this.snapshotDir(taskId);
    await ensureDir(dir);
    await Promise.all([
      fs.writeFile(path.join(dir, 'changes.diff'), snapshot.trackedDiff, 'utf8'),
      fs.writeFile(path.join(dir, 'staged.diff'), snapshot.stagedDiff, 'utf8'),
      fs.writeFile(
        path.join(dir, 'untracked.json'),
        JSON.stringify(
          { capturedAt: snapshot.capturedAt, gitVersion: snapshot.gitVersion, files: snapshot.untrackedFiles },
          null,
          2
        ),
        'utf8'
      ),
    ]);
  }

  async read(taskId: string): Promise<SnapshotFiles> {
    const dir = this.snapshotDir(taskId);
    const [trackedDiff, stagedDiff, untrackedRaw] = await Promise.all([
      fs.readFile(path.join(dir, 'changes.diff'), 'utf8'),
      fs.readFile(path.join(dir, 'staged.diff'), 'utf8'),
      fs.readFile(path.join(dir, 'untracked.json'), 'utf8'),
    ]);
    const untracked = JSON.parse(untrackedRaw) as {
      capturedAt: string;
      gitVersion: string;
      files: UntrackedFileEntry[];
    };
    return {
      trackedDiff,
      stagedDiff,
      untrackedFiles: untracked.files,
      capturedAt: untracked.capturedAt,
      gitVersion: untracked.gitVersion,
    };
  }

  async exists(taskId: string): Promise<boolean> {
    return pathExists(path.join(this.snapshotDir(taskId), 'changes.diff'));
  }
}
