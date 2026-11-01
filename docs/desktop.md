# Desktop app

The KerfScript app is the [playground](https://kerfscript.mylasertools.com/playground/)
on your computer: the same editor, settings and preview, with your designs
saved as `.kerf` files. It works offline.

## Install

Download the app for your system from the
[releases](https://github.com/mylasertools/kerfscript/releases):

| System  | File                                                                         |
| ------- | ---------------------------------------------------------------------------- |
| Windows | `kerfscript-desktop-<version>-windows-x64-setup.exe`, or the `.msi`          |
| macOS   | `kerfscript-desktop-<version>-macos-universal.dmg` (Apple silicon and Intel) |
| Linux   | `.AppImage`, `.deb` or `.rpm`, for x64 or arm64                              |

Package manager listings (winget, Chocolatey, Flathub and the AUR) follow as
each one is approved.

The app is not signed with an Apple or Microsoft certificate yet:

- **macOS** says the app cannot be checked for malicious software. Open it
  once with right click → **Open**, or run
  `xattr -d com.apple.quarantine /Applications/KerfScript.app`.
- **Windows** SmartScreen may say it protected your PC. Choose
  **More info** → **Run anyway**.

## Files

| Action                | Keys                                          |
| --------------------- | --------------------------------------------- |
| Open a `.kerf` file   | Ctrl+O (⌘O on a Mac), or the **Open…** button |
| Save                  | Ctrl+S                                        |
| Save under a new name | Ctrl+Shift+S, or **Save as…**                 |

Double-click a `.kerf` file to open it in the app. The title bar shows the
file name, or Untitled, and a dot when there are unsaved changes. The app asks
before it closes, or opens another design or an example over them, also for a
design you have not saved yet. A design can be up to 1,000,000 characters
long, the same as in the playground. Saving writes the whole file before it
replaces the old one, so a full disk or a crash cannot leave half a design.

SVG, DXF and sheet ZIP exports open a save dialog in the design's folder.
On Linux, a name typed without `.kerf`, `.svg`, `.dxf` or `.zip` gets it, and
the app asks before replacing a file of that name.

## LightBurn

**Open in LightBurn** sends the cut file straight to
[LightBurn](https://lightburnsoftware.com) 2.2 or later, through LightBurn's
[REST API](https://github.com/LightBurnSoftware/LightBurn-REST). With several
sheets, each sheet in the cut files list has its own **LightBurn** link.

LightBurn has to be open on the same computer. The first time, LightBurn
asks whether to allow KerfScript; choose **Allow** within 30 seconds. The
window may open behind KerfScript. KerfScript asks only to send files: it
cannot read your projects, change cut settings or start the laser.

The file opens as a new LightBurn project, as if you had used File → Open,
and LightBurn asks first if your current project has unsaved changes. Check
the layers and cut settings in LightBurn before you run the job.

To stop KerfScript sending files, remove it in LightBurn under
Settings → Extensions → Manage API Authorizations.

LightBurn is a trademark of LightBurn Software, Inc. KerfScript is not made,
endorsed or certified by LightBurn Software.

## Libraries

`use <path>` and `include <path>` find files in the open design's folder and
the folders below it: with the design at `projects/box.kerf`,
`use <lib/tabs>` reads `projects/lib/tabs.kerf`. Unlike the
[command line](cli.md), the app reads only `.kerf` files, and not from folders
above the design's, such as `use <../shared/tabs>`; keep them next to the
design or in a folder below it. That way a design you download cannot read
other files on your computer. Standard library paths such as `use <kerf/box>` work
everywhere. A design that has not been saved yet can only use the standard
library.

Libraries installed with `kerf install` work too: `use <feet/feet>` reads
`kerf_libraries/feet/feet.kerf` in the design's project, the nearest folder
at or above the design's with a `kerf.json`. See
[Shared libraries](shared-libraries.md).

## Fonts

`text()` uses Atkinson Hyperlegible, as in the playground. The app does not
read fonts installed on your system yet; use the [command line](cli.md) with
`--font` for other fonts.

## About and licences

**About** shows the app's version, a link to its source code, and the
licences of KerfScript and of everything built into the app.

## Sharing

**Copy web link** copies a link that opens your code in the playground on the
website, so people without the app can see it.
