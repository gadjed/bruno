const { ipcMain } = require('electron');
const { cloneGitRepository } = require('../utils/git');
const { createDirectory, removeDirectory } = require('../utils/filesystem');
const {
  initGitAutoSync,
  checkAndPullAll,
  pushAllChanges,
  refreshUncommittedCount,
  refreshBranchInfo,
  checkoutOpenRepoBranch,
  getStatus
} = require('../app/git-auto-sync');

const registerGitIpc = (mainWindow) => {
  initGitAutoSync(mainWindow);

  ipcMain.handle('renderer:clone-git-repository', async (event, { url, path, processUid }) => {
    let directoryCreated = false;
    try {
      await createDirectory(path);
      directoryCreated = true;
      await cloneGitRepository(mainWindow, { url, path, processUid });
      return 'Repository cloned successfully';
    } catch (error) {
      if (directoryCreated) {
        await removeDirectory(path);
      }
      return Promise.reject(error);
    }
  });

  ipcMain.handle('renderer:git-auto-sync-check', async () => {
    return checkAndPullAll({ reason: 'manual' });
  });

  ipcMain.handle('renderer:git-auto-sync-push', async () => {
    return pushAllChanges();
  });

  ipcMain.handle('renderer:git-auto-sync-get-status', async () => {
    return getStatus();
  });

  ipcMain.handle('renderer:git-auto-sync-refresh-uncommitted', async () => {
    return refreshUncommittedCount();
  });

  ipcMain.handle('renderer:git-auto-sync-list-branches', async () => {
    return refreshBranchInfo();
  });

  ipcMain.handle('renderer:git-auto-sync-checkout', async (event, branchName) => {
    return checkoutOpenRepoBranch(branchName);
  });
};

module.exports = registerGitIpc;
