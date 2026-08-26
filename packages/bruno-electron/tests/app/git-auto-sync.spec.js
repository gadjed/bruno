const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

jest.mock('../../src/app/collection-watcher', () => ({
  getAllWatcherPaths: jest.fn(() => [])
}));

jest.mock('../../src/store/preferences', () => ({
  getPreferences: jest.fn(() => ({ gitAutoSync: { enabled: true } }))
}));

const collectionWatcher = require('../../src/app/collection-watcher');
const {
  refreshBranchInfo,
  checkoutOpenRepoBranch
} = require('../../src/app/git-auto-sync');

const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

const currentBranch = (cwd) => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

const initGitRepo = (extraBranches = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-git-branch-'));
  try {
    git(dir, ['init', '-b', 'main']);
  } catch {
    git(dir, ['init']);
    git(dir, ['checkout', '-b', 'main']);
  }
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'main\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);

  extraBranches.forEach((branch) => {
    git(dir, ['checkout', '-b', branch]);
    fs.writeFileSync(path.join(dir, 'README.md'), `${branch}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', `on ${branch}`]);
    git(dir, ['checkout', 'main']);
  });

  return dir;
};

const removeDir = (dir) => {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
};

describe('git-auto-sync branch switching', () => {
  const createdDirs = [];

  afterEach(() => {
    collectionWatcher.getAllWatcherPaths.mockReturnValue([]);
    while (createdDirs.length) {
      removeDir(createdDirs.pop());
    }
  });

  test('lists local branches and the current branch for an open git root', async () => {
    const repo = initGitRepo(['feature']);
    createdDirs.push(repo);
    collectionWatcher.getAllWatcherPaths.mockReturnValue([repo]);

    const status = await refreshBranchInfo();

    expect(status.currentBranch).toBe('main');
    expect(status.mixed).toBe(false);
    expect(status.branches).toEqual(['feature', 'main']);
  });

  test('checkouts the requested branch and updates currentBranch', async () => {
    const repo = initGitRepo(['feature']);
    createdDirs.push(repo);
    collectionWatcher.getAllWatcherPaths.mockReturnValue([repo]);

    const status = await checkoutOpenRepoBranch('feature');

    expect(currentBranch(repo)).toBe('feature');
    expect(status.currentBranch).toBe('feature');
    expect(status.state).toBe('success');
    expect(status.message).toMatch(/Switched to feature/);
  });

  test('rejects an empty branch name', async () => {
    const repo = initGitRepo();
    createdDirs.push(repo);
    collectionWatcher.getAllWatcherPaths.mockReturnValue([repo]);

    await expect(checkoutOpenRepoBranch('   ')).rejects.toThrow('Branch name is required');
  });

  test('rejects checkout when no git-backed collections are open', async () => {
    collectionWatcher.getAllWatcherPaths.mockReturnValue([]);

    await expect(checkoutOpenRepoBranch('main')).rejects.toThrow('No git-backed collections open');
  });

  test('reports mixed when open repos are on different branches', async () => {
    const repoA = initGitRepo(['feature']);
    const repoB = initGitRepo(['feature']);
    createdDirs.push(repoA, repoB);
    git(repoB, ['checkout', 'feature']);
    collectionWatcher.getAllWatcherPaths.mockReturnValue([repoA, repoB]);

    const status = await refreshBranchInfo();

    expect(status.mixed).toBe(true);
    expect(status.currentBranch).toBeNull();
    expect(status.branches).toEqual(['feature', 'main']);
  });
});
