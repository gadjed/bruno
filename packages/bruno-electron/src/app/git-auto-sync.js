const path = require('path');
const {
  getCollectionGitRootPath,
  getSimpleGitInstanceForPath,
  stageChanges,
  commitChanges,
  fetchChanges,
  getCurrentGitBranch
} = require('../utils/git');
const collectionWatcher = require('./collection-watcher');
const { getPreferences } = require('../store/preferences');

const DEFAULT_COMMIT_DEBOUNCE_MS = 5000;
const DEFAULT_PULL_INTERVAL_MS = 30 * 60 * 1000;
const UNCOMMITTED_REFRESH_DEBOUNCE_MS = 1500;
/** Sentinel queued when a structural change (rename/move/delete) touches the tree. */
const STAGE_ALL_SENTINEL = '__bruno_stage_all__';

/** @type {Electron.BrowserWindow | null} */
let mainWindow = null;
/** @type {NodeJS.Timeout | null} */
let pullIntervalId = null;
/** @type {NodeJS.Timeout | null} */
let uncommittedRefreshTimer = null;
/** @type {Map<string, { files: Set<string>, timer: NodeJS.Timeout | null, running: boolean }>} */
const queues = new Map();

let status = {
  state: 'idle', // idle | checking | syncing | success | error
  message: '',
  lastCheckedAt: null,
  lastSyncedAt: null,
  uncommittedCount: 0
};

const isEnabled = () => {
  const prefs = getPreferences();
  return prefs?.gitAutoSync?.enabled !== false;
};

const getCommitDebounceMs = () => {
  const prefs = getPreferences();
  const value = Number(prefs?.gitAutoSync?.commitDebounceMs);
  return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_COMMIT_DEBOUNCE_MS;
};

const getPullIntervalMs = () => {
  const prefs = getPreferences();
  const value = Number(prefs?.gitAutoSync?.pullIntervalMs);
  return Number.isFinite(value) && value >= 60 * 1000 ? value : DEFAULT_PULL_INTERVAL_MS;
};

const emitStatus = (partial = {}) => {
  status = {
    ...status,
    ...partial
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main:git-auto-sync-status', status);
  }
  return status;
};

const getStatus = () => ({ ...status });

const getQueue = (gitRootPath) => {
  if (!queues.has(gitRootPath)) {
    queues.set(gitRootPath, { files: new Set(), timer: null, running: false });
  }
  return queues.get(gitRootPath);
};

const resolveRemoteAndBranch = async (gitRootPath) => {
  const git = getSimpleGitInstanceForPath(gitRootPath);
  const remotes = await git.getRemotes(true);
  if (!remotes?.length) {
    return null;
  }
  const remote = remotes.find((r) => r.name === 'origin')?.name || remotes[0].name;
  const branch = await getCurrentGitBranch(gitRootPath);
  if (!branch) {
    return null;
  }
  return { remote, branch };
};

const countUncommittedFiles = (repoStatus) => {
  if (!repoStatus) {
    return 0;
  }
  if (Array.isArray(repoStatus.files)) {
    return repoStatus.files.length;
  }
  // Fallback for unexpected status shapes
  const created = repoStatus.created?.length || 0;
  const deleted = repoStatus.deleted?.length || 0;
  const modified = repoStatus.modified?.length || 0;
  const renamed = repoStatus.renamed?.length || 0;
  const notAdded = repoStatus.not_added?.length || 0;
  const conflicted = repoStatus.conflicted?.length || 0;
  return created + deleted + modified + renamed + notAdded + conflicted;
};

const refreshUncommittedCount = async () => {
  if (!isEnabled()) {
    return emitStatus({ uncommittedCount: 0 });
  }

  const roots = getOpenGitRoots();
  if (!roots.length) {
    return emitStatus({ uncommittedCount: 0 });
  }

  let total = 0;
  for (const gitRoot of roots) {
    try {
      const git = getSimpleGitInstanceForPath(gitRoot);
      const repoStatus = await git.status();
      total += countUncommittedFiles(repoStatus);
    } catch (err) {
      console.warn('[git-auto-sync] failed to read uncommitted status for', gitRoot, err?.message || err);
    }
  }

  return emitStatus({ uncommittedCount: total });
};

const scheduleUncommittedRefresh = () => {
  if (uncommittedRefreshTimer) {
    clearTimeout(uncommittedRefreshTimer);
  }
  uncommittedRefreshTimer = setTimeout(() => {
    uncommittedRefreshTimer = null;
    refreshUncommittedCount().catch((err) => {
      console.warn('[git-auto-sync] uncommitted refresh failed:', err?.message || err);
    });
  }, UNCOMMITTED_REFRESH_DEBOUNCE_MS);
};

const buildCommitMessage = (files) => {
  const realFiles = files.filter((filePath) => filePath !== STAGE_ALL_SENTINEL);
  if (!realFiles.length) {
    return 'bruno: auto-save collection structure';
  }
  const relativeHint = realFiles
    .slice(0, 3)
    .map((filePath) => path.basename(filePath))
    .join(', ');
  const more = realFiles.length > 3 ? ` (+${realFiles.length - 3})` : '';
  return `bruno: auto-save ${relativeHint}${more}`;
};

/**
 * Last-write-wins sync:
 * 1) stage + commit local saves
 * 2) pull remote (prefer ours on conflict)
 * 3) force-push so the latest saver wins
 */
const syncLastWriteWins = async (gitRootPath, files) => {
  const git = getSimpleGitInstanceForPath(gitRootPath);
  const remoteInfo = await resolveRemoteAndBranch(gitRootPath);
  if (!remoteInfo) {
    return { skipped: true, reason: 'No git remote configured' };
  }
  const { remote, branch } = remoteInfo;

  const stageAll = files.includes(STAGE_ALL_SENTINEL);
  const filesToStage = files.filter((filePath) => filePath !== STAGE_ALL_SENTINEL);

  if (stageAll) {
    // Structural edits (rename/move/delete) show up as deletes + untracked paths.
    // `git add -A` stages the full working tree so renames aren't left behind.
    await git.add(['-A']);
  } else if (filesToStage.length) {
    await stageChanges(gitRootPath, filesToStage);
  }

  const statusAfterAdd = await git.status();
  const hasStaged = (statusAfterAdd.staged || []).length > 0
    || (statusAfterAdd.files || []).some((f) => f.index && f.index !== ' ' && f.index !== '?');

  if (hasStaged || filesToStage.length || stageAll) {
    try {
      // Re-stage in case a status race dropped entries
      if (stageAll) {
        await git.add(['-A']);
      } else if (filesToStage.length) {
        await stageChanges(gitRootPath, filesToStage);
      }
      await commitChanges(
        gitRootPath,
        buildCommitMessage(filesToStage.length || stageAll ? files : ['collection'])
      );
    } catch (err) {
      // simple-git throws when there is nothing to commit after race
      if (!/nothing to commit/i.test(err?.message || '')) {
        throw err;
      }
    }
  }

  // Pull first (with ours) so remote history is merged, then force-push local truth
  await fetchChanges(gitRootPath, remote);
  try {
    await git.pull(remote, branch, ['--no-rebase', '-X', 'ours']);
  } catch (pullError) {
    // Conflict or non-ff after remote force-push: keep local tree and continue to force-push
    try {
      await git.raw(['merge', '--abort']);
    } catch (_) {
      // ignore if no merge in progress
    }
    try {
      const conflictStatus = await git.status();
      const conflicted = conflictStatus.conflicted || [];
      if (conflicted.length) {
        // --ours = current branch (our just-committed local save)
        await git.checkout(['--ours', ...conflicted]);
        await git.add(conflicted);
        await commitChanges(gitRootPath, 'bruno: resolve conflicts (last-write-wins)');
      }
    } catch (resolveError) {
      console.warn('[git-auto-sync] conflict resolve fallback:', resolveError?.message || resolveError);
      // Still attempt force-push of current HEAD
    }
    if (!/CONFLICT|conflict|diverged|Need to specify|Not possible|Cannot|rejected/i.test(pullError?.message || '')) {
      console.warn('[git-auto-sync] pull warning:', pullError?.message || pullError);
    }
  }

  await git.push(['--force', remote, branch]);
  return { skipped: false, remote, branch };
};

/**
 * Background / manual update: take remote when working tree is clean.
 * If local has uncommitted changes, only fetch and report.
 */
const pullUpdatesForRoot = async (gitRootPath) => {
  const git = getSimpleGitInstanceForPath(gitRootPath);
  const remoteInfo = await resolveRemoteAndBranch(gitRootPath);
  if (!remoteInfo) {
    return { updated: false, skipped: true, reason: 'No git remote configured' };
  }
  const { remote, branch } = remoteInfo;

  await fetchChanges(gitRootPath, remote);
  const repoStatus = await git.status();

  if (!repoStatus.isClean()) {
    return {
      updated: false,
      skipped: true,
      dirty: true,
      reason: 'Local uncommitted changes present — skipped overwrite'
    };
  }

  try {
    await git.pull(remote, branch, ['--ff-only']);
    return { updated: true, method: 'ff-only', remote, branch };
  } catch (_) {
    // Remote was likely force-pushed (LWW). Working tree is clean → hard reset.
    await git.reset(['--hard', `${remote}/${branch}`]);
    return { updated: true, method: 'hard-reset', remote, branch };
  }
};

const getOpenGitRoots = () => {
  const watcherPaths = collectionWatcher.getAllWatcherPaths();
  const roots = new Set();
  for (const watchPath of watcherPaths) {
    try {
      const gitRoot = getCollectionGitRootPath(watchPath);
      if (gitRoot) {
        roots.add(path.normalize(gitRoot));
      }
    } catch (err) {
      console.warn('[git-auto-sync] failed to resolve git root for', watchPath, err?.message);
    }
  }
  return [...roots];
};

const enqueueSync = (gitRootPath, pathnameOrSentinel) => {
  const normalizedRoot = path.normalize(gitRootPath);
  const queue = getQueue(normalizedRoot);
  queue.files.add(pathnameOrSentinel);
  if (queue.timer) {
    clearTimeout(queue.timer);
  }
  queue.timer = setTimeout(() => flushQueue(normalizedRoot), getCommitDebounceMs());
};

const flushQueue = async (gitRootPath) => {
  const queue = getQueue(gitRootPath);
  if (queue.running) {
    // Re-schedule after current run finishes
    if (!queue.timer) {
      queue.timer = setTimeout(() => flushQueue(gitRootPath), getCommitDebounceMs());
    }
    return;
  }

  const files = [...queue.files];
  queue.files.clear();
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  if (!isEnabled()) {
    return;
  }

  queue.running = true;
  emitStatus({
    state: 'syncing',
    message: `Syncing ${path.basename(gitRootPath)}…`
  });

  try {
    const result = await syncLastWriteWins(gitRootPath, files);
    if (result.skipped) {
      emitStatus({
        state: 'idle',
        message: result.reason || 'Skipped sync',
        lastSyncedAt: Date.now()
      });
    } else {
      emitStatus({
        state: 'success',
        message: `Pushed to ${result.remote}/${result.branch}`,
        lastSyncedAt: Date.now()
      });
    }
  } catch (err) {
    console.error('[git-auto-sync] sync failed:', err);
    emitStatus({
      state: 'error',
      message: err?.message || 'Git sync failed'
    });
  } finally {
    queue.running = false;
    scheduleUncommittedRefresh();
    if (queue.files.size > 0) {
      queue.timer = setTimeout(() => flushQueue(gitRootPath), getCommitDebounceMs());
    }
  }
};

/**
 * Called after a successful filesystem write of a collection file.
 */
const notifyFileSaved = (pathname) => {
  if (!pathname || !isEnabled()) {
    return;
  }

  try {
    const gitRoot = getCollectionGitRootPath(pathname);
    if (!gitRoot) {
      return;
    }

    enqueueSync(gitRoot, pathname);
    scheduleUncommittedRefresh();
  } catch (err) {
    console.warn('[git-auto-sync] notifyFileSaved failed:', err?.message || err);
  }
};

/**
 * Called after structural tree changes (create/rename/move/delete folder or item)
 * where the change is not a simple single-file write — git needs `add -A`.
 */
const notifyStructureChanged = (pathname) => {
  if (!pathname || !isEnabled()) {
    return;
  }

  try {
    const gitRoot = getCollectionGitRootPath(pathname);
    if (!gitRoot) {
      return;
    }

    enqueueSync(gitRoot, STAGE_ALL_SENTINEL);
    scheduleUncommittedRefresh();
  } catch (err) {
    console.warn('[git-auto-sync] notifyStructureChanged failed:', err?.message || err);
  }
};

const checkAndPullAll = async ({ reason = 'manual' } = {}) => {
  if (!isEnabled()) {
    return emitStatus({
      state: 'idle',
      message: 'Git auto-sync is disabled',
      lastCheckedAt: Date.now(),
      uncommittedCount: 0
    });
  }

  const roots = getOpenGitRoots();
  if (!roots.length) {
    return emitStatus({
      state: 'idle',
      message: 'No git-backed collections open',
      lastCheckedAt: Date.now(),
      uncommittedCount: 0
    });
  }

  emitStatus({
    state: 'checking',
    message: reason === 'startup'
      ? 'Checking remote updates…'
      : 'Checking for updates…',
    lastCheckedAt: Date.now()
  });

  const results = [];
  for (const gitRoot of roots) {
    const queue = getQueue(gitRoot);
    if (queue.running || queue.files.size > 0) {
      results.push({ gitRoot, skipped: true, reason: 'Save sync in progress' });
      continue;
    }
    try {
      const result = await pullUpdatesForRoot(gitRoot);
      results.push({ gitRoot, ...result });
    } catch (err) {
      console.error('[git-auto-sync] pull failed for', gitRoot, err);
      results.push({ gitRoot, updated: false, error: err?.message || String(err) });
    }
  }

  const updatedCount = results.filter((r) => r.updated).length;
  const errorCount = results.filter((r) => r.error).length;
  const dirtyCount = results.filter((r) => r.dirty).length;

  let message = 'Already up to date';
  let state = 'success';
  if (errorCount) {
    state = 'error';
    message = `Update check failed for ${errorCount} repo(s)`;
  } else if (updatedCount) {
    message = `Updated ${updatedCount} repo(s) from remote`;
  } else if (dirtyCount) {
    message = 'Remote checked — local edits kept';
  }

  await refreshUncommittedCount();

  return emitStatus({
    state,
    message,
    lastCheckedAt: Date.now(),
    lastSyncedAt: updatedCount ? Date.now() : status.lastSyncedAt
  });
};

/**
 * Manual push: commit any remaining local changes with last-write-wins, then force-push.
 */
const pushAllChanges = async () => {
  if (!isEnabled()) {
    return emitStatus({
      state: 'idle',
      message: 'Git auto-sync is disabled',
      lastCheckedAt: Date.now()
    });
  }

  const roots = getOpenGitRoots();
  if (!roots.length) {
    return emitStatus({
      state: 'idle',
      message: 'No git-backed collections open',
      lastCheckedAt: Date.now(),
      uncommittedCount: 0
    });
  }

  emitStatus({
    state: 'syncing',
    message: 'Pushing local changes…',
    lastCheckedAt: Date.now()
  });

  const results = [];
  for (const gitRoot of roots) {
    const queue = getQueue(gitRoot);
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    // Fold any pending file saves into this push so we don't race the debounce flush
    const pending = [...queue.files];
    queue.files.clear();
    const files = pending.length ? pending : [STAGE_ALL_SENTINEL];
    if (!pending.includes(STAGE_ALL_SENTINEL) && pending.length) {
      // Also pick up structural leftovers (renames/deletes) not in the file queue
      files.push(STAGE_ALL_SENTINEL);
    }

    queue.running = true;
    try {
      const result = await syncLastWriteWins(gitRoot, files);
      results.push({ gitRoot, ...result });
    } catch (err) {
      console.error('[git-auto-sync] push failed for', gitRoot, err);
      results.push({ gitRoot, skipped: false, error: err?.message || String(err) });
    } finally {
      queue.running = false;
    }
  }

  const pushedCount = results.filter((r) => !r.skipped && !r.error).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const errorCount = results.filter((r) => r.error).length;

  let message = 'Nothing to push';
  let state = 'success';
  if (errorCount) {
    state = 'error';
    message = `Push failed for ${errorCount} repo(s)`;
  } else if (pushedCount) {
    message = `Pushed ${pushedCount} repo(s)`;
  } else if (skippedCount) {
    message = results.find((r) => r.reason)?.reason || 'Skipped push';
  }

  await refreshUncommittedCount();

  return emitStatus({
    state,
    message,
    lastCheckedAt: Date.now(),
    lastSyncedAt: pushedCount ? Date.now() : status.lastSyncedAt
  });
};

const startBackgroundPull = () => {
  stopBackgroundPull();
  const intervalMs = getPullIntervalMs();
  pullIntervalId = setInterval(() => {
    checkAndPullAll({ reason: 'interval' }).catch((err) => {
      console.error('[git-auto-sync] interval pull failed:', err);
    });
  }, intervalMs);
};

const stopBackgroundPull = () => {
  if (pullIntervalId) {
    clearInterval(pullIntervalId);
    pullIntervalId = null;
  }
};

const initGitAutoSync = (win) => {
  mainWindow = win;
  startBackgroundPull();

  // Initial pull shortly after app is ready / collections begin opening
  setTimeout(() => {
    checkAndPullAll({ reason: 'startup' }).catch((err) => {
      console.error('[git-auto-sync] startup pull failed:', err);
    });
  }, 4000);

  // Refresh the uncommitted badge once watchers have had time to register
  setTimeout(() => {
    refreshUncommittedCount().catch((err) => {
      console.warn('[git-auto-sync] startup uncommitted refresh failed:', err?.message || err);
    });
  }, 6000);
};

module.exports = {
  initGitAutoSync,
  notifyFileSaved,
  notifyStructureChanged,
  checkAndPullAll,
  pushAllChanges,
  refreshUncommittedCount,
  getStatus,
  startBackgroundPull,
  stopBackgroundPull
};
