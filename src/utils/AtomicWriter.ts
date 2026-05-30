import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Atomically writes content to targetPath using a temp-file-then-rename strategy.
 * On POSIX, rename over an existing file is atomic.
 * On Windows, we unlink then rename.
 */
export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const tmpPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmpPath, content, 'utf8');
  try {
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    // On Windows, rename over existing file requires an unlink first
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      await fs.unlink(targetPath);
      await fs.rename(tmpPath, targetPath);
    } else {
      // Clean up tmp file if rename failed for other reason
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }
}

/**
 * Atomically renames a directory by renaming .tmp -> final, keeping .bak as rollback.
 */
export async function atomicRenameDir(
  tmpDir: string,
  finalDir: string,
  bakDir: string
): Promise<void> {
  // Step 1: rename existing final -> bak
  await fs.rename(finalDir, bakDir);
  // Step 2: rename tmp -> final
  try {
    await fs.rename(tmpDir, finalDir);
  } catch (err) {
    // Rollback: restore bak -> final
    await fs.rename(bakDir, finalDir).catch(() => undefined);
    throw err;
  }
  // Step 3: delete bak
  await fs.rm(bakDir, { recursive: true, force: true });
}

export const IS_WINDOWS = os.platform() === 'win32';
