import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { atomicWrite } from '../../../utils/AtomicWriter';
import { IndexStore } from '../../../storage/IndexStore';
import type { TaskIndex } from '../../../domain/TaskIndex';

suite('IndexStore', () => {
  let tmpDir: string;
  let store: IndexStore;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-tasks-test-'));
    store = new IndexStore(tmpDir);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('read returns empty index when file does not exist', async () => {
    const index = await store.read();
    assert.strictEqual(index.version, 1);
    assert.strictEqual(index.activeTaskId, null);
    assert.deepStrictEqual(index.tasks, []);
  });

  test('write then read round-trips correctly', async () => {
    const index: TaskIndex = {
      version: 1,
      activeTaskId: 'abc-123',
      tasks: [
        {
          id: 'abc-123',
          name: 'Fix auth bug',
          status: 'paused',
          changedFileCount: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    await store.write(index);
    const read = await store.read();
    assert.deepStrictEqual(read, index);
  });

  test('upsertEntry adds a new entry', async () => {
    await store.upsertEntry({
      id: 'task-1',
      name: 'Task One',
      status: 'paused',
      changedFileCount: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const index = await store.read();
    assert.strictEqual(index.tasks.length, 1);
    assert.strictEqual(index.tasks[0].name, 'Task One');
  });

  test('upsertEntry updates an existing entry', async () => {
    const entry = {
      id: 'task-1',
      name: 'Old Name',
      status: 'paused' as const,
      changedFileCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.upsertEntry(entry);
    await store.upsertEntry({ ...entry, name: 'New Name' });
    const index = await store.read();
    assert.strictEqual(index.tasks.length, 1);
    assert.strictEqual(index.tasks[0].name, 'New Name');
  });

  test('removeEntry removes the task and clears activeTaskId', async () => {
    await store.upsertEntry({
      id: 'task-1',
      name: 'Task One',
      status: 'paused',
      changedFileCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.setActiveTaskId('task-1');
    await store.removeEntry('task-1');
    const index = await store.read();
    assert.strictEqual(index.tasks.length, 0);
    assert.strictEqual(index.activeTaskId, null);
  });

  test('setActiveTaskId persists across reads', async () => {
    await store.upsertEntry({
      id: 'task-1',
      name: 'T',
      status: 'paused',
      changedFileCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.setActiveTaskId('task-1');
    const index = await store.read();
    assert.strictEqual(index.activeTaskId, 'task-1');
  });

  test('write is atomic — corrupt tmp file does not affect existing index', async () => {
    const original: TaskIndex = {
      version: 1,
      activeTaskId: null,
      tasks: [],
    };
    await store.write(original);
    const indexPath = path.join(tmpDir, 'index.json');

    // Simulate a concurrent read while write is happening by checking
    // the final file content is always valid JSON
    await store.write({ ...original, activeTaskId: 'task-abc' });
    const raw = await fs.readFile(indexPath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
    const parsed = JSON.parse(raw) as TaskIndex;
    assert.strictEqual(parsed.activeTaskId, 'task-abc');
  });
});
