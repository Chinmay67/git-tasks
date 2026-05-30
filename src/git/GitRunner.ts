import { spawn } from 'child_process';
import { log, logError } from '../utils/Logger';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawns a git command in the given cwd and returns stdout/stderr/exitCode.
 * Rejects only on spawn errors (e.g., git not found), not on non-zero exit codes.
 */
export async function runGit(
  args: string[],
  cwd: string,
  stdin?: string
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn('git', args, { cwd, env: process.env });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.on('error', (err) => {
      logError(`git ${args[0]} spawn error`, err);
      reject(err);
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const duration = Date.now() - start;
      log(`git ${args.join(' ')} → exit ${exitCode} (${duration}ms)`);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

/**
 * Returns the installed git version string, e.g. "2.44.0".
 */
export async function getGitVersion(cwd: string): Promise<string> {
  const result = await runGit(['--version'], cwd);
  // "git version 2.44.0"
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : 'unknown';
}
