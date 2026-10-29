import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Debian expects 0755 directories and executables and 0644 for everything else,
// regardless of the umask the package was built under.
function normalizeModes(root) {
  chmodSync(root, 0o755)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) normalizeModes(path)
    else chmodSync(path, statSync(path).mode & 0o111 ? 0o755 : 0o644)
  }
}

export const CLI_DEB_PACKAGE = 'workspace-manager-cli'
export const CLI_DEB_MAINTAINER = 'Bence Márk Lukács <43961338+xlukacs@users.noreply.github.com>'

export function debianControl({ version, installedSizeKb }) {
  return `Package: ${CLI_DEB_PACKAGE}
Version: ${version}
Section: devel
Priority: optional
Architecture: all
Depends: nodejs (>= 18)
Installed-Size: ${installedSizeKb}
Maintainer: ${CLI_DEB_MAINTAINER}
Homepage: https://github.com/xlukacs/WorkspaceManager
Description: CLI and MCP server for Workspace Manager
 Inspect local development workspaces and run project commands from the
 terminal, stdio MCP, or HTTP MCP (http://127.0.0.1:3847/mcp).
`
}

export function systemdUserUnit() {
  return `[Unit]
Description=Workspace Manager MCP HTTP server
Documentation=https://github.com/xlukacs/WorkspaceManager
After=network.target

[Service]
ExecStart=/usr/bin/workspace-manager mcp --http --host 127.0.0.1 --port 3847
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`
}

export function launcherScript() {
  return `#!/bin/sh
exec /usr/bin/node /usr/lib/${CLI_DEB_PACKAGE}/index.js "$@"
`
}

export function postinstScript() {
  return `#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
echo "${CLI_DEB_PACKAGE} installed. Binaries: workspace-manager, wsm"
echo "Local MCP HTTP: systemctl --user enable --now workspace-manager-mcp"
echo "Then point agents at http://127.0.0.1:3847/mcp"
`
}

export function postrmScript() {
  return `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now workspace-manager-mcp >/dev/null 2>&1 || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
fi
`
}

export function copyrightFile() {
  return `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Workspace Manager
Source: https://github.com/xlukacs/WorkspaceManager

Files: *
Copyright: 2026 Bence Márk Lukács
License: MIT
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 .
 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.
`
}

export function debianReadme() {
  return `Workspace Manager CLI
=====================

Commands:
  workspace-manager list
  workspace-manager show <workspace>
  workspace-manager commands <workspace>
  workspace-manager run <workspace> <command>
  workspace-manager mcp
  workspace-manager mcp --http

After install, start a local HTTP MCP server (uses your user store):

  systemctl --user enable --now workspace-manager-mcp

Agents connect to http://127.0.0.1:3847/mcp
`
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o755 })
}

export function stagingTree(root) {
  return {
    debian: join(root, 'DEBIAN'),
    lib: join(root, 'usr/lib', CLI_DEB_PACKAGE),
    bin: join(root, 'usr/bin'),
    systemd: join(root, 'usr/lib/systemd/user'),
    docs: join(root, 'usr/share/doc', CLI_DEB_PACKAGE)
  }
}

export function writeDebianTree({ root, version, cliJsPath, packageJsonPath }) {
  const tree = stagingTree(root)
  mkdirSync(tree.debian, { recursive: true })
  mkdirSync(tree.lib, { recursive: true })
  mkdirSync(tree.bin, { recursive: true })
  mkdirSync(tree.systemd, { recursive: true })
  mkdirSync(tree.docs, { recursive: true })

  copyFileSync(cliJsPath, join(tree.lib, 'index.js'))
  chmodSync(join(tree.lib, 'index.js'), 0o755)
  writeFileSync(join(tree.lib, 'package.json'), JSON.stringify({
    name: CLI_DEB_PACKAGE,
    version,
    type: 'module'
  }, null, 2) + '\n')

  writeExecutable(join(tree.bin, 'workspace-manager'), launcherScript())
  writeExecutable(join(tree.bin, 'wsm'), launcherScript())
  writeFileSync(join(tree.systemd, 'workspace-manager-mcp.service'), systemdUserUnit())
  writeFileSync(join(tree.docs, 'copyright'), copyrightFile())
  writeFileSync(join(tree.docs, 'README.Debian'), debianReadme())
  if (packageJsonPath) {
    writeFileSync(join(tree.docs, 'changelog'), `${CLI_DEB_PACKAGE} (${version}) stable; urgency=medium\n\n  * CLI and HTTP MCP server package.\n\n -- ${CLI_DEB_MAINTAINER}  ${new Date().toUTCString()}\n`)
  }

  writeExecutable(join(tree.debian, 'postinst'), postinstScript())
  writeExecutable(join(tree.debian, 'postrm'), postrmScript())

  const installedSizeKb = Math.max(1, Math.ceil(
    (statSync(join(tree.lib, 'index.js')).size
      + statSync(join(tree.bin, 'workspace-manager')).size
      + statSync(join(tree.bin, 'wsm')).size) / 1024
  ))
  writeFileSync(join(tree.debian, 'control'), debianControl({ version, installedSizeKb }))
  normalizeModes(root)
  return tree
}

export function debFileName(version) {
  return `${CLI_DEB_PACKAGE}_${version}_all.deb`
}

