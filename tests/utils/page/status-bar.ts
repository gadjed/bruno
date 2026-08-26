import { Page, test } from '../../../playwright';

export const buildStatusBarLocators = (page: Page) => ({
  branchSwitcher: () => page.getByTestId('git-branch-switcher'),
  branchName: () => page.getByTestId('git-branch-name'),
  branchMenu: () => page.getByTestId('git-branch-switcher-menu-dropdown'),
  branchMenuItem: (branch: string) =>
    page.getByTestId('git-branch-switcher-menu-dropdown').getByRole('menuitem', { name: branch, exact: true })
});

export const openGitBranchSwitcher = async (page: Page) => {
  await test.step('Open git branch switcher', async () => {
    const statusBar = buildStatusBarLocators(page);
    await statusBar.branchSwitcher().click();
    await statusBar.branchMenu().waitFor({ state: 'visible' });
  });
};

export const switchGitBranchFromStatusBar = async (page: Page, branch: string) => {
  await openGitBranchSwitcher(page);
  await test.step(`Switch to git branch "${branch}"`, async () => {
    const statusBar = buildStatusBarLocators(page);
    await statusBar.branchMenuItem(branch).click();
  });
};
