export interface RepositoryContext {
  repositoryRoot: string;
  activeBranch: string;
  headCommitHash: string;
  isClean: boolean;
  gitTasksDir: string;
}
