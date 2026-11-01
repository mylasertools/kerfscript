# Releasing

How KerfScript reaches people, and what a maintainer does for each release.
`.github/workflows/release.yml` does the building; this file covers the
accounts it needs and the steps it cannot do alone.

## Channels

Desktop app (`desktop/`, Tauri):

| Channel         | Name                                                                                                                       | Made by                    | Releases                 | Nightlies                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------ | ---------------------------- |
| GitHub releases | `kerfscript-desktop-<v>-windows-x64-setup.exe` and `.msi`, `-macos-universal.dmg`, `-linux-<x64/arm64>.AppImage/.deb/.rpm` | workflow                   | draft, published by hand | rolling `nightly` prerelease |
| winget          | `MyLaserTools.KerfScript`                                                                                                  | manifest from the workflow | yes                      | no                           |
| Chocolatey      | `kerfscript-desktop`                                                                                                       | manifest from the workflow | yes                      | no                           |
| Flathub         | `com.mylasertools.KerfScript`                                                                                              | manifest from the workflow | yes                      | no                           |
| AUR             | `kerfscript-desktop-bin`                                                                                                   | manifest from the workflow | yes                      | no                           |

Command line, WebAssembly and library:

| Channel            | Name                                                                                                  | Made by                        | Releases                 | Nightlies                    |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------ | ---------------------------- |
| npm                | `@mylasertools/kerfscript`                                                                            | `npm publish` by hand          | yes                      | no                           |
| GitHub releases    | `kerf-<v>-<os>-<arch>.zip/.tar.gz`, `kerfscript-<v>.wasm`, `kerfscript-cli-<v>-linux-<arch>.deb/.rpm` | workflow                       | draft, published by hand | rolling `nightly` prerelease |
| Docker             | `ghcr.io/mylasertools/kerfscript`, `mylasertools/kerfscript`                                          | workflow                       | `<v>`, `latest`          | `dev`, `dev.YYYY-MM-DD`      |
| Snap Store         | `kerfscript`                                                                                          | workflow                       | `stable`                 | `edge`                       |
| Homebrew           | `mylasertools/tap/kerfscript`                                                                         | manifest from the workflow     | yes                      | no                           |
| Scoop              | `kerfscript`                                                                                          | manifest from the workflow     | yes                      | no                           |
| winget             | `MyLaserTools.KerfScript.CLI`                                                                         | manifest from the workflow     | yes                      | no                           |
| Chocolatey         | `kerfscript`                                                                                          | manifest from the workflow     | yes                      | no                           |
| MacPorts           | `kerfscript`                                                                                          | manifest from the workflow     | yes                      | no                           |
| AUR                | `kerfscript-bin`                                                                                      | manifest from the workflow     | yes                      | no                           |
| Website playground | kerfscript.mylasertools.com                                                                           | `npm --prefix site run deploy` | yes                      | no                           |

Every file in a GitHub release has a `.sha256` and `.sha512` file, and an
`.asc` GPG signature once `GPG_PRIVATE_KEY` is set. `SHA256SUMS` lists them
all.

There is no Homebrew cask for the desktop app: Homebrew only accepts macOS
apps that are signed and notarized, which needs an Apple Developer account.

## One-time setup

Repository secrets (Settings → Secrets and variables → Actions). The
workflow skips a step whose secret is missing.

- `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`: an armored release signing key
  (`gpg --armor --export-secret-keys <id>`). Publish the public key on the
  website and a keyserver, and put its fingerprint in SECURITY.md, so people
  can check signatures.
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`: a Docker Hub access token with
  write access to `mylasertools/kerfscript`. ghcr.io needs no secret. Make
  the ghcr.io package public after its first push.
- `SNAPCRAFT_STORE_CREDENTIALS`: register the name with
  `snapcraft register kerfscript`, then
  `snapcraft export-login --snaps=kerfscript --channels=stable,edge -`.
  Ask for the `kerf` alias in the Snap Store forum, so `kerf` works instead
  of `kerfscript.kerf`.

Repositories and accounts:

- Homebrew: create `github.com/mylasertools/homebrew-tap` with a `Formula/`
  folder.
- Scoop: create `github.com/mylasertools/scoop-bucket` with a `bucket/`
  folder, or submit to ScoopInstaller/Extras once the project is better known.
- AUR: an account at aur.archlinux.org with an SSH key. Each package is its
  own repository: `git clone ssh://aur@aur.archlinux.org/kerfscript-bin.git`
  and `.../kerfscript-desktop-bin.git`.
- Chocolatey: an account at community.chocolatey.org and its API key
  (`choco apikey --key <key> --source https://push.chocolatey.org/`). New
  packages and versions go through moderation.
- Flathub: the first version goes in as a pull request to
  github.com/flathub/flathub (branch `new-pr`) with the generated `.yml` and
  metainfo; Flathub then makes `github.com/flathub/com.mylasertools.KerfScript`
  for later versions. Flathub checks that the app id's domain belongs to you:
  verify mylasertools.com in the Flathub developer portal. The metainfo's
  screenshot must exist at
  `https://kerfscript.mylasertools.com/screenshots/desktop.png`: save a
  screenshot of the app as `site/public/screenshots/desktop.png` and deploy
  the site before submitting.
  The Flathub build uses the GNOME 51 runtime, the last with the
  webkit2gtk-4.1 that Tauri 2 needs; it is supported until about September 2027. Before then the app needs a Tauri release on webkitgtk-6.0, or the
  Flathub build has to bundle WebKitGTK itself.
- MacPorts: a pull request to github.com/macports/macports-ports adding
  `graphics/kerfscript/Portfile`; check it with `port lint --nitpick` on a Mac.
- winget: nothing; releases go in as pull requests to microsoft/winget-pkgs.

## Licence lists

Two files list the Rust code compiled into a release, with licences, source
links and licence texts:

- `desktop/THIRD-PARTY-LICENSES.md`: the desktop app. After a change to
  `desktop/src-tauri/Cargo.lock`, run `node scripts/licenses.mjs` in
  `desktop/`.
- `packaging/wasm/THIRD-PARTY-LICENSES.md`: the JavaScript engine Javy builds
  into kerfscript.wasm. After changing `JAVY_VERSION` (in both workflows and
  `scripts/wasm-licenses.mjs`), run `node scripts/wasm-licenses.mjs`.
- `packaging/cli/THIRD-PARTY-LICENSES.md`: the Deno runtime, with V8, that
  `deno compile` builds into the `kerf` binaries. After changing
  `deno-version` in the release and CI workflows (and `DENO_VERSION` in
  `scripts/cli-licenses.mjs`, which the workflow checks), run
  `node scripts/cli-licenses.mjs`. The `v8` crate ships none of the licence
  files of V8 and the libraries built into it, so
  `packaging/licenses/v8-<version>/` holds them, from rusty_v8's submodules;
  a new `v8` version needs them fetched again.

All three stop when a crate ships no licence file. Run them with `--fetch` to
download the licence files of its repository at the commit it was published
from into `packaging/licenses/<crate>-<version>/`, read what came back, and
commit it. When a repository has none either, add the licence text the
crate's source files name there by hand, with a SOURCE.txt saying where it is
from. CI fails while a list is out of date.

The installers, the WASM module and every archive carry LICENSE,
COMMERCIAL-LICENSE.md, THIRD-PARTY-NOTICES.md and OFL.txt as well;
`scripts/verify-release.mjs` checks the archives and packages before a
release is published.

## Signing

macOS binaries and the app are not signed or notarized (the app has an
ad-hoc signature, so it runs on Apple silicon), so Gatekeeper blocks a
download until the user allows it; docs/desktop.md tells users how. Homebrew
does not quarantine formula downloads, so `brew install` is the recommended
route for the command line on macOS. Windows files are not Authenticode
signed either; SmartScreen may warn the first time.

## Each release

1. Update `version` in `package.json`, `VERSION` in `src/index.ts`,
   `version` and the `@mylasertools/kerfscript` dependency in
   `alias/package.json`, and `version` in `desktop/src-tauri/Cargo.toml`
   (`npm version <version> --no-git-tag-version` does the first and the
   lock file). Give the CHANGELOG section a date, and add the release to
   `packaging/flatpak/com.mylasertools.KerfScript.metainfo.xml`. The workflow
   refuses a tag that does not match `package.json`.
2. `npm run check`, then commit and push.
3. `git tag v<version> && git push origin v<version>`. The workflow builds
   everything, pushes Docker images and the snap, and drafts a GitHub release
   with the CHANGELOG section as notes.
4. Check the draft's files, then publish it. Package manager manifests point
   at its download URLs, so publish before submitting them.
5. `npm publish` (runs the checks again through `prepack`), then
   `npm publish` in `alias/` for the `kerfscript` package name. The alias
   depends on the exact version just published, so it goes second.
6. Download the `manifests` artifact from the workflow run and submit:
   - `homebrew/kerfscript.rb` → `homebrew-tap/Formula/kerfscript.rb`
   - `scoop/kerfscript.json` → `scoop-bucket/bucket/kerfscript.json`
   - `winget/manifests/...` (two packages) → a pull request to
     microsoft/winget-pkgs (`wingetcreate submit <folder>`, or copy the
     folders in a fork)
   - `chocolatey/<id>/` → `choco pack` then `choco push` in each folder
   - `aur/<pkgname>/PKGBUILD` and `.SRCINFO` → commit and push to each AUR
     repository
   - `flathub/` → the Flathub repository (see above)
   - `macports/Portfile` → a pull request to macports-ports
7. Deploy the website: `npm --prefix site run deploy`.

## Building release files locally

```sh
npm run build
npm run wasm                            # needs Javy; set JAVY if not on PATH
node scripts/release.mjs --host         # this platform only; needs Deno
node scripts/release.mjs                # all platforms (Deno cross-compiles)
```

`.deb` and `.rpm` packages of the command line need
[nfpm](https://nfpm.goreleaser.com) and `--linux-packages`.

The desktop app for this platform needs Rust and, on Linux, the WebKitGTK
packages listed in the workflow:

```sh
npm --prefix site ci && npm --prefix site run build
cd desktop
npm ci
npm run dev                             # run it with live reload of src-tauri
npm run build                           # installers in src-tauri/target/release/bundle
node scripts/collect.mjs                # copy them into release/
```

Then `node scripts/checksums.mjs` and `node scripts/manifests.mjs`.
