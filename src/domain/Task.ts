export type TaskStatus = 'active' | 'paused' | 'archived';

export interface Task {
  id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  repositoryRoot: string;
  branchName: string;
  baseCommitHash: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  changedFileCount: number;
  snapshotRef: string | null;
}

export interface TaskIndexEntry {
  id: string;
  name: string;
  status: TaskStatus;
  changedFileCount: number;
  createdAt: string;
  updatedAt: string;
}
