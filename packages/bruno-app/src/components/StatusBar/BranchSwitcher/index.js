import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { IconGitFork } from '@tabler/icons';
import ToolHint from 'components/ToolHint';
import MenuDropdown from 'ui/MenuDropdown';
import { refreshGitBranches, switchGitBranch } from 'providers/ReduxStore/slices/app';
import toast from 'react-hot-toast';
import StyledWrapper from './StyledWrapper';

const BranchSwitcher = () => {
  const dispatch = useDispatch();
  const gitAutoSyncStatus = useSelector((state) => state.app.gitAutoSyncStatus);
  const [tooltipEnabled, setTooltipEnabled] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);

  const currentBranch = gitAutoSyncStatus?.currentBranch || null;
  const mixed = Boolean(gitAutoSyncStatus?.mixed);
  const branches = Array.isArray(gitAutoSyncStatus?.branches) ? gitAutoSyncStatus.branches : [];
  const syncBusy = gitAutoSyncStatus?.state === 'checking' || gitAutoSyncStatus?.state === 'syncing';
  const displayName = mixed ? 'Multiple' : currentBranch;
  const hasRepo = Boolean(displayName || branches.length);

  if (!hasRepo) {
    return null;
  }

  const handleOpenChange = (opened) => {
    setTooltipEnabled(!opened);
    if (opened) {
      dispatch(refreshGitBranches());
    }
  };

  const handleSwitch = async (branchName) => {
    if (!branchName || branchName === currentBranch || isSwitching || syncBusy) {
      return;
    }
    setIsSwitching(true);
    try {
      const status = await dispatch(switchGitBranch(branchName));
      if (status?.state === 'error') {
        toast.error(status.message || 'Failed to switch branch');
      } else {
        toast.success(status?.message || `Switched to ${branchName}`);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to switch branch');
    } finally {
      setIsSwitching(false);
    }
  };

  const branchNames = branches.length
    ? branches
    : (currentBranch ? [currentBranch] : []);

  const items = branchNames.map((branch) => ({
    id: branch,
    label: branch,
    disabled: isSwitching || syncBusy,
    onClick: () => handleSwitch(branch)
  }));

  const hint = mixed
    ? 'Open collections are on different git branches'
    : `Git branch: ${displayName}`;

  return (
    <StyledWrapper>
      <ToolHint text={hint} toolhintId="GitBranchSwitcher" place="top" offset={10} hidden={!tooltipEnabled}>
        <MenuDropdown
          items={items}
          placement="top-end"
          selectedItemId={mixed ? null : currentBranch}
          onChange={handleOpenChange}
          data-testid="git-branch-switcher-menu"
        >
          <button
            className={`status-bar-button ${isSwitching || syncBusy ? 'is-busy' : ''}`}
            data-trigger="git-branch-switcher"
            data-testid="git-branch-switcher"
            disabled={isSwitching}
            tabIndex={0}
            aria-label={mixed ? 'Git branch: multiple repositories' : `Git branch: ${displayName}`}
            title={displayName || 'Git branch'}
          >
            <div className="console-button-content">
              <IconGitFork size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="console-label branch-name" data-testid="git-branch-name">
                {displayName || 'Branch'}
              </span>
            </div>
          </button>
        </MenuDropdown>
      </ToolHint>
    </StyledWrapper>
  );
};

export default BranchSwitcher;
