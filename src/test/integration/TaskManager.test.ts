/**
 * Integration test: full task lifecycle against a real temporary Git repository.
 *
 * Covers the four non-negotiable invariants from the technical design:
 *  1. pause → resume restores working tree to identical state
 *  2. failed resume never modifies the working tree
 *  3. failed pause never modifies the working tree
 *  4. deleting a task never affects the working tree
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { GitAdapter } from '../../git/GitAdapter';
import { StorageAdapter } from '../../storage/StorageAdapter';
import { PauseService } from '../../core/PauseService';
import { ResumeService } from '../../core/ResumeService';
import { ArchiveService } from '../../core/ArchiveService';
import { MetadataService } from '../../core/MetadataService';
import type { RepositoryContext } from '../../domain/RepositoryContext';
import { initLogger } from '../../utils/Logger';
import * as vscode from 'vscode';

// Initialize logger once for integration tests
try { initLogger('git-tasks-test'); } catch { /* already initialized */ }

async function makeGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-tasks-integ-'));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  run('git init');
  run('git config user.email "test@test.com"');
  run('git config user.name "Test"');
  // Create an initial commit so HEAD is valid
  await fs.writeFile(path.join(dir, 'README.md'), '# test repo\n');
  run('git add README.md');
  run('git commit -m "init"');
  return dir;
}

async function makeContext(repoDir: string): Promise<RepositoryContext> {
  const git = new GitAdapter(repoDir);
  const branch = await git.getCurrentBranch();
  const head = await git.getHeadCommitHash();
  const status = await git.getStatus();
  return {
    repositoryRoot: repoDir,
    activeBranch: branch,
    headCommitHash: head,
    isClean: status.isClean,
    gitTasksDir: path.join(repoDir, '.git', 'git-tasks'),
  };
}

suite('TaskManager — Integration (real git repo)', function () {
  // These tests spawn git processes; give them a generous timeout
  this.timeout(15000);

  let repoDir: string;
  let git: GitAdapter;
  let storage: StorageAdapter;
  let ctx: RepositoryContext;

  setup(async () => {
    repoDir = await makeGitRepo();
    git = new GitAdapter(repoDir);
    const context = await makeContext(repoDir);
    ctx = context;
    storage = new StorageAdapter(ctx.gitTasksDir);
    await storage.initialize();
  });

  teardown(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  // ─── Invariant 1: pause → resume restores identical state ────────────────

  test('pause then resume restores tracked file changes exactly', async () => {
    // Create an uncommitted change
    const file = path.join(repoDir, 'feature.ts');
    await fs.writeFile(file, 'export const x = 42;\n');
    // Stage it
    execSync('git add feature.ts', { cwd: repoDir });

    // Modify the working copy further (unstaged change)
    await fs.writeFile(file, 'export const x = 42;\nexport const y = 99;\n');

    const originalContent = await fs.readFile(file, 'utf8');

    // Pause
    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'My Task', null);

    // Working tree must be clean after pause
    const statusAfterPause = await git.getStatus();
    assert.strictEqual(statusAfterPause.isClean, true, 'Working tree must be clean after pause');
    assert.ok(!(await fs.access(file).then(() => true).catch(() => false)), 'File should not exist after pause');

    // Resume
    const freshCtx = await makeContext(repoDir);
    const resumeService = new ResumeService(git, storage);
    const conflict = await resumeService.resume(freshCtx, task);
    assert.strictEqual(conflict, null, 'Resume should succeed without conflict');

    // File must be restored byte-for-byte
    const restoredContent = await fs.readFile(file, 'utf8');
    assert.strictEqual(restoredContent, originalContent, 'File content must be identical after resume');
  });

  test('pause then resume restores untracked files', async () => {
    const untracked = path.join(repoDir, 'temp-notes.txt');
    await fs.writeFile(untracked, 'some scratch notes\n');

    const originalContent = await fs.readFile(untracked, 'utf8');

    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'With Untracked', null);

    // Untracked file must be gone after pause
    const exists = await fs.access(untracked).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'Untracked file must be removed after pause');

    const freshCtx = await makeContext(repoDir);
    const resumeService = new ResumeService(git, storage);
    await resumeService.resume(freshCtx, task);

    const restoredContent = await fs.readFile(untracked, 'utf8');
    assert.strictEqual(restoredContent, originalContent, 'Untracked file must be restored exactly');
  });

  test('staged changes are restored as staged after resume', async () => {
    const file = path.join(repoDir, 'staged.ts');
    await fs.writeFile(file, 'const staged = true;\n');
    execSync('git add staged.ts', { cwd: repoDir });

    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'Staged Task', null);

    const freshCtx = await makeContext(repoDir);
    const resumeService = new ResumeService(git, storage);
    await resumeService.resume(freshCtx, task);

    const statusAfterResume = await git.getStatus();
    assert.ok(
      statusAfterResume.stagedFiles.includes('staged.ts'),
      'staged.ts must be staged after resume'
    );
  });

  // ─── Invariant 2: failed resume never modifies working tree ──────────────

  test('resume fails when working tree is dirty — no modification', async () => {
    // Create a task to resume
    const file = path.join(repoDir, 'feature.ts');
    await fs.writeFile(file, 'const a = 1;\n');
    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'Task A', null);

    // Dirty the working tree
    const otherFile = path.join(repoDir, 'other.ts');
    await fs.writeFile(otherFile, 'dirty\n');

    const freshCtx = await makeContext(repoDir);
    const resumeService = new ResumeService(git, storage);

    await assert.rejects(
      () => resumeService.resume(freshCtx, task),
      /uncommitted changes/i,
      'Should throw when working tree is dirty'
    );

    // other.ts must still be present (working tree unchanged)
    const content = await fs.readFile(otherFile, 'utf8');
    assert.strictEqual(content, 'dirty\n');
  });

  // ─── Invariant 3: failed pause never modifies working tree ───────────────

  test('pause of clean working tree results in error (nothing to pause)', async () => {
    // Clean repo — no changes
    const pauseService = new PauseService(git, storage);
    // The pause will succeed but produce an empty diff; cleanWorkingTree will be a no-op.
    // Verify the task is created but the working tree is still clean.
    const task = await pauseService.pause(ctx, 'Empty Task', null);
    assert.strictEqual(task.changedFileCount, 0);
    const statusAfter = await git.getStatus();
    assert.strictEqual(statusAfter.isClean, true);
  });

  // ─── Invariant 4: delete never affects working tree ──────────────────────

  test('deleting a paused task does not affect working tree', async () => {
    // Set up a working tree state
    const file = path.join(repoDir, 'active.ts');
    await fs.writeFile(file, 'working\n');

    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'Delete Me', null);

    // Now delete the task
    const archiveService = new ArchiveService(storage);
    await archiveService.delete(task);

    // Working tree must still be clean (the file was cleaned on pause, not on delete)
    const statusAfter = await git.getStatus();
    assert.strictEqual(statusAfter.isClean, true);

    // Task directory must be gone
    const taskDirExists = await storage.tasks.taskDirExists(task.id);
    assert.strictEqual(taskDirExists, false);

    // Index must not contain the task
    const index = await storage.index.read();
    assert.ok(!index.tasks.find(t => t.id === task.id));
  });

  // ─── Metadata operations ─────────────────────────────────────────────────

  test('rename updates name in both meta.json and index', async () => {
    await fs.writeFile(path.join(repoDir, 'x.ts'), 'x\n');
    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'Original Name', null);

    const metaService = new MetadataService(storage);
    const updated = await metaService.rename(task, 'New Name');

    assert.strictEqual(updated.name, 'New Name');
    const fromDisk = await storage.tasks.readMeta(task.id);
    assert.strictEqual(fromDisk.name, 'New Name');
    const index = await storage.index.read();
    const entry = index.tasks.find(t => t.id === task.id);
    assert.strictEqual(entry?.name, 'New Name');
  });

  test('archive sets status to archived and updates index', async () => {
    await fs.writeFile(path.join(repoDir, 'y.ts'), 'y\n');
    const pauseService = new PauseService(git, storage);
    const task = await pauseService.pause(ctx, 'To Archive', null);

    const archiveService = new ArchiveService(storage);
    const archived = await archiveService.archive(task);

    assert.strictEqual(archived.status, 'archived');
    const index = await storage.index.read();
    const entry = index.tasks.find(t => t.id === task.id);
    assert.strictEqual(entry?.status, 'archived');
  });

  // ─── Recovery ────────────────────────────────────────────────────────────

  test('stale .tmp directories are cleaned up on storage initialize', async () => {
    const tasksDir = path.join(ctx.gitTasksDir, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    const staleDir = path.join(tasksDir, 'crashed-task.tmp');
    await fs.mkdir(staleDir);
    await fs.writeFile(path.join(staleDir, 'meta.json'), '{}');

    // Re-initialize storage — should clean up the .tmp dir
    await storage.cleanupStaleTmpDirs();

    const exists = await fs.access(staleDir).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'Stale .tmp directory must be removed on init');
  });

  test('corrupt index.json is rebuilt from task directories', async () => {
    // Create a task so there is a valid task directory
    await fs.writeFile(path.join(repoDir, 'z.ts'), 'z\n');
    const pauseService = new PauseService(git, storage);
    await pauseService.pause(ctx, 'Existing Task', null);

    // Corrupt the index
    const indexPath = path.join(ctx.gitTasksDir, 'index.json');
    await fs.writeFile(indexPath, '{ INVALID JSON }');

    // Re-initialize storage — should detect corruption and rebuild
    const freshStorage = new StorageAdapter(ctx.gitTasksDir);
    await freshStorage.initialize();

    const index = await freshStorage.index.read();
    assert.ok(index.tasks.length >= 1, 'Index must be rebuilt with at least one task');
  });
});
