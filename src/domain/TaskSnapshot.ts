export interface TaskSnapshot {
  taskId: string;
  capturedAt: string;
  gitVersion: string;
}

export interface UntrackedFileEntry {
  path: string;
  content: string; // base64-encoded
  mode: string;    // e.g. '100644'
}
