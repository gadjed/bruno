import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { test, expect, closeElectronApp } from '../../../playwright';
import {
  createCollection,
  waitForReadyPage,
  buildStatusBarLocators,
  switchGitBranchFromStatusBar
} from '../../utils/page';

const initUserDataPath = path.join(__dirname, 'init-user-data');

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

const currentBranch = (cwd: string): string =>
  git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

const initGitRepoWithBranches = (dir: string, extraBranches: string[]): void => {
  try {
    git(dir, ['init', '-b', 'main']);
  } catch {
    git(dir, ['init']);
    git(dir, ['checkout', '-b', 'main']);
  }
  git(dir, ['config', 'user.email', 'bruno-e2e@example.com']);
  git(dir, ['config', 'user.name', 'Bruno E2E']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'main\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);

  for (const branch of extraBranches) {
    git(dir, ['checkout', '-b', branch]);
    fs.writeFileSync(path.join(dir, 'README.md'), `${branch}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', `on ${branch}`]);
    git(dir, ['checkout', 'main']);
  }
};

test.describe('Status bar git branch switcher', () => {
  test('is hidden when the open collection is not in a git repository', async ({ page, createTmpDir }) => {
    const collectionDir = await createTmpDir('no-git-coll');
    const statusBar = buildStatusBarLocators(page);

    await test.step('Create a collection outside any git repo', async () => {
      await createCollection(page, 'NoGitColl', collectionDir);
    });

    await test.step('Branch switcher stays hidden', async () => {
      // Watcher registration refreshes branch info on a 250ms debounce.
      await page.waitForTimeout(750);
      await expect(statusBar.branchSwitcher()).toHaveCount(0);
    });
  });

  test('shows the current branch and switches to another local branch', async ({ launchElectronApp, createTmpDir }) => {
    const repoDir = await createTmpDir('git-branch-switch');
    initGitRepoWithBranches(repoDir, ['feature']);

    const app = await launchElectronApp({ initUserDataPath });
    const page = await waitForReadyPage(app);
    const statusBar = buildStatusBarLocators(page);

    await test.step('Create a collection inside the git repo', async () => {
      await createCollection(page, 'GitColl', repoDir);
    });

    await test.step('Status bar shows the current branch', async () => {
      await expect(statusBar.branchSwitcher()).toBeVisible({ timeout: 10000 });
      await expect(statusBar.branchName()).toHaveText('main');
    });

    await test.step('Switch to the feature branch', async () => {
      await switchGitBranchFromStatusBar(page, 'feature');
      await expect(statusBar.branchName()).toHaveText('feature', { timeout: 10000 });
      await expect(page.getByText(/Switched to feature/)).toBeVisible({ timeout: 5000 });
    });

    await test.step('Repository HEAD matches the selected branch', async () => {
      expect(currentBranch(repoDir)).toBe('feature');
    });

    await closeElectronApp(app);
  });
});
