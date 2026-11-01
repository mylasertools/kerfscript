// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Writes package manager manifests for a release into release/manifests/,
// using the files and checksums in release/. A channel whose files are
// missing is skipped.
//
//   Command line (kerf):  Homebrew, Scoop, winget, Chocolatey, MacPorts, AUR
//   Desktop app:          winget, Chocolatey, AUR, Flathub
//
//   node scripts/manifests.mjs      (after node scripts/checksums.mjs)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { version, description, homepage } = JSON.parse(readFileSync('package.json', 'utf8'));
const label = process.env.KERF_LABEL ?? version;
const REPO = 'https://github.com/mylasertools/kerfscript';
const SUMMARY = 'A programming language for laser cutting';
const APP_ID = 'com.mylasertools.KerfScript';
const base = `${REPO}/releases/download/v${label}/`;
const has = (...files) => files.every((f) => existsSync(join('release', f)));
const sha = (f) => readFileSync(join('release', `${f}.sha256`), 'utf8').split(' ')[0];
const size = (f) => statSync(join('release', f)).size;
const cli = (target) =>
  `kerf-${label}-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`;
const app = (end) => `kerfscript-desktop-${label}-${end}`;
const out = join('release', 'manifests');
const made = [];
const write = (path, text) => {
  mkdirSync(join(out, path, '..'), { recursive: true });
  writeFileSync(join(out, path), text);
  made.push(path);
};

// Homebrew formula for the command line, for github.com/mylasertools/homebrew-tap.
// The desktop app has no cask: Homebrew only takes notarized macOS apps.
const UNIX = ['macos-arm64', 'macos-x64', 'linux-arm64', 'linux-x64'];
if (has(...UNIX.map(cli))) {
  const brew = (t) => `      url "${base}${cli(t)}"\n      sha256 "${sha(cli(t))}"`;
  write(
    'homebrew/kerfscript.rb',
    `class Kerfscript < Formula
  desc "Programming language for laser cutting"
  homepage "${homepage}"
  version "${label}"
  license "AGPL-3.0-only"

  on_macos do
    on_arm do
${brew('macos-arm64')}
    end
    on_intel do
${brew('macos-x64')}
    end
  end
  on_linux do
    on_arm do
${brew('linux-arm64')}
    end
    on_intel do
${brew('linux-x64')}
    end
  end

  def install
    bin.install "kerf"
    man1.install "kerf.1" if File.exist?("kerf.1")
    doc.install Dir["*.md"], "OFL.txt"
  end

  test do
    (testpath/"plate.kerf").write("rect([40, 20]);\\n")
    system bin/"kerf", "render", "plate.kerf", "-o", "plate.svg"
    assert_match "width=\\"46mm\\"", (testpath/"plate.svg").read
  end
end
`,
  );
}

// Scoop, for github.com/mylasertools/scoop-bucket or ScoopInstaller/Extras.
if (has(cli('windows-x64')))
  write(
    'scoop/kerfscript.json',
    JSON.stringify(
      {
        version: label,
        description,
        homepage,
        license: 'AGPL-3.0-only',
        architecture: {
          '64bit': {
            url: base + cli('windows-x64'),
            hash: sha(cli('windows-x64')),
            extract_dir: `kerf-${label}-windows-x64`,
          },
        },
        bin: 'kerf.exe',
        checkver: { github: REPO },
        autoupdate: {
          architecture: {
            '64bit': {
              url: `${REPO}/releases/download/v$version/kerf-$version-windows-x64.zip`,
              extract_dir: 'kerf-$version-windows-x64',
            },
          },
          hash: { url: '$url.sha256' },
        },
      },
      null,
      2,
    ) + '\n',
  );

// winget, as pull requests to microsoft/winget-pkgs. The desktop app is
// MyLaserTools.KerfScript; the command line is MyLaserTools.KerfScript.CLI.
function winget(id, name, moniker, installer) {
  const dir = `winget/manifests/m/${id.split('.').join('/')}/${label}/`;
  const head = (type) =>
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.6.0.schema.json\nPackageIdentifier: ${id}\nPackageVersion: ${label}\n`;
  const end = (type) => `ManifestType: ${type}\nManifestVersion: 1.6.0\n`;
  write(`${dir}${id}.yaml`, `${head('version')}DefaultLocale: en-US\n${end('version')}`);
  write(`${dir}${id}.installer.yaml`, `${head('installer')}${installer}${end('installer')}`);
  write(
    `${dir}${id}.locale.en-US.yaml`,
    `${head('defaultLocale')}PackageLocale: en-US
Publisher: MyLaserTools
PublisherUrl: https://mylasertools.com
PackageName: ${name}
PackageUrl: ${homepage}
License: AGPL-3.0-only
LicenseUrl: ${REPO}/blob/main/LICENSE
ShortDescription: ${JSON.stringify(SUMMARY)}
Description: ${JSON.stringify(description)}
Moniker: ${moniker}
Tags:
  - laser-cutting
  - cad
  - svg
  - dxf
${end('defaultLocale')}`,
  );
}
if (has(cli('windows-x64')))
  winget(
    'MyLaserTools.KerfScript.CLI',
    'KerfScript command line',
    'kerf',
    `InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: kerf-${label}-windows-x64\\kerf.exe
    PortableCommandAlias: kerf
Installers:
  - Architecture: x64
    InstallerUrl: ${base}${cli('windows-x64')}
    InstallerSha256: ${sha(cli('windows-x64')).toUpperCase()}
`,
  );
if (has(app('windows-x64-setup.exe')))
  winget(
    'MyLaserTools.KerfScript',
    'KerfScript',
    'kerfscript',
    `InstallerType: nullsoft
Scope: user
FileExtensions:
  - kerf
Installers:
  - Architecture: x64
    InstallerUrl: ${base}${app('windows-x64-setup.exe')}
    InstallerSha256: ${sha(app('windows-x64-setup.exe')).toUpperCase()}
`,
  );

// Chocolatey packages, pushed with `choco pack` and `choco push`.
function chocolatey(id, title, install) {
  write(
    `chocolatey/${id}/${id}.nuspec`,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>${id}</id>
    <version>${label}</version>
    <title>${title}</title>
    <authors>MyLaserTools</authors>
    <owners>MyLaserTools</owners>
    <projectUrl>${homepage}</projectUrl>
    <projectSourceUrl>${REPO}</projectSourceUrl>
    <packageSourceUrl>${REPO}/blob/main/scripts/manifests.mjs</packageSourceUrl>
    <docsUrl>${homepage}/docs/</docsUrl>
    <bugTrackerUrl>${REPO}/issues</bugTrackerUrl>
    <licenseUrl>${REPO}/blob/main/LICENSE</licenseUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <tags>kerfscript laser-cutting cad svg dxf</tags>
    <summary>${SUMMARY}</summary>
    <description>${description}</description>
    <releaseNotes>${REPO}/blob/main/CHANGELOG.md</releaseNotes>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
`,
  );
  write(
    `chocolatey/${id}/tools/chocolateyinstall.ps1`,
    `$ErrorActionPreference = 'Stop'\n${install}`,
  );
}
if (has(cli('windows-x64')))
  chocolatey(
    'kerfscript',
    'KerfScript (command line)',
    `# Chocolatey makes a kerf shim for kerf.exe
Install-ChocolateyZipPackage -PackageName $env:ChocolateyPackageName \`
  -Url64bit '${base}${cli('windows-x64')}' \`
  -Checksum64 '${sha(cli('windows-x64'))}' -ChecksumType64 'sha256' \`
  -UnzipLocation (Split-Path -Parent $MyInvocation.MyCommand.Definition)
`,
  );
if (has(app('windows-x64.msi')))
  chocolatey(
    'kerfscript-desktop',
    'KerfScript',
    `Install-ChocolateyPackage -PackageName $env:ChocolateyPackageName -FileType 'msi' \`
  -Url64bit '${base}${app('windows-x64.msi')}' \`
  -Checksum64 '${sha(app('windows-x64.msi'))}' -ChecksumType64 'sha256' \`
  -SilentArgs '/qn /norestart' -ValidExitCodes @(0, 3010)
`,
  );

// MacPorts Portfile for the command line, as a pull request to
// macports/macports-ports (graphics/kerfscript/Portfile).
if (has(cli('macos-arm64'), cli('macos-x64'))) {
  const port = (t) =>
    `    distname            kerf-\${version}-${t}\n    checksums           sha256  ${sha(cli(t))} \\\n                        size    ${size(cli(t))}`;
  write(
    'macports/Portfile',
    `# -*- coding: utf-8; mode: tcl; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- vim:fenc=utf-8:ft=tcl:et:sw=4:ts=4:sts=4

PortSystem          1.0

name                kerfscript
version             ${label}
revision            0
categories          graphics cad
license             AGPL-3
maintainers         {mylasertools.com:hi} openmaintainer
description         ${SUMMARY}
long_description    KerfScript is a programming language for laser cutting. \\
                    Write parametric 2D parts with cut, score and engrave \\
                    layers, kerf compensation and joinery, and export SVG or DXF.
homepage            ${homepage}
platforms           {darwin >= 20}
supported_archs     arm64 x86_64

master_sites        ${REPO}/releases/download/v\${version}/
extract.suffix      .tar.gz
if {\${build_arch} eq "arm64"} {
${port('macos-arm64')}
} else {
${port('macos-x64')}
}

use_configure       no
build               {}

destroot {
    xinstall -m 0755 \${worksrcpath}/kerf \${destroot}\${prefix}/bin/kerf
    xinstall -d \${destroot}\${prefix}/share/doc/\${name}
    xinstall -m 0644 {*}[glob \${worksrcpath}/*.md] \${worksrcpath}/LICENSE \\
        \${worksrcpath}/OFL.txt \${destroot}\${prefix}/share/doc/\${name}
}
`,
  );
}

// AUR packages: kerfscript-bin (command line) and kerfscript-desktop-bin.
function aur(pkgname, { pkgdesc, depends = [], sources, body }) {
  const arches = Object.keys(sources);
  const list = (xs) => xs.map((x) => `'${x}'`).join(' ');
  write(
    `aur/${pkgname}/PKGBUILD`,
    `# Maintainer: MyLaserTools <hi@mylasertools.com>
pkgname=${pkgname}
pkgver=${label}
pkgrel=1
pkgdesc="${pkgdesc}"
arch=(${list(arches)})
url="${homepage}"
license=('AGPL-3.0-only')
${depends.length ? `depends=(${list(depends)})\n` : ''}provides=('${pkgname.replace(/-bin$/, '')}')
conflicts=('${pkgname.replace(/-bin$/, '')}')
options=('!strip' '!debug')
${arches.map((a) => `source_${a}=("${base}${sources[a]}")`).join('\n')}
${arches.map((a) => `sha256sums_${a}=('${sha(sources[a])}')`).join('\n')}

package() {
${body}
}
`,
  );
  write(
    `aur/${pkgname}/.SRCINFO`,
    `pkgbase = ${pkgname}
\tpkgdesc = ${pkgdesc}
\tpkgver = ${label}
\tpkgrel = 1
\turl = ${homepage}
${arches.map((a) => `\tarch = ${a}`).join('\n')}
\tlicense = AGPL-3.0-only
${depends.map((d) => `\tdepends = ${d}\n`).join('')}\tprovides = ${pkgname.replace(/-bin$/, '')}
\tconflicts = ${pkgname.replace(/-bin$/, '')}
\toptions = !strip
\toptions = !debug
${arches.map((a) => `\tsource_${a} = ${base}${sources[a]}\n\tsha256sums_${a} = ${sha(sources[a])}`).join('\n')}

pkgname = ${pkgname}
`,
  );
}
if (has(cli('linux-x64'), cli('linux-arm64')))
  aur('kerfscript-bin', {
    pkgdesc: `${SUMMARY} (command line)`,
    sources: { x86_64: cli('linux-x64'), aarch64: cli('linux-arm64') },
    body: `  cd "kerf-\${pkgver}-linux-$([[ $CARCH == aarch64 ]] && echo arm64 || echo x64)"
  install -Dm755 kerf "$pkgdir/usr/bin/kerf"
  install -Dm644 kerf.1 "$pkgdir/usr/share/man/man1/kerf.1"
  install -Dm644 kerfscript.xml "$pkgdir/usr/share/mime/packages/kerfscript.xml"
  install -Dm644 LICENSE COMMERCIAL-LICENSE.md OFL.txt THIRD-PARTY-NOTICES.md THIRD-PARTY-LICENSES.md -t "$pkgdir/usr/share/licenses/$pkgname/"`,
  });
if (has(app('linux-x64.deb'), app('linux-arm64.deb')))
  aur('kerfscript-desktop-bin', {
    pkgdesc: SUMMARY,
    depends: ['webkit2gtk-4.1', 'gtk3', 'hicolor-icon-theme'],
    sources: { x86_64: app('linux-x64.deb'), aarch64: app('linux-arm64.deb') },
    body: `  # makepkg unpacks the .deb; its files are in data.tar.*
  tar -xf data.tar.* -C "$pkgdir"
  # The app's licences are in /usr/lib/KerfScript; Arch looks in /usr/share/licenses
  install -Dm644 "$pkgdir"/usr/lib/KerfScript/* -t "$pkgdir/usr/share/licenses/$pkgname/"`,
  });

// Flathub, as github.com/flathub/com.mylasertools.KerfScript. It repackages
// the desktop .deb, as the Tauri guide for Flathub does, on the GNOME runtime.
// GNOME 51 is the last runtime with webkit2gtk-4.1, which Tauri 2 uses, and is
// supported until about September 2027 (gnome-build-meta!4734).
if (has(app('linux-x64.deb'), app('linux-arm64.deb'))) {
  const deb = (arch, end) => `      - type: file
        url: ${base}${app(end)}
        sha256: ${sha(app(end))}
        dest-filename: kerfscript.deb
        only-arches: [${arch}]`;
  write(
    `flathub/${APP_ID}.yml`,
    `id: ${APP_ID}
runtime: org.gnome.Platform
runtime-version: '51'
sdk: org.gnome.Sdk
command: kerfscript
finish-args:
  - --socket=wayland
  - --socket=fallback-x11
  - --device=dri
  - --share=ipc
  # Open and save .kerf files anywhere, and read the libraries next to them
  - --filesystem=home
  # Open in LightBurn talks to LightBurn's API on this computer (127.0.0.1)
  - --share=network
modules:
  - name: kerfscript
    buildsystem: simple
    sources:
${deb('x86_64', 'linux-x64.deb')}
${deb('aarch64', 'linux-arm64.deb')}
      - type: file
        path: ${APP_ID}.metainfo.xml
    build-commands:
      - ar -x kerfscript.deb
      - tar -xf data.tar.*
      - install -Dm755 usr/bin/kerfscript /app/bin/kerfscript
      - install -Dm644 usr/share/applications/*.desktop /app/share/applications/\${FLATPAK_ID}.desktop
      - desktop-file-edit --set-icon=\${FLATPAK_ID} --set-key=Exec --set-value='kerfscript %F' /app/share/applications/\${FLATPAK_ID}.desktop
      - |
        for png in usr/share/icons/hicolor/*/apps/*.png; do
          size=$(basename "$(dirname "$(dirname "$png")")")
          install -Dm644 "$png" "/app/share/icons/hicolor/$size/apps/\${FLATPAK_ID}.png"
        done
      - install -Dm644 usr/share/mime/packages/${APP_ID}.xml /app/share/mime/packages/\${FLATPAK_ID}.xml
      - install -Dm644 ${APP_ID}.metainfo.xml /app/share/metainfo/\${FLATPAK_ID}.metainfo.xml
      # Licences: where the app finds them (next to /app/bin, as /usr/lib in
      # the .deb), and where Flatpak tools look
      - mkdir -p /app/lib/KerfScript && cp -r usr/lib/KerfScript/. /app/lib/KerfScript/
      - install -Dm644 usr/lib/KerfScript/* -t /app/share/licenses/\${FLATPAK_ID}/
`,
  );
  write(
    `flathub/${APP_ID}.metainfo.xml`,
    readFileSync(`packaging/flatpak/${APP_ID}.metainfo.xml`, 'utf8'),
  );
}

console.log(`Wrote ${made.length} files for ${label} to ${out}/:\n  ${made.join('\n  ')}`);
