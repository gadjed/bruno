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

/** @type {Electron.BrowserWindow | null} */
let mainWindow = null;
/** @type {NodeJS.Timeout | null} */
let pullIntervalId = null;
/** @type {Map<string, { files: Set<string>, timer: NodeJS.Timeout | null, running: boolean }>} */
const queues = new Map();

let status = {
  state: 'idle', // idle | checking | syncing | success | error
  message: '',
  lastCheckedAt: null,
  lastSyncedAt: null
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

const buildCommitMessage = (files) => {
  const relativeHint = files
    .slice(0, 3)
    .map((filePath) => path.basename(filePath))
    .join(', ');
  const more = files.length > 3 ? ` (+${files.length - 3})` : '';
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

  const filesToStage = files.length ? files : [];

  if (filesToStage.length) {
    await stageChanges(gitRootPath, filesToStage);
  }

  const statusAfterAdd = await git.status();
  const hasStaged = (statusAfterAdd.staged || []).length > 0
    || (statusAfterAdd.files || []).some((f) => f.index && f.index !== ' ' && f.index !== '?');

  if (hasStaged || filesToStage.length) {
    try {
      // Re-stage queued files in case status race dropped them
      if (filesToStage.length) {
        await stageChanges(gitRootPath, filesToStage);
      }
      await commitChanges(gitRootPath, buildCommitMessage(filesToStage.length ? filesToStage : ['collection']));
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

    const queue = getQueue(path.normalize(gitRoot));
    queue.files.add(pathname);
    if (queue.timer) {
      clearTimeout(queue.timer);
    }
    queue.timer = setTimeout(() => flushQueue(path.normalize(gitRoot)), getCommitDebounceMs());
  } catch (err) {
    console.warn('[git-auto-sync] notifyFileSaved failed:', err?.message || err);
  }
};

const checkAndPullAll = async ({ reason = 'manual' } = {}) => {
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
      lastCheckedAt: Date.now()
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

  return emitStatus({
    state,
    message,
    lastCheckedAt: Date.now(),
    lastSyncedAt: updatedCount ? Date.now() : status.lastSyncedAt
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
};

module.exports = {
  initGitAutoSync,
  notifyFileSaved,
  checkAndPullAll,
  getStatus,
  startBackgroundPull,
  stopBackgroundPull
};
