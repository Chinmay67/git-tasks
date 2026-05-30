import type { TaskIndexEntry } from './Task';

export interface TaskIndex {
  version: number;
  activeTaskId: string | null;
  tasks: TaskIndexEntry[];
}
