import styled from 'styled-components';

const StyledWrapper = styled.div`
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    height: 1.5rem;
    background: ${(props) => props.theme.sidebar.bg};
    border-top: 1px solid ${(props) => props.theme.statusBar.border};
    color: ${(props) => props.theme.statusBar.color};
    font-size: ${(props) => props.theme.font.size.sm};
    user-select: none;
    position: relative;
  }

  .status-bar-section {
    display: flex;
    align-items: center;
    position: relative;
  }

  .status-bar-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .status-bar-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    cursor: pointer;
    position: relative;
    outline: none;

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }

    &.is-busy .spin {
      animation: status-bar-spin 1s linear infinite;
    }
  }

  @keyframes status-bar-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .console-button-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    position: relative;
  }

  .console-label {
    white-space: nowrap;
  }

  .error-count-inline {
    font-size: 10px;
    font-weight: 500;
    color: ${(props) => props.theme.colors.text.danger};
    background: ${(props) => props.theme.colors.bg.danger}20;
    padding: 1px 4px;
    border-radius: 4px;
  }

  .uncommitted-count-inline {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    min-width: 1.1rem;
    text-align: center;
    line-height: 1.2;

    &.is-clean {
      color: ${(props) => props.theme.colors.text.green};
      background: ${(props) => props.theme.colors.text.green}20;
    }

    &.has-changes {
      color: ${(props) => props.theme.colors.text.danger};
      background: ${(props) => props.theme.colors.bg.danger}20;
    }
  }

  .status-bar-divider {
    width: 1px;
    height: 16px;
    background: ${(props) => props.theme.sidebar.dragbar};
    opacity: 0.4;
  }

  .status-bar-version {
    display: flex;
    align-items: center;
    padding: 2px 6px;
  }
`;

export default StyledWrapper;
