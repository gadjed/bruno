import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;

  .branch-name {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export default StyledWrapper;
