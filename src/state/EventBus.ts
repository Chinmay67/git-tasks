import type { Task } from '../domain/Task';

export type EventType =
  | 'tasks-changed'
  | 'active-task-changed'
  | 'task-paused'
  | 'task-resumed'
  | 'task-archived'
  | 'task-deleted'
  | 'task-renamed';

type Listener<T> = (payload: T) => void;

class TypedEventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch {
        // Swallow listener errors to avoid cascade failures
      }
    }
  }
}

export type GitTasksEvents = {
  'tasks-changed': void;
  'active-task-changed': Task | null;
  'task-paused': Task;
  'task-resumed': Task;
  'task-archived': Task;
  'task-deleted': string; // taskId
  'task-renamed': Task;
};

export const eventBus = new TypedEventEmitter<GitTasksEvents>();
