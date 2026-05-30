import * as assert from 'assert';
import { eventBus } from '../../state/EventBus';
import type { Task } from '../../domain/Task';

const makeTask = (): Task => ({
  id: 'task-1',
  name: 'Test',
  description: null,
  status: 'paused',
  repositoryRoot: '/repo',
  branchName: 'main',
  baseCommitHash: 'abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  changedFileCount: 1,
  snapshotRef: 'task-1',
});

suite('EventBus', () => {
  test('listener fires with correct payload', (done) => {
    const task = makeTask();
    const unsub = eventBus.on('task-paused', (received: Task) => {
      unsub();
      assert.deepStrictEqual(received, task);
      done();
    });
    eventBus.emit('task-paused', task);
  });

  test('unsubscribed listener does not fire', () => {
    let callCount = 0;
    const unsub = eventBus.on('tasks-changed', () => { callCount++; });
    eventBus.emit('tasks-changed', undefined);
    unsub();
    eventBus.emit('tasks-changed', undefined);
    assert.strictEqual(callCount, 1);
  });

  test('multiple listeners for same event all fire', () => {
    const results: number[] = [];
    const u1 = eventBus.on('task-deleted', () => results.push(1));
    const u2 = eventBus.on('task-deleted', () => results.push(2));
    eventBus.emit('task-deleted', 'some-id');
    u1(); u2();
    assert.deepStrictEqual(results.sort(), [1, 2]);
  });

  test('listener error does not prevent other listeners from firing', () => {
    let secondFired = false;
    const u1 = eventBus.on('tasks-changed', () => { throw new Error('intentional'); });
    const u2 = eventBus.on('tasks-changed', () => { secondFired = true; });
    assert.doesNotThrow(() => eventBus.emit('tasks-changed', undefined));
    u1(); u2();
    assert.strictEqual(secondFired, true);
  });
});
