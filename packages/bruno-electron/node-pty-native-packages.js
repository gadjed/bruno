const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Prebuilt @lydell/node-pty binaries. Keep pinned and in sync with @lydell/node-pty.
const NODE_PTY_VERSION = '1.1.0';

const NODE_PTY_NATIVE_PACKAGES_BY_PLATFORM = {
  darwin: ['@lydell/node-pty-darwin-arm64', '@lydell/node-pty-darwin-x64'],
  linux: ['@lydell/node-pty-linux-arm64', '@lydell/node-pty-linux-x64'],
  win32: ['@lydell/node-pty-win32-arm64', '@lydell/node-pty-win32-x64']
};

const NODE_PTY_NATIVE_PACKAGES = Object.values(NODE_PTY_NATIVE_PACKAGES_BY_PLATFORM).flat();

const resolveNodePtyNativePackages = (platforms) => {
  if (!platforms || platforms.length === 0) {
    return NODE_PTY_NATIVE_PACKAGES;
  }

  return platforms.flatMap((platform) => {
    return NODE_PTY_NATIVE_PACKAGES_BY_PLATFORM[platform] || [];
  });
};

const getNodePtyNativeFileSets = () => {
  return [
    {
      from: '../../node_modules',
      to: 'node_modules',
      filter: NODE_PTY_NATIVE_PACKAGES.map((pkg) => `${pkg}/**/*`)
    }
  ];
};

const getMissingNodePtyNativePackages = (repoRoot, platforms) => {
  return resolveNodePtyNativePackages(platforms).filter((pkg) => {
    return !fs.existsSync(path.join(repoRoot, 'node_modules', pkg, 'pty.node'));
  });
};

const ensureNodePtyNativePackages = (repoRoot = path.join(__dirname, '../..'), options = {}) => {
  const platforms = options.platforms;
  const missing = getMissingNodePtyNativePackages(repoRoot, platforms);
  if (missing.length > 0) {
    const specs = missing.map((pkg) => `${pkg}@${NODE_PTY_VERSION}`);
    execSync(`npm i --legacy-peer-deps --no-save --force ${specs.join(' ')}`, {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  }

  const stillMissing = getMissingNodePtyNativePackages(repoRoot, platforms);
  if (stillMissing.length > 0) {
    throw new Error(
      `Missing @lydell/node-pty native binaries (${stillMissing.join(', ')}). `
      + 'These optional packages must be installed without --omit=optional so packaged apps can load pty.node.'
    );
  }
};

module.exports = {
  NODE_PTY_VERSION,
  NODE_PTY_NATIVE_PACKAGES,
  NODE_PTY_NATIVE_PACKAGES_BY_PLATFORM,
  resolveNodePtyNativePackages,
  getNodePtyNativeFileSets,
  getMissingNodePtyNativePackages,
  ensureNodePtyNativePackages
};
