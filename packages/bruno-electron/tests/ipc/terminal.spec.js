jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  }
}));

jest.mock('electron-is-dev', () => false);

jest.mock('@lydell/node-pty', () => {
  const error = new Error('The @lydell/node-pty package supports your platform (linux-x64), but it could not find the binary package for it: @lydell/node-pty-linux-x64/pty.node');
  error.code = 'MODULE_NOT_FOUND';
  throw error;
});

jest.spyOn(console, 'error').mockImplementation(() => {});

const { ipcMain } = require('electron');
const TerminalManager = require('../../src/ipc/terminal');

describe('TerminalManager without node-pty', () => {
  beforeEach(() => {
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
  });

  it('starts without throwing when the native binary is missing', () => {
    expect(() => new TerminalManager()).not.toThrow();
    expect(ipcMain.handle).toHaveBeenCalledWith('terminal:create', expect.any(Function));
  });

  it('returns null from terminal:create when PTY cannot be loaded', () => {
    new TerminalManager();
    const createHandler = ipcMain.handle.mock.calls.find((call) => {
      return call[0] === 'terminal:create';
    })[1];

    expect(createHandler({ sender: {} }, {})).toBeNull();
  });
});
