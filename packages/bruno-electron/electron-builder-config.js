require('dotenv').config({ path: process.env.DOTENV_PATH });

const unsigned = process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'
  || process.env.BRUNO_UNSIGNED === '1'
  || process.env.BRUNO_UNSIGNED === 'true';

// Prefer current machine arch for local unsigned builds (M1/M2/M3 => arm64)
const localArch = process.arch === 'arm64' ? 'arm64' : 'x64';

const config = {
  appId: 'com.usebruno.app',
  productName: 'Bruno',
  electronVersion: '37.6.1',
  directories: {
    buildResources: 'resources',
    output: 'out'
  },
  extraResources: [
    {
      from: 'resources/data/sample-collection.json',
      to: 'data/sample-collection.json'
    }
  ],
  files: ['**/*'],
  afterSign: unsigned ? undefined : 'notarize.js',
  mac: {
    artifactName: '${name}_${version}_${arch}_${os}.${ext}',
    category: 'public.app-category.developer-tools',
    target: unsigned
      ? [
          {
            target: 'dmg',
            arch: [localArch]
          }
        ]
      : [
          {
            target: 'pkg',
            arch: ['x64', 'arm64']
          },
          {
            target: 'dmg',
            arch: ['x64', 'arm64']
          },
          {
            target: 'zip',
            arch: ['x64', 'arm64']
          }
        ],
    icon: 'resources/icons/mac/icon.icns',
    hardenedRuntime: !unsigned,
    identity: unsigned ? null : 'Anoop MD (W7LPPWA48L)',
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    notarize: false,
    requirements: unsigned ? undefined : 'resources/app-requirements.txt',
    protocols: [
      {
        name: 'Bruno',
        schemes: [
          'bruno'
        ]
      }
    ]
  },
  linux: {
    artifactName: '${name}_${version}_${arch}_${os}.${ext}',
    icon: 'resources/icons/png',
    target: unsigned
      ? [
          {
            target: 'AppImage',
            arch: ['x64', 'arm64']
          },
          {
            target: 'deb',
            arch: ['x64', 'arm64']
          }
        ]
      : [
          {
            target: 'AppImage',
            arch: ['x64', 'arm64']
          },
          {
            target: 'deb',
            arch: ['x64', 'arm64']
          },
          {
            target: 'rpm',
            arch: ['x64', 'arm64']
          }
        ],
    protocols: [
      {
        name: 'Bruno',
        schemes: ['bruno']
      }
    ],
    category: 'Development',
    desktop: {
      MimeType: 'x-scheme-handler/bruno;'
    }
  },
  deb: {
    // Docs: https://www.electron.build/configuration/linux#debian-package-options
    depends: [
      'libgtk-3-0',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'xdg-utils',
      'libatspi2.0-0',
      'libuuid1',
      'libsecret-1-0',
      'libasound2' // #1036
    ]
  },
  win: {
    artifactName: '${name}_${version}_${arch}_win.${ext}',
    icon: 'resources/icons/win/icon.ico',
    // zip works cross-platform without Wine; nsis requires Windows/Wine
    target: unsigned
      ? [
          {
            target: 'zip',
            arch: ['x64', 'arm64']
          }
        ]
      : [
          {
            target: 'nsis',
            arch: ['x64', 'arm64']
          }
        ],
    sign: null,
    publisherName: 'Bruno Software Inc'
  },
  nsis: {
    include: 'resources/installer.nsh',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  pkg: {
    installLocation: '/Applications',
    isRelocatable: false
  }
};

module.exports = config;
