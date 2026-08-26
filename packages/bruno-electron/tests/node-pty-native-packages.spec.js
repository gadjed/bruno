const {
  NODE_PTY_NATIVE_PACKAGES,
  getNodePtyNativeFileSets,
  resolveNodePtyNativePackages
} = require('../node-pty-native-packages');
const config = require('../electron-builder-config');

describe('node-pty native packaging', () => {
  it('includes the Linux x64 binary used by AppImage', () => {
    expect(NODE_PTY_NATIVE_PACKAGES).toContain('@lydell/node-pty-linux-x64');
  });

  it('resolves only the target platform packages during a Linux build', () => {
    expect(resolveNodePtyNativePackages(['linux'])).toEqual([
      '@lydell/node-pty-linux-arm64',
      '@lydell/node-pty-linux-x64'
    ]);
  });

  it('copies native binaries from the repo node_modules without requiring every OS to be present', () => {
    expect(getNodePtyNativeFileSets()).toEqual([
      {
        from: '../../node_modules',
        to: 'node_modules',
        filter: NODE_PTY_NATIVE_PACKAGES.map((pkg) => `${pkg}/**/*`)
      }
    ]);
  });

  it('unpacks node-pty native modules from asar', () => {
    expect(config.asarUnpack).toEqual(expect.arrayContaining([
      '**/*.node',
      '**/node_modules/@lydell/node-pty*/**'
    ]));
  });

  it('ships node-pty binaries via electron-builder files', () => {
    expect(config.files).toEqual(expect.arrayContaining([
      {
        from: '../../node_modules',
        to: 'node_modules',
        filter: NODE_PTY_NATIVE_PACKAGES.map((pkg) => `${pkg}/**/*`)
      }
    ]));
  });
});
