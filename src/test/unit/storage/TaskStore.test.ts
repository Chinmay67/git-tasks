import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TaskStore } from '../../../storage/TaskStore';
import type { Task } from '../../../domain/Task';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-123',
  name: 'Test Task',
  description: null,
  status: 'paused',
  repositoryRoot: '/repo',
  branchName: 'main',
  baseCommitHash: 'abc123def456',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  changedFileCount: 5,
  snapshotRef: 'task-123',
  ...overrides,
});

suite('TaskStore', () => {
  let tmpDir: string;
  let store: TaskStore;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-tasks-taskstore-'));
    store = new TaskStore(tmpDir);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('writeMeta then readMeta round-trips', async () => {
    const task = makeTask();
    await store.writeMeta(task);
    const read = await store.readMeta(task.id);
    assert.deepStrictEqual(read, task);
  });

  test('taskDirExists returns false before write', async () => {
    const exists = await store.taskDirExists('nonexistent');
    assert.strictEqual(exists, false);
  });

  test('taskDirExists returns true after write', async () => {
    const task = makeTask();
    await store.writeMeta(task);
    const exists = await store.taskDirExists(task.id);
    assert.strictEqual(exists, true);
  });

  test('deleteTaskDir removes the directory', async () => {
    const task = makeTask();
    await store.writeMeta(task);
    await store.deleteTaskDir(task.id);
    const exists = await store.taskDirExists(task.id);
    assert.strictEqual(exists, false);
  });

  test('scanAllMeta returns all written tasks', async () => {
    const t1 = makeTask({ id: 'task-1', name: 'Task 1' });
    const t2 = makeTask({ id: 'task-2', name: 'Task 2' });
    await store.writeMeta(t1);
    await store.writeMeta(t2);
    const results = await store.scanAllMeta();
    const names = results.map(t => t.name).sort();
    assert.deepStrictEqual(names, ['Task 1', 'Task 2']);
  });

  test('scanAllMeta skips .tmp directories', async () => {
    const task = makeTask();
    await store.writeMeta(task);
    // Create a .tmp directory that would be left by a crash
    const tmpTaskDir = path.join(tmpDir, `${task.id}.tmp`);
    await fs.mkdir(tmpTaskDir, { recursive: true });
    await fs.writeFile(path.join(tmpTaskDir, 'meta.json'), JSON.stringify(task));

    const results = await store.scanAllMeta();
    assert.strictEqual(results.length, 1);
  });

  test('findStaleTemporaryDirs finds .tmp directories', async () => {
    const tmpTaskDir = path.join(tmpDir, 'some-id.tmp');
    await fs.mkdir(tmpTaskDir);
    const stale = await store.findStaleTemporaryDirs();
    assert.strictEqual(stale.length, 1);
    assert.ok(stale[0].endsWith('.tmp'));
  });

  test('readMeta throws for nonexistent task', async () => {
    await assert.rejects(() => store.readMeta('does-not-exist'));
  });
});
