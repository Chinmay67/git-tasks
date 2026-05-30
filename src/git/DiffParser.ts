export interface WorkingTreeStatus {
  isClean: boolean;
  trackedChangedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
}
