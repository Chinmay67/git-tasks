# git-tasks — Technical Design Document

**Version:** 1.0  
**Status:** Draft  
**Platform:** VS Code Extension  
**Runtime:** Node.js / TypeScript  
**Scope:** V1 (local, no cloud, no collaboration)

---

## Table of Contents

1. Architecture Overview  
2. Domain Model  
3. Data Persistence Strategy  
4. Git Integration Design  
5. Task Lifecycle  
6. VS Code Integration Design  
7. Repository Detection Strategy  
8. Conflict Handling  
9. Metadata Management  
10. Search Design  
11. Performance Requirements  
12. Failure Recovery  
13. Future Architecture  
14. Recommended Project Structure  
15. Technical Risks  
16. MVP Scope Review  

---

## 1. Architecture Overview

### 1.1 Design Philosophy

git-tasks must be trusted implicitly by developers. It touches uncommitted code — the most vulnerable layer of a developer's work. One failed restore, one corrupted diff, one lost file can destroy trust permanently. Every architectural decision must be evaluated first against reliability, then against simplicity, and finally against features.

The extension is deliberately thin. It does not invent a new version control system. It wraps Git using proven primitives and adds a task-oriented mental model on top. The underlying Git repository remains the single source of truth for code. git-tasks manages only supplementary metadata and snapshot files.

### 1.2 Major Components

**Extension Host Process** (all code runs here, in VS Code's Node.js process):

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code UI Layer                         │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │  Task Tree   │  │  Command Palette│  │  Webview (Details)  │ │
│  │  (Sidebar)   │  │  Quick Pick    │  │  (Task Details)     │ │
│  └──────┬───────┘  └───────┬────────┘  └──────────┬──────────┘ │
└─────────┼───────────────────┼───────────────────────┼──────────-┘
          │                   │                       │
          ▼                   ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Extension Core                             │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │  TaskManager │  │  CommandRouter │  │  UIStateManager     │ │
│  │  (Orchestrate│  │  (Binds VS Code│  │  (TreeView, Events) │ │
│  │   all ops)   │  │   commands)    │  │                     │ │
│  └──────┬───────┘  └────────────────┘  └──────────┬──────────┘ │
└─────────┼────────────────────────────────────────────┼──────────┘
          │                                            │
          ▼                                            ▼
┌──────────────────────┐              ┌────────────────────────────┐
│   Domain Services    │              │  Repository Context         │
│  ┌────────────────┐  │              │  ┌────────────────────────┐ │
│  │  PauseService  │  │              │  │  RepositoryResolver    │ │
│  │  ResumeService │  │              │  │  (Detects repos,       │ │
│  │  ArchiveService│  │              │  │   active repo, roots)  │ │
│  │  SearchService │  │              │  └────────────────────────┘ │
│  └────────┬───────┘  │              └────────────────────────────┘
└───────────┼──────────┘
            │
     ┌──────┴──────────────┐
     │                     │
     ▼                     ▼
┌──────────────┐    ┌────────────────────────────────────────────┐
│  GitAdapter  │    │  StorageAdapter                            │
│  (Wraps all  │    │  ┌─────────────────────────────────────┐  │
│   Git ops)   │    │  │  TaskStore (.git/git-tasks/)        │  │
│              │    │  │  MetadataStore (index.json)         │  │
│  Uses:       │    │  │  SnapshotStore (tasks/<id>/)        │  │
│  child_proc  │    │  └─────────────────────────────────────┘  │
│  or git ext  │    └────────────────────────────────────────────┘
└──────────────┘
```

### 1.3 Component Responsibilities

**TaskManager** is the single orchestration layer. All user-initiated operations flow through it. It coordinates GitAdapter and StorageAdapter in the correct sequence, handles rollback on failure, and emits events consumed by UIStateManager.

**GitAdapter** abstracts all Git operations. No other component touches Git directly. It exposes a typed async API: `captureDiff()`, `captureUntracked()`, `applyDiff()`, `restoreUntracked()`, `getStatus()`. Internally, it shells out to the Git CLI via `child_process.spawn`. It does not interpret business logic.

**StorageAdapter** abstracts all file I/O. It manages the `.git/git-tasks/` directory, the index, and per-task snapshot directories. It exposes a typed async API and handles atomic writes via temp-file-then-rename.

**RepositoryResolver** detects the active Git repository relative to the currently focused file or workspace. It handles single-repo, monorepo, and multi-root workspace scenarios. It is consulted at the start of every operation.

**UIStateManager** holds no business logic. It subscribes to events from TaskManager and updates VS Code's UI primitives (TreeView, status bar item, notifications).

### 1.4 Boundary Rules

- UI layer never calls GitAdapter or StorageAdapter directly.
- GitAdapter never calls StorageAdapter.
- StorageAdapter never calls GitAdapter.
- TaskManager is the only layer that calls both.
- Domain services receive fully resolved inputs. They do not resolve repository paths.

---

## 2. Domain Model

### 2.1 Task

**Purpose:** The core abstraction. Represents a named, recoverable snapshot of uncommitted work.

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUIDv4) | Globally unique, immutable after creation |
| `name` | `string` | User-provided, mutable |
| `description` | `string \| null` | Optional notes, mutable |
| `status` | `TaskStatus` | `active \| paused \| archived` |
| `repositoryRoot` | `string` | Absolute path to the repo root at creation time |
| `branchName` | `string` | Branch name at creation time |
| `baseCommitHash` | `string` | Full SHA of HEAD at creation time |
| `createdAt` | `ISO8601 string` | Immutable |
| `updatedAt` | `ISO8601 string` | Updated on every mutation |
| `lastOpenedAt` | `ISO8601 string \| null` | Updated on resume |
| `changedFileCount` | `number` | Snapshot file count, updated on pause |
| `snapshotRef` | `string \| null` | Pointer to snapshot directory name (`id`) |

**Lifecycle:** Created on pause → mutated on rename/edit → promoted to active on resume → promoted to archived on archive → deleted on delete.

**Ownership:** Owned by the repository. Stored within `.git/git-tasks/`.

---

### 2.2 TaskSnapshot

**Purpose:** The actual file change data for a task. Separated from metadata intentionally — metadata is cheap to read/index; snapshots are potentially large and accessed only on resume.

| Field | Type | Description |
|---|---|---|
| `taskId` | `string` | Foreign key to Task |
| `trackedDiff` | File path | `changes.diff` — output of `git diff HEAD` at pause time |
| `stagedDiff` | File path | `staged.diff` — output of `git diff --cached` at pause time |
| `untrackedManifest` | File path | `untracked.json` — list of untracked file paths and their base64-encoded contents |
| `capturedAt` | `ISO8601 string` | When the snapshot was taken |
| `gitVersion` | `string` | Git version used to capture; used to detect compatibility issues on restore |

**Location on disk:**
```
.git/git-tasks/tasks/<task-id>/
  meta.json            ← Task fields above
  changes.diff         ← git diff HEAD output
  staged.diff          ← git diff --cached output
  untracked.json       ← {path, content (base64), mode} per file
```

**Lifecycle:** Created atomically when task is paused. Immutable after creation (current V1 design does not support updating snapshots). Deleted when task is deleted.

---

### 2.3 TaskIndex

**Purpose:** The registry of all tasks for a repository. Allows fast enumeration without reading individual task directories.

| Field | Type | Description |
|---|---|---|
| `version` | `number` | Schema version (starts at 1) |
| `activeTaskId` | `string \| null` | At most one task may be active |
| `tasks` | `TaskIndexEntry[]` | Light summary of every task |

**TaskIndexEntry:**

| Field | Type |
|---|---|
| `id` | `string` |
| `name` | `string` |
| `status` | `TaskStatus` |
| `changedFileCount` | `number` |
| `createdAt` | `string` |
| `updatedAt` | `string` |

The index is a denormalized read-cache. The authoritative data always lives in `tasks/<id>/meta.json`. On corruption, the index can be rebuilt by scanning task directories.

---

### 2.4 RepositoryContext

**Purpose:** Runtime-resolved context provided to every operation. Never persisted.

| Field | Type | Description |
|---|---|---|
| `repositoryRoot` | `string` | Absolute path resolved by RepositoryResolver |
| `activeBranch` | `string` | Current branch name |
| `headCommitHash` | `string` | Current HEAD SHA |
| `isClean` | `boolean` | Whether working tree has any changes |
| `gitTasksDir` | `string` | `<repositoryRoot>/.git/git-tasks/` |

---

### 2.5 TaskStatus Enumeration

```
active     → The task whose snapshot was last restored. Working tree reflects this task.
paused     → Snapshot captured. Working tree was cleaned after pause.
archived   → Completed. Snapshot retained. Not shown in main list by default.
```

Only one task per repository may have status `active` at any time. This invariant is enforced by TaskManager, not by the file system.

---

## 3. Data Persistence Strategy

### 3.1 Where to Store Data

**Decision: Store task data inside `.git/git-tasks/`.**

The candidates are:

| Location | Pros | Cons |
|---|---|---|
| `vscode.ExtensionContext.workspaceState` | Simple API, managed by VS Code | Not portable across workspaces; lost if VS Code resets; not accessible to recovery tools; opaque |
| `vscode.ExtensionContext.globalState` | Survives workspace changes | Global to all repos — requires disambiguation; harder to reason about; risks cross-repo contamination |
| `.git/git-tasks/` (chosen) | Repo-local; survives VS Code reinstall; survives extension uninstall then reinstall; inspectable by developer; survives workspace reconfiguration; co-located with the code it references |  `git` directory manipulation requires care; must not interfere with Git internals |
| Workspace `.vscode/git-tasks/` | Easy to access, visible in file tree | Accidentally committed; clutters project; leaks private task names to version control |
| `$HOME/.config/git-tasks/` | Truly global | Cross-machine complexity; not repo-local; hard to correlate task to repo on rename |

**Rationale for `.git/git-tasks/`:**

Git explicitly reserves the `.git/` directory for tools. The `info/`, `hooks/`, and `refs/` subdirectories are precedent for tooling storing supplementary data here. Nothing in `.git/git-tasks/` will be committed (it is inside `.git/`, which is never tracked). The data survives a VS Code reinstall. A developer can inspect, back up, or manually recover tasks using standard file tools.

The one risk is if a developer deletes their `.git/` directory. This is equivalent to wiping the entire repository history and is an accepted, extreme edge case.

### 3.2 Directory Layout

```
<repo-root>/
└── .git/
    └── git-tasks/
        ├── index.json           ← TaskIndex (registry + active task pointer)
        └── tasks/
            ├── <task-id-1>/
            │   ├── meta.json
            │   ├── changes.diff
            │   ├── staged.diff
            │   └── untracked.json
            └── <task-id-2>/
                ├── meta.json
                ├── changes.diff
                ├── staged.diff
                └── untracked.json
```

### 3.3 Atomic Writes

All writes to `index.json` and `meta.json` must be atomic. The pattern is:

1. Write new content to `<target>.tmp`
2. `fs.rename(<target>.tmp, <target>)` — atomic on POSIX systems (Linux, macOS)
3. On Windows, `rename` over an existing file requires an unlink first; use a safe wrapper

Never write directly to `index.json`. A partial write during a crash would corrupt the index permanently.

### 3.4 Schema Versioning and Migration

`index.json` carries a top-level `version` field (integer). Each `meta.json` carries its own `version` field.

On extension activation, the StorageAdapter reads the index version. If it is below the current schema version:
1. Back up `index.json` to `index.json.v<n>.bak`
2. Run the migration function for each version increment
3. Write the new `index.json` atomically
4. Log migration in VS Code's output channel

For V1, version is `1`. No migration logic is required initially. The migration framework is scaffolded but empty. This avoids future pain when V2 adds new fields.

### 3.5 VS Code Storage Usage

`vscode.ExtensionContext.workspaceState` is used for one narrow purpose only: storing the path of the last active repository root. This allows the UI to restore the correct task list on restart without re-running the full RepositoryResolver scan. It is a hint, not a source of truth.

`vscode.ExtensionContext.globalState` is not used in V1.

---

## 4. Git Integration Design

This section analyzes all viable approaches for capturing and restoring uncommitted work.

### 4.1 Approach A: Git Stash

**Mechanism:** `git stash push -u -m "git-tasks:<id>"` on pause. `git stash pop stash@{n}` on resume after finding the stash by message.

**Advantages:**
- Uses a well-understood, battle-tested Git primitive
- Git handles binary files, tracked files, and with `-u`, untracked files
- `git stash` is available in all Git versions >= 1.8

**Disadvantages:**
- Stash is a shared, mutable queue. Developer's own `git stash push` operations interleave with task stashes. A `git stash drop` by the developer deletes the task's data permanently.
- Stash references (`stash@{0}`, `stash@{1}`) shift on every push/pop. Finding a task stash requires scanning all stashes by message on every operation — O(n) in stash count.
- Stashes are lost if the developer runs `git stash clear`.
- No way to store staged changes separately from unstaged changes in a single stash entry.
- Stash is global to the repository, not branch-scoped. Tasks from Branch A and Branch B share the same stash list.
- The stash reflog can grow unboundedly if tasks are never deleted.

**Failure scenarios:**
- Developer runs `git stash drop stash@{0}` → task's snapshot is silently deleted
- Developer runs `git stash clear` → all tasks lose their snapshot
- Stash lookup fails if message format was manually edited

**Recovery options:** None reliable. If the stash entry is gone, the snapshot is gone.

**Verdict:** Rejected. The shared namespace makes this fundamentally unsafe. git-tasks cannot control what happens to the stash list.

---

### 4.2 Approach B: Patch File (Chosen for V1)

**Mechanism:** On pause, run `git diff HEAD` to capture unstaged changes, `git diff --cached` to capture staged changes, and enumerate untracked files to capture their full content. Store all of this as files within `.git/git-tasks/tasks/<id>/`. On resume, apply the diffs with `git apply` and restore untracked files by writing them to disk.

**Advantages:**
- Completely isolated from Git's stash, reflog, and object store. No interference with developer's own Git operations.
- The snapshot files are plain text (diff format) and JSON. They are inspectable, debuggable, and portable.
- Robust to any Git command the developer runs between pause and resume (stash push/pop, commit, reset, etc.).
- No entries in `git log`, `git stash list`, or any Git-visible surface.
- Staged/unstaged changes captured separately, so they can be restored to the same state.
- Deletion of snapshot requires explicit extension action (delete task). Not affected by `git stash clear` or `git reset`.
- Snapshot survives force-pushes, rebases, and any remote operation.
- Simple to implement: `git diff HEAD` and `git apply` are universally available.

**Disadvantages:**
- Must handle untracked files manually (Git diffs only track tracked files).
- Binary untracked files require base64 encoding in `untracked.json`.
- `git apply` can fail if the file has been modified at the lines the diff targets (patch conflict).
- Large files or large diffs create large snapshot files.
- Snapshot is a point-in-time diff against `HEAD`. If `HEAD` changes (new commit, rebase, amend) between pause and resume, `git apply` may fail or produce incorrect results.

**Failure scenarios:**
- `HEAD` moves between pause and resume → diff may not apply cleanly → report as conflict, ask user to resolve
- Binary file tracked by Git (e.g., image edited) → `git diff HEAD` handles binary patches; Git apply handles binary patches since Git 1.8 with `--binary`
- Untracked file exceeds memory during base64 encoding → stream-based encoding required for large files
- Snapshot file is partially written (extension crash mid-pause) → detected via checksum or by incomplete directory structure

**Recovery options:**
- Snapshot files on disk are always recoverable by manual inspection.
- Developer can manually run `git apply changes.diff` from the terminal.
- Untracked files can be manually restored from `untracked.json`.

**Verdict: Selected for V1.** Maximum isolation, maximum inspectability, no interference with developer workflow.

---

### 4.3 Approach C: Temporary Commit

**Mechanism:** `git add -A && git commit -m "git-tasks-wip:<id>"` on pause. `git reset HEAD~1` on resume to restore working tree to pre-commit state.

**Advantages:**
- Uses commits, which Git stores reliably
- Works perfectly across rebases if the WIP commit is at branch tip
- `git log` shows the WIP commit, which is actually informative

**Disadvantages:**
- Pollutes commit history. Even after reset, the commit is in reflog and potentially confusing.
- `git push` could accidentally push the WIP commit if developer runs it between pause and resume.
- `HEAD` moves on pause. Scripts, CI hooks, and Git hooks may react to the commit.
- Restoring requires `git reset HEAD~1` which is destructive if the assumption `HEAD~1` = our WIP commit is violated (e.g., developer made another commit between pause and resume).
- Staged/unstaged distinction is lost — everything is committed.
- Pre-commit hooks may reject the temporary commit (linting failures on WIP code).

**Failure scenarios:**
- Developer runs `git push` → WIP commit sent to remote
- Developer makes a commit between pause and resume → `git reset HEAD~1` resets the wrong commit

**Verdict:** Rejected. Too many failure modes involving unintended Git history exposure.

---

### 4.4 Approach D: Hidden Branch (refs/git-tasks/)

**Mechanism:** Create a branch in the `refs/git-tasks/` namespace with `git update-ref refs/git-tasks/<id> <WIP-commit>`. On resume, cherry-pick or reset to restore changes.

**Advantages:**
- Isolated from `git branch` output (not in `refs/heads/`)
- Refs survive GC (they are named, reachable objects)
- Can store multiple snapshots per task as a chain of refs

**Disadvantages:**
- Significantly more complex to implement and reason about
- `git fetch --all` does not fetch these refs by default, but custom refspecs could push them accidentally
- Requires same WIP-commit creation as Approach C, inheriting the hook problem
- Cherry-pick on resume requires conflict resolution, which is complex to surface in VS Code
- Harder to inspect manually than a diff file

**Verdict:** Rejected for V1. High complexity without a clear reliability win over Approach B.

---

### 4.5 Approach E: Git Worktree

**Mechanism:** `git worktree add .git/git-tasks/worktrees/<id> --detach` for each task.

**Advantages:**
- Complete working tree isolation
- Can have multiple tasks "active" simultaneously in different worktrees (future use)

**Disadvantages:**
- Explicitly excluded by the PRD
- High complexity: worktree directories are large (full repo copy), cleanup is complex, path resolution becomes significantly harder
- Worktrees have known edge cases with submodules, symlinks, and certain Git hooks

**Verdict:** Rejected per PRD scope.

---

### 4.6 Git Adapter Implementation Strategy (for Approach B)

The GitAdapter wraps `child_process.spawn` calls to the system Git binary. It does not use `simple-git` or `nodegit` to minimize dependencies and maximize stability.

**Pause sequence:**
1. Resolve `repositoryRoot`
2. Run `git diff HEAD` → capture stdout → write to `changes.diff`
3. Run `git diff --cached` → capture stdout → write to `staged.diff`
4. Run `git ls-files --others --exclude-standard` → get list of untracked files
5. For each untracked file: read content, base64-encode, add to `untracked.json`
6. Write snapshot atomically (all files written to `<id>.tmp/` then renamed to `<id>/`)
7. Run `git checkout -- .` to clean tracked changes
8. Run `git clean -fd` to remove untracked files
9. Update index.json: set task status to `paused`

**Resume sequence:**
1. Verify target task is `paused`
2. Verify current working tree is clean (fail fast if not)
3. Read `changes.diff`, `staged.diff`, `untracked.json`
4. Apply `staged.diff` with `git apply --cached`
5. Apply `changes.diff` with `git apply`
6. Restore untracked files by writing from `untracked.json` to disk
7. Update index.json: set task status to `active`, clear previous `activeTaskId`

**Why apply staged first:** `git apply --cached` applies to the index. `git apply` (without `--cached`) applies to the working tree against the index. Applying staged first ensures the working tree apply is made against the correct index baseline.

---

### 4.7 Edge Case: Large Binary Untracked Files

Untracked files can be arbitrarily large (assets, compiled artifacts, ignored files not in `.gitignore`). The base64 approach in `untracked.json` is acceptable for text files and small binaries, but streaming is required for large files.

V1 strategy: cap untracked file snapshot at **50 MB per file, 200 MB total per task**. If limits are exceeded, warn the user before pausing. Do not silently truncate. Allow the user to opt out of capturing untracked files over the limit.

---

## 5. Task Lifecycle

### 5.1 State Machine

```
              ┌─────────────────────────────┐
              │                             │
              │     [Working Tree Has       │
              │      Uncommitted Changes]   │
              │                             │
              ▼                             │
         ┌─────────┐                        │
         │ PAUSING │ ─── (captures diff, ───┘
         └────┬────┘       cleans tree)
              │
              ▼
         ┌────────┐      rename/edit
         │ PAUSED │ ◄────────────────── (self-loop: metadata edits)
         └────┬───┘
              │
     ┌────────┼──────────────┐
     │        │              │
  archive   resume         delete
     │        │              │
     ▼        ▼              ▼
┌──────────┐ ┌────────┐  ┌─────────┐
│ ARCHIVED │ │ ACTIVE │  │ DELETED │
└────┬─────┘ └───┬────┘  └─────────┘
     │           │
     │ restore   │ pause (re-pause)
     │           │
     └───────────┘
```

### 5.2 Transition Details

---

**Transition: WORKING TREE → PAUSED**

- Trigger: User invokes "Pause Current Task" command
- Preconditions: Git repository detected. Working tree has at least one change (tracked or untracked). No ongoing pause operation.
- Validation: Prompt user for task name (mandatory). Validate name is non-empty, ≤ 100 characters.
- Atomic steps:
  1. Generate task ID
  2. Create snapshot directory (`.tmp` suffix)
  3. Capture diffs and untracked files
  4. Write `meta.json` into `.tmp` directory
  5. Rename `.tmp` directory to final name (atomic on POSIX)
  6. Update index.json (atomic write)
  7. Clean working tree (`git checkout -- .` + `git clean -fd`)
- Rollback if steps 1–5 fail: delete `.tmp` directory. Working tree unchanged — no data loss.
- Rollback if step 7 fails: working tree was never touched. Delete snapshot. Re-raise error.
- Failure handling: If `git clean -fd` fails, report error and instruct user to clean manually. Snapshot is retained so data is not lost.
- Post-state: Task is `paused`. Working tree is clean.

---

**Transition: PAUSED → ACTIVE**

- Trigger: User selects "Resume" on a paused task
- Preconditions: Target task exists and is `paused`. Working tree is clean (no uncommitted changes).
- Validation: If working tree is not clean, surface the "Pause & Continue" prompt per PRD Feature 3 safety requirement.
- Atomic steps:
  1. Read snapshot from task directory
  2. Apply `staged.diff` (with `git apply --cached`)
  3. Apply `changes.diff` (with `git apply`)
  4. Write untracked files to disk
  5. Update `meta.json` (status → active, lastOpenedAt → now)
  6. Update `index.json` (activeTaskId → this task, previous active task's status → paused if any)
- Rollback on diff apply failure: `git checkout -- .` to undo partial apply. Report error to user with specific file conflicts.
- Post-state: Task is `active`. Working tree reflects the snapshot.

---

**Transition: PAUSED → ARCHIVED**

- Trigger: User selects "Archive Task" from context menu
- Preconditions: Task is `paused`.
- Steps:
  1. Update `meta.json` status → `archived`
  2. Update index.json entry status → `archived`
- No file system changes to the snapshot. Snapshot is retained.
- Post-state: Task is `archived`. Sidebar moves task to Archived section.

---

**Transition: PAUSED → DELETED**

- Trigger: User confirms delete dialog
- Preconditions: Task is `paused` or `archived`. Task is not active (active tasks cannot be deleted while they are the current working state).
- Steps:
  1. Remove entry from `index.json`
  2. `fs.rm(taskDir, { recursive: true })` to delete snapshot directory
- Both steps succeed or neither is committed. If `fs.rm` fails after index update, the task directory becomes orphaned (handled by recovery scan — see Section 12).
- Post-state: Task is gone. No recovery possible.

---

**Transition: ACTIVE → PAUSED (Re-pause)**

- Trigger: User pauses again after resuming, or pauses before resuming another task
- Preconditions: An active task exists. Working tree may or may not have new changes.
- Behavior: The existing snapshot for the active task is **replaced** with a new snapshot of the current working tree state. This is the only case where a snapshot is overwritten.
- Atomic steps:
  1. Capture new snapshot to `<id>.tmp/`
  2. Rename old snapshot directory to `<id>.bak/`
  3. Rename `.tmp` directory to `<id>/`
  4. Delete `<id>.bak/`
  5. Update `meta.json` and `index.json`
- Rollback: If step 3 fails, restore from `.bak`. No data loss.

---

**Transition: Metadata Edit (rename, edit description)**

- Trigger: User invokes rename or edit description commands
- Preconditions: Task exists in any non-deleted state.
- Steps: Update `meta.json`, update `index.json` entry. Atomic writes throughout.
- No snapshot changes.

---

## 6. VS Code Integration Design

### 6.1 Activity Bar and TreeView

**API:** `vscode.window.createTreeView()` with a custom `TreeDataProvider`.

The sidebar is registered as a View Container in `package.json` contributing `viewsContainers.activitybar`. The TreeView is populated by the TaskTreeProvider which implements `vscode.TreeDataProvider<TaskTreeItem>`.

The tree has three top-level static nodes (Current, Paused, Archived) each of which expands to show its tasks. This is a two-level tree. TaskTreeItems carry the full Task object.

`onDidChangeTreeData` is an `EventEmitter<void>` that fires whenever TaskManager emits a state change. The TreeView does not hold state — it re-queries the TaskManager on every refresh.

**Context values** on TreeItems control which context menu items appear. Define:
- `git-tasks.task.paused` — shows Resume, Archive, Rename, Edit Description, Delete, View Files
- `git-tasks.task.active` — shows Pause, Rename, Edit Description
- `git-tasks.task.archived` — shows Delete, Rename, View Files

### 6.2 Commands

All commands are registered in `package.json` under `contributes.commands`. All commands are also accessible from Command Palette. Commands that require a task context (like Resume) accept an optional `TaskTreeItem` argument; if absent, they launch a Quick Pick to select a task.

| Command ID | Label | Context |
|---|---|---|
| `git-tasks.pauseCurrentTask` | Pause Current Task | Always available |
| `git-tasks.resumeTask` | Resume Task | Palette + context menu |
| `git-tasks.deleteTask` | Delete Task | Context menu |
| `git-tasks.archiveTask` | Archive Task | Context menu |
| `git-tasks.renameTask` | Rename Task | Context menu |
| `git-tasks.editDescription` | Edit Description | Context menu |
| `git-tasks.viewFiles` | View Changed Files | Context menu |
| `git-tasks.openTaskDetails` | Open Task Details | Context menu |
| `git-tasks.searchTasks` | Search Tasks | Palette |

### 6.3 Quick Pick

Used for task selection when invoked from Command Palette without a TreeView selection. `vscode.window.showQuickPick()` with items constructed from the task index. Each QuickPickItem shows the task name, description, file count, and creation date as `detail`.

Also used for task name input on pause: `vscode.window.showInputBox()` with `validateInput` to enforce non-empty and length constraints.

### 6.4 Webview (Task Details Panel)

**API:** `vscode.window.createWebviewPanel()`.

Used to display the Task Details view (Feature 6) and Changed Files list (Feature 7). A Webview is preferred over a TreeView child for these because they are read-heavy, benefit from richer layout (tables, scrollable lists), and do not require interactivity beyond the "Resume" and "Archive" buttons already present as commands.

The Webview receives its data via `webview.postMessage()`. It does not call back into extension state directly — it sends commands via `window.addEventListener('message')` on the Webview side, which are caught by `webview.onDidReceiveMessage` on the extension side and routed to TaskManager.

A single Webview panel instance is reused (if already open, reveal it and refresh with new task data rather than creating a second panel).

### 6.5 Notifications

`vscode.window.showInformationMessage()` — task paused, task resumed, task archived.
`vscode.window.showWarningMessage()` — unsaved work prompt (with action buttons: "Pause & Continue", "Cancel").
`vscode.window.showErrorMessage()` — failed restore, conflict detected.

Keep notification messages short. The exact strings from the PRD are used verbatim as they were written specifically for clarity.

### 6.6 Status Bar Item

A persistent status bar item shows the active task name. When no task is active, it shows nothing (do not clutter the status bar with "No active task"). Clicking the status bar item opens the sidebar.

**API:** `vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)`.

### 6.7 Context Menus

Registered via `menus.view/item/context` in `package.json`. Conditions use the `viewItem` context value set on each TreeItem (see Section 6.1). This ensures only relevant actions appear per task status.

### 6.8 Output Channel

A named output channel (`git-tasks`) is created on activation for logging. All Git command invocations, their arguments (redacted if sensitive), exit codes, and durations are logged here. This is a critical debugging tool for diagnosing restore failures. Not shown to users by default but accessible via "Output" panel.

---

## 7. Repository Detection Strategy

### 7.1 Detection Method

On every operation, RepositoryResolver runs detection. Git detection uses two strategies in order:

**Strategy 1 (fast path):** Consume the VS Code Git Extension's `GitExtension` API. This extension is bundled with VS Code and exposes all open repositories via `git.getAPI(1).repositories`. Each repository object provides `rootUri` and `state`. This is the preferred path — it reuses VS Code's own Git scanning logic.

**Strategy 2 (fallback):** Walk up from the workspace folder root, running `git rev-parse --show-toplevel`. Used if the Git extension API is unavailable or returns no repositories.

### 7.2 Single Repository Workspace

One workspace folder, one `.git/` directory. Simple case. All operations use this repository. No disambiguation needed.

### 7.3 Multi-Root Workspace

VS Code allows multiple workspace folders. Each may have its own `.git/` directory. RepositoryResolver resolves the "active" repository as the one containing the currently focused file (from `vscode.window.activeTextEditor?.document.uri`). If no file is focused, fall back to the first workspace folder's repository.

A repository selector Quick Pick is shown when ambiguity cannot be resolved (e.g., Command Palette invocation with no active editor and multiple workspace repos).

### 7.4 Monorepo (Single Git Root with Multiple Package Folders)

A monorepo has one `.git/` at the root and multiple subdirectory packages. This resolves to a single repository context — the monorepo root. Tasks capture diffs for the entire repository root, not just a subdirectory.

This is correct behavior: a developer working on `packages/auth` also has changes relative to the monorepo root, and `git diff HEAD` from the root captures all of them.

### 7.5 Not a Git Repository

If no `.git/` directory is found and `git rev-parse` fails, RepositoryResolver returns `null`. All commands check for `null` context and surface the "TaskFlow only works inside Git repositories" error state. The sidebar shows the error empty state instead of the task list.

### 7.6 Repository Context Caching

The resolved RepositoryContext (root path, branch, HEAD hash) is cached for the duration of a single operation and invalidated on `vscode.workspace.onDidChangeWorkspaceFolders`. It is never cached across operations because branch and HEAD can change between operations.

---

## 8. Conflict Handling

### 8.1 Resume with Uncommitted Local Changes

This is the primary safety case from the PRD (Feature 3). Before any resume operation, `GitAdapter.getStatus()` is called. If changes exist:

Surface the warning dialog: "You have unsaved work. Pause current task before resuming another?" with [Pause & Continue] and [Cancel].

If [Pause & Continue] is selected, TaskManager performs a **compound operation:**
1. Pause the current work (prompts for task name for the new task)
2. Resume the selected task

Both operations are wrapped in a logical transaction. If step 2 fails, step 1 is not rolled back (the user explicitly named and saved their current work). The failure in step 2 is reported clearly.

### 8.2 Resume After Branch Change

The task stores `branchName` at creation time. On resume, the current branch is compared to the stored branch. If they differ:

Surface a warning: "This task was created on branch `<original>`. You are currently on `<current>`. The changes may not apply cleanly."

Give the user [Resume Anyway] and [Cancel]. Do not block silently — the developer may have intentionally switched branches. If they choose to resume anyway and `git apply` fails, proceed to Section 8.4.

### 8.3 Resume After HEAD Change (Commits Made Between Pause and Resume)

The task stores `baseCommitHash` at creation time. On resume, the current HEAD is compared. If different:

This is the highest-risk case. The diff was generated against the old HEAD. The new HEAD may have modified the same lines, making `git apply` fail.

Strategy:
1. Warn the user: "The repository has new commits since this task was paused. The task may not restore cleanly."
2. Attempt `git apply --check` (dry run) before actually applying
3. If dry run succeeds, proceed with apply
4. If dry run fails, report the specific files with conflicts. Do not partially apply. Present options: [View Conflict Files] [Cancel].
5. Leave the working tree unchanged on failure.

### 8.4 Apply Failure Mid-Resume

If `git apply` fails after partial application (some hunks applied, some failed):

1. Run `git checkout -- .` to revert partial application
2. Remove any partially written untracked files
3. Report error with the list of failing files
4. Offer to open the raw `changes.diff` in the editor for manual inspection

The task remains `paused` — its status is not changed to `active` unless all steps succeed.

### 8.5 File Deleted in Working Tree Before Resume

If a file in the snapshot no longer exists in the repository (was deleted by a subsequent commit):

`git apply` will attempt to create the file if the diff is `+++ b/file` (new file) or will fail if it is trying to modify a now-absent file. Handle per Section 8.4.

---

## 9. Metadata Management

### 9.1 Two-Layer Metadata

Metadata exists at two layers:

**Layer 1: index.json** — The registry. Read on every sidebar refresh. Must be fast. Contains only the TaskIndexEntry fields (id, name, status, file count, timestamps). Updated on every operation.

**Layer 2: meta.json per task** — Full task fields including branchName, baseCommitHash, description. Read only when opening task details or preparing for resume. Updated on every task mutation.

This separation means the sidebar can enumerate and display all tasks by reading only `index.json`. It never needs to open individual task directories for a list view.

### 9.2 Consistency Invariants

**Invariant 1:** At most one task has `status === 'active'` per repository. Enforced in TaskManager before every status change.

**Invariant 2:** `index.json#activeTaskId` points to a task whose `meta.json` also has `status === 'active'`. Checked on activation (see Recovery in Section 12).

**Invariant 3:** Every entry in `index.json#tasks` has a corresponding directory in `tasks/<id>/` with a readable `meta.json`. Checked lazily on detail view and eagerly on extension activation.

### 9.3 Metadata Update Protocol

All metadata updates follow this sequence:
1. Update `meta.json` (atomic write)
2. Update `index.json` (atomic write — read, mutate in memory, write via temp-rename)

`meta.json` is updated first because `index.json` is a derived cache. If the extension crashes between steps 1 and 2, the index is stale but `meta.json` is correct. Recovery can rebuild the index from `meta.json` files (see Section 12).

Never update `index.json` first.

### 9.4 changedFileCount Accuracy

`changedFileCount` is captured at pause time and stored in both `meta.json` and the index entry. It is **not updated** if the developer makes commits between pause and resume (since the task snapshot remains against the original HEAD). This is acceptable — it is displayed as "files changed at pause time," not "files different from current HEAD." The UI label should read "N files at pause" to avoid confusion.

---

## 10. Search Design

### 10.1 V1 Scope

Search in V1 is in-memory, substring-based. There is no index beyond what is already in `index.json`. This is sufficient for the expected scale: a developer will have at most tens of tasks, not thousands.

### 10.2 Search Implementation

On every search query:

1. Read the full TaskIndex from `index.json` (it is small — entries are ≤ 1 KB each)
2. For each task, check if `name` or description (from `meta.json`) contains the query (case-insensitive)
3. Description is read from `meta.json` only when a search query is active. This is acceptable because search is a user-initiated action (not a background operation).

SearchService caches `meta.json` descriptions in a `Map<string, string>` for the session to avoid repeated disk reads during interactive search.

### 10.3 Search UX

Search is surfaced as:
- A Quick Pick (`vscode.window.showQuickPick()`) with a `matchOnDescription: true` and `matchOnDetail: true` flag (VS Code's built-in fuzzy filtering will apply to the Quick Pick items)
- A filter input in the sidebar TreeView (via `vscode.window.createTreeView()` with `canSelectMany: false` — the filter box is native to VS Code's TreeView)

Both surfaces are acceptable for V1. The sidebar filter box is the lower-effort path.

### 10.4 Future Search Scalability

If task counts grow (e.g., V2 with team sharing or cloud sync importing thousands of tasks), a simple JSON search is inadequate. The architecture supports adding an in-process inverted index (e.g., FlexSearch or Fuse.js as a zero-native-dependency fuzzy search library) without API changes — only SearchService changes internally.

---

## 11. Performance Requirements

### 11.1 Pause Operation Target

Target: < 3 seconds for a repository with 500 changed files (excluding large binary untracked files).

The bottleneck is `git diff HEAD`, which scales with diff size. For typical web/backend codebases (thousands of source files, hundreds changed), `git diff HEAD` completes in under 1 second. No optimization needed for V1.

Show a progress notification for pauses that take more than 500 ms: "Saving task…"

### 11.2 Resume Operation Target

Target: < 3 seconds for a task with 500 changed files.

`git apply` is the bottleneck. Same analysis as above — acceptable for V1.

### 11.3 Sidebar Render Target

Target: < 100 ms to refresh the sidebar after any operation.

The sidebar reads only `index.json` for rendering. `index.json` is ≤ 50 KB for 500 tasks. Reading and parsing it is sub-millisecond. The TreeView refresh loop is bounded by the number of tasks (tree items created, not full meta read). This is fast by default.

### 11.4 Large Repository Considerations

For repositories with 100,000+ files:

- `git diff HEAD` is still fast (Git's diff engine is O(changed files), not O(total files))
- `git ls-files --others --exclude-standard` for untracked files may be slow if there are many untracked files in a non-.gitignore'd directory. V1 mitigation: cap untracked file enumeration at 1,000 files. Warn user if limit is hit.

### 11.5 Snapshot File Size

Monitored at pause time. Thresholds:

| Size | Action |
|---|---|
| < 10 MB | Proceed silently |
| 10–50 MB | Log to output channel |
| > 50 MB | Warn user, offer to exclude untracked binary files |
| > 200 MB | Hard block; require user to exclude large files |

---

## 12. Failure Recovery

### 12.1 Corrupted index.json

Detected at extension activation by attempting `JSON.parse()`.

Recovery:
1. Rename `index.json` to `index.json.corrupt.<timestamp>`
2. Scan `tasks/*/meta.json` to rebuild the index
3. If `meta.json` is readable, add the task back to the index
4. If multiple tasks claim `status: active`, set all to `paused` (safer than incorrectly marking one active)
5. Write rebuilt `index.json`
6. Notify user: "Task index was rebuilt from task files."

### 12.2 Corrupted meta.json

Detected when TaskManager tries to read a specific task's details.

Recovery:
1. Mark the task as having a `corrupted` flag in the index entry (a new field introduced for this)
2. Display the task in the sidebar with a warning icon
3. Still allow the user to view the raw snapshot files via the output channel
4. Allow deletion of the corrupted task

The snapshot diff files are unaffected — a corrupted `meta.json` does not destroy the code changes.

### 12.3 Missing Snapshot Directory

If `index.json` lists a task but `tasks/<id>/` does not exist:

1. Mark the task as `orphaned` in the index
2. Display with a warning icon
3. Offer to remove the orphaned entry from the index (cleanup only, no restore possible)

### 12.4 Extension Crash During Pause

Mid-pause crash scenario: crash occurs after snapshot directory is created but before `git checkout -- .`. 

Result: A `.tmp` snapshot directory may exist, and the working tree is still dirty.

Recovery on next activation:
1. Scan for `*.tmp` directories in `tasks/`
2. If found, check whether a corresponding complete snapshot exists
3. If no complete snapshot: the developer's working tree is still dirty (unchanged). Delete the `.tmp` directory. Nothing lost.
4. If a complete snapshot exists and the working tree is also dirty: the pause partially succeeded. Present the user with: "A task snapshot was found but the working tree was not cleaned. What would you like to do? [Complete the pause] [Discard the snapshot]"

### 12.5 Extension Crash During Resume

Mid-resume crash: crash occurs after `git apply` partially ran.

Result: Working tree may be in a partial state.

On next activation, detect via stored `resumeInProgress` flag in `workspaceState` (written before resume starts, cleared on success):

1. Detect the flag
2. Check working tree status
3. If changes detected and `resumeInProgress` is set: warn the user "A resume operation may have been interrupted. The working tree may be in a partial state. Would you like to [Reset working tree to clean state] [Leave as is]?"
4. Clear the flag

### 12.6 VS Code Restart

On activation, TaskManager:
1. Reads `index.json`
2. Runs consistency checks (invariants from Section 9.2)
3. Verifies `activeTaskId` task's `meta.json` matches
4. Updates status bar with active task name
5. Refreshes the sidebar

No state is lost on VS Code restart because all state lives on disk in `.git/git-tasks/`.

---

## 13. Future Architecture

### 13.1 V1 → V2 Extension Points

The following V2 features are explicitly accommodated in V1's architecture:

**Task Comparison:** The snapshot architecture stores `changes.diff` files. Task comparison (V2) would diff two `changes.diff` files. This requires no schema change — just a new DiffComparisonService that reads two snapshots.

**Task Notes / Timeline:** `meta.json` has an `updatedAt` field. A `notes` array field can be added to `meta.json` in a V2 schema migration (schema version 2). The migration framework is already present.

**AI Summaries:** The PRD explicitly excludes AI for V1. V2 could pass `changes.diff` content to a language model API. The diff files are already plain text and structured — no architectural change needed to consume them with AI.

**Team Sharing / Export:** A TaskExportService would serialize a task directory (meta + diffs + untracked) into a single archive (`.gittask` bundle format). Import reverses this. This requires no change to the internal storage format.

**Cloud Sync:** An account/sync layer would push `meta.json` and snapshot files to a remote store. The local-first architecture means cloud sync is purely additive — a sync provider implements a `SyncAdapter` interface and the local store remains the source of truth.

**Cross-Branch Tasks:** V1 warns on branch mismatch. V2 could support rebasing the stored diff against the current HEAD using `git apply --3way`, which resolves trivial conflicts automatically. This is a `GitAdapter` change only.

### 13.2 Internal API Stability Requirements

To enable the above without rewrites:

- TaskManager's method signatures must remain stable. Services consume TaskManager, not lower layers.
- The `Task` entity's `id`, `createdAt`, and `baseCommitHash` fields must be immutable.
- `index.json` schema versions must always be forward-migratable.
- GitAdapter must remain the single point of contact with Git. No other layer may shell out to Git.

---

## 14. Recommended Project Structure

```
git-tasks/
├── src/
│   ├── extension.ts                  ← Activation entry point. Wires all components. Minimal logic.
│   │
│   ├── domain/                       ← Pure types and enumerations. No I/O. No dependencies.
│   │   ├── Task.ts                   ← Task, TaskStatus, TaskIndexEntry types
│   │   ├── TaskSnapshot.ts           ← TaskSnapshot type
│   │   ├── TaskIndex.ts              ← TaskIndex type
│   │   └── RepositoryContext.ts      ← RepositoryContext type
│   │
│   ├── core/                         ← Orchestration layer. Business logic. No VS Code UI deps.
│   │   ├── TaskManager.ts            ← Central coordinator. Exposes all operations.
│   │   ├── PauseService.ts           ← Pause operation logic
│   │   ├── ResumeService.ts          ← Resume operation logic (includes conflict checks)
│   │   ├── ArchiveService.ts         ← Archive and delete operations
│   │   ├── MetadataService.ts        ← Rename, edit description, read details
│   │   └── SearchService.ts          ← In-memory search across index + descriptions
│   │
│   ├── git/                          ← All Git I/O. Depends on child_process only.
│   │   ├── GitAdapter.ts             ← Public API: captureDiff, applyDiff, getStatus, etc.
│   │   ├── GitRunner.ts              ← Wraps child_process.spawn for Git CLI calls
│   │   └── DiffParser.ts             ← Parses git status output into structured types
│   │
│   ├── storage/                      ← All file system I/O. Depends on fs only.
│   │   ├── StorageAdapter.ts         ← Public API: readIndex, writeIndex, readTask, writeTask, etc.
│   │   ├── IndexStore.ts             ← Read/write index.json with atomic writes
│   │   ├── TaskStore.ts              ← Read/write per-task directories and files
│   │   ├── SnapshotStore.ts          ← Read/write diff files and untracked.json
│   │   └── Migration.ts              ← Schema version checks and migration logic
│   │
│   ├── repository/                   ← Repository detection and context resolution
│   │   ├── RepositoryResolver.ts     ← Resolves active repo root for current workspace
│   │   └── GitExtensionAdapter.ts    ← Wraps VS Code's built-in Git extension API
│   │
│   ├── ui/                           ← All VS Code UI. Depends on vscode API.
│   │   ├── TaskTreeProvider.ts       ← TreeDataProvider implementation
│   │   ├── TaskTreeItem.ts           ← TreeItem subclass with context values
│   │   ├── TaskDetailsPanel.ts       ← Webview panel for task details + changed files
│   │   ├── StatusBarItem.ts          ← Active task status bar item
│   │   └── webview/
│   │       └── taskDetails.html      ← Webview HTML template
│   │
│   ├── commands/                     ← VS Code command handlers. Thin. Delegate to TaskManager.
│   │   ├── pauseCommand.ts
│   │   ├── resumeCommand.ts
│   │   ├── deleteCommand.ts
│   │   ├── archiveCommand.ts
│   │   ├── renameCommand.ts
│   │   ├── editDescriptionCommand.ts
│   │   ├── viewFilesCommand.ts
│   │   └── searchCommand.ts
│   │
│   ├── state/                        ← In-memory extension state. Updated by TaskManager. Consumed by UI.
│   │   ├── ExtensionState.ts         ← Singleton state object: active task, loaded tasks list
│   │   └── EventBus.ts               ← Simple typed EventEmitter for state-change notifications
│   │
│   └── utils/
│       ├── AtomicWriter.ts           ← temp-file-then-rename write helper
│       ├── FileUtils.ts              ← fs/promises wrappers
│       ├── Logger.ts                 ← Output channel wrapper
│       └── IdGenerator.ts            ← UUIDv4 generator (crypto.randomUUID or uuid package)
│
├── test/
│   ├── unit/
│   │   ├── domain/
│   │   ├── core/
│   │   ├── git/
│   │   └── storage/
│   └── integration/
│       └── TaskManager.test.ts       ← End-to-end tests against a real temp git repo
│
├── package.json                      ← Extension manifest: commands, views, menus, activation
├── tsconfig.json
├── .eslintrc.json
└── CHANGELOG.md
```

**Directory responsibility summary:**

`domain/` — Zero-dependency types. Anything importing from `domain/` can do so freely without creating circular dependencies.

`core/` — Business logic. May import from `domain/`, `git/`, `storage/`. Must not import from `ui/` or `commands/`. May import from `state/` (to emit events).

`git/` — Git I/O only. No domain logic. No VS Code API. Testable without VS Code.

`storage/` — File system I/O only. No domain logic. No VS Code API. Testable without VS Code.

`repository/` — Repository detection. May use VS Code API (`vscode.workspace`, Git extension). Does not perform I/O into `.git/git-tasks/`.

`ui/` — All VS Code UI components. May import from `domain/`, `state/`. Must not call `core/` directly — dispatches commands instead, or reads from `state/`.

`commands/` — One file per command. Thin wrappers that parse VS Code arguments and delegate to `core/TaskManager`. Registered in `extension.ts`.

`state/` — The in-memory read model. TaskManager writes it. UI reads it. Eliminates the need for UI to call I/O operations for rendering.

---

## 15. Technical Risks

### 15.1 Risk Register

---

**RISK-01: git apply Failure on Resume**  
Severity: **High**  
Probability: Medium (common in active codebases)

Description: The stored diff does not apply cleanly because HEAD has moved (new commits, rebases, amends) since the task was paused. This is the most likely user-facing failure.

Impact: User cannot restore their work automatically. High frustration. Trust damage.

Mitigation:
- Always run `git apply --check` before real apply
- Report specific conflicting files, not a generic error
- Preserve the raw diff file so the user can apply manually in terminal
- Offer the `--3way` apply option (which uses a three-way merge and leaves conflict markers) as an advanced recovery option

---

**RISK-02: Data Loss During Pause (Crash Between Diff Capture and git clean)**  
Severity: **High**  
Probability: Low

Description: Extension or VS Code crashes after snapshot files are written but before `git checkout -- .` cleans the working tree. State is inconsistent.

Impact: Partial snapshot + dirty working tree. Confusing state.

Mitigation:
- Detect via `.tmp` directory presence on activation
- Working tree is not cleaned until snapshot is fully committed to disk
- Fail-safe: if snapshot write fails, working tree is never touched

---

**RISK-03: Developer Manually Deletes .git/git-tasks/**  
Severity: **High**  
Probability: Low

Description: A developer runs `rm -rf .git/git-tasks/` or nukes the `.git/` directory. All task snapshots are permanently lost.

Impact: All tasks lost. No recovery.

Mitigation:
- Document clearly that task data lives in `.git/git-tasks/`
- V2 could offer an optional export/backup to workspace folder
- Extension detects missing directory on activation and reinitializes cleanly (no crash)

---

**RISK-04: Windows Atomic Rename Behavior**  
Severity: **Medium**  
Probability: Medium on Windows

Description: `fs.rename()` on Windows cannot atomically rename over an existing file without first unlinking it. A crash between unlink and rename corrupts the target file.

Impact: Corrupted `index.json` or `meta.json`.

Mitigation:
- Use a Windows-specific write path: write to `.new`, delete `.old` (rename existing to `.old`), rename `.new` to target, delete `.old`
- Recovery mechanism (Section 12.1) handles corruption regardless of cause

---

**RISK-05: Git Binary Availability**  
Severity: **Medium**  
Probability: Low

Description: Git is not installed, or its location is not in `PATH`, or the Git version is too old to support required flags.

Impact: All operations fail.

Mitigation:
- Use VS Code's Git extension to resolve Git binary path (it performs its own discovery)
- Minimum Git version: 2.0 (released 2014). Check on activation and surface clear error if below minimum.
- Fail with a specific, actionable error: "git-tasks requires Git 2.0 or later. Detected version: X.Y."

---

**RISK-06: Very Large Untracked Files**  
Severity: **Medium**  
Probability: Medium (common in frontend repos with `node_modules` not in .gitignore)

Description: Untracked file enumeration via `git ls-files --others --exclude-standard` returns thousands of files or very large files.

Impact: Pause hangs or produces a multi-gigabyte snapshot.

Mitigation:
- Hard cap at 1,000 untracked files per task
- Hard cap at 200 MB total untracked size
- Warn user and offer to proceed without untracked file capture

---

**RISK-07: index.json Simultaneous Write from Two VS Code Windows**  
Severity: **Medium**  
Probability: Low

Description: Two VS Code windows open the same repository and both trigger operations simultaneously, causing a write race on `index.json`.

Impact: One write clobbers the other. Task state is inconsistent.

Mitigation:
- V1 does not implement file locking (acceptable given the low probability and single-user scope)
- V2 mitigation: write a `.lock` file using exclusive open (`O_EXCL`) before modifying `index.json`, release after commit

---

**RISK-08: Extension Activation Overhead**  
Severity: **Low**  
Probability: Low

Description: On activation, the index and recovery checks add startup time to VS Code.

Impact: Slightly slower VS Code startup.

Mitigation:
- Use `onStartupFinished` activation event (not `*`). This defers activation until VS Code is fully loaded.
- Index read is a single synchronous file parse — negligible latency.

---

## 16. MVP Scope Review

### 16.1 What Must Stay in V1

All 10 features listed in the PRD belong in V1. They form a minimal but complete workflow loop. Removing any one of them creates a gap:

- Without Pause: the product doesn't exist
- Without Resume: the product doesn't exist
- Without Delete/Archive: the sidebar fills with dead tasks quickly
- Without View Changed Files: developers cannot identify what a task contains before resuming
- Without Search: sidebar becomes unusable at > 20 tasks

### 16.2 What Should Move to V2

The following features were in-scope for V1 but have implementation shortcuts that reduce their fidelity and should be fully addressed in V2:

**Full conflict-resolution UI:** V1 surfaces conflict file names and directs the developer to the terminal. V2 should surface an inline three-way merge via VS Code's built-in diff editor.

**Snapshot updates:** V1 re-captures the entire snapshot on every re-pause. V2 could store delta snapshots (what changed since the last pause) for efficiency and history.

**Task notes (timestamped):** Currently `description` is a single freeform text field. V2 should support appended notes with timestamps (a task journal).

### 16.3 Hidden Complexity

The following areas carry more complexity than the PRD suggests:

**Staged vs. unstaged distinction:** The PRD never mentions it. But developers use `git add -p` and partial staging routinely. A restore that collapses staged and unstaged into one working tree diff is a subtle loss of context. The design above captures them separately. This is non-trivial to implement and test correctly.

**Re-pause of an active task:** The PRD's lifecycle implies pause creates a new task every time, but what happens when a developer resumes a task, makes changes, and pauses again? V1 must handle snapshot replacement cleanly or the behavior is confusing.

**Multiple repo windows:** A single developer may have two VS Code windows open to the same monorepo. Task state is shared on disk but VS Code state is per-window. Sidebar refresh must be triggered across instances. V1 accepts this limitation — sidebar may be stale in the second window. V2 can use filesystem watchers on `index.json` to drive cross-window refresh.

**`.gitignore` at time of restore vs. now:** Untracked files were untracked because they were ignored at pause time. If `.gitignore` changes between pause and resume, files that were untracked may now be tracked — restoring them as untracked files would then create unexpected behavior. V1 mitigation: restore untracked files to disk and let Git sort out their status. Log a warning.

### 16.4 Acceptable V1 Shortcuts

The following implementation shortcuts are acceptable for V1 given the reliability-first principle:

- No file locking on `index.json` (single user, single window is the expected case)
- No streaming of large diff files (buffer in memory; enforced size caps mitigate risk)
- Sidebar search uses VS Code's native Quick Pick fuzzy filter rather than a custom in-sidebar search input (acceptable UX for V1 task counts)
- Webview for task details uses simple static HTML rather than a React component (simpler to maintain, faster to load)
- No progress reporting for sub-500ms operations (only show progress notification above the threshold)

### 16.5 The Non-Negotiable Quality Bar

Every release of git-tasks must satisfy these properties before shipping:

1. A pause followed immediately by a resume must restore the working tree to byte-for-byte identical state.
2. A failed resume must never modify the working tree.
3. A failed pause must never modify the working tree.
4. Deleting a task must never affect the working tree.

These four invariants are the definition of "the extension is trustworthy." They must be enforced by automated integration tests run against a real Git repository in the CI pipeline, not just by unit tests.

---

*End of git-tasks Technical Design Document v1.0*
