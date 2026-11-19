'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const contents = path.join(dist, 'Font Manage.app', 'Contents');
const bin = path.join(contents, 'MacOS');
const resources = path.join(contents, 'Resources');
const appRoot = path.join(resources, 'app');
const info = path.join(contents, 'Info.plist');

fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(info, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>zh-Hans</string>
    <key>CFBundleDisplayName</key><string>Font Manage</string>
    <key>CFBundleExecutable</key><string>FontManage</string>
    <key>CFBundleIdentifier</key><string>local.fontmanage.workspace</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>Font Manage</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0.0</string>
    <key>CFBundleVersion</key><string>1.0.0</string>
    <key>LSUIElement</key><false/>
    <key>NSAppTransportSecurity</key>
    <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
`);
function compile(source, target, frameworks, options = []) {
  const args = ['-O', ...frameworks.flatMap(name => ['-framework', name]), ...options,
    path.join(root, 'native', source), '-o', path.join(dist, target)];
  execFileSync('swiftc', args, { stdio: 'inherit' });
}
compile('FontEngine.swift', 'font-engine', ['AppKit', 'CoreText']);
compile('Workspace.swift', 'font-workspace', ['AppKit', 'WebKit'],
  ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', info]);

fs.rmSync(appRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(appRoot, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(appRoot, 'dist'), { recursive: true });
for (const directory of ['server', 'src', 'web', 'config']) {
  fs.cpSync(path.join(root, directory), path.join(appRoot, directory), { recursive: true });
}
fs.copyFileSync(path.join(root, 'scripts', 'start.cjs'), path.join(appRoot, 'scripts', 'start.cjs'));
for (const binary of ['font-engine', 'font-workspace']) {
  fs.copyFileSync(path.join(dist, binary), path.join(appRoot, 'dist', binary));
  fs.chmodSync(path.join(appRoot, 'dist', binary), 0o755);
}
const launcher = path.join(bin, 'FontManage');
fs.writeFileSync(launcher, `#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../Resources/app" && pwd)
export FONT_MANAGE_DATA="\${FONT_MANAGE_DATA:-$HOME/Library/Application Support/Font Manage}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /usr/bin/env node "$APP_DIR/scripts/start.cjs"
`);
fs.chmodSync(launcher, 0o755);
console.log('Built dist/Font Manage.app (self-contained application resources)');
