# Settings

Expose dimensions, text and other choices as controls beside your design.
Comments define sliders and menus, while the variable values provide their
defaults. KerfScript uses OpenSCAD's customizer comment format.

```kerf
/* [Size] */
// Outer width
width = 120; // [40:5:400]
// Outer depth
depth = 80; // [200]

/* [Style] */
shape = "round"; // [round:Round, square:Square]
holes = 3; // [2, 3, 4]
lid = true;
label = "Tools";

/* [Hidden] */
wall = 3;

rect([width, depth]);
```

This example defines several control types. The rectangle uses `width`
and `depth`; the other variables illustrate settings you can use elsewhere
in a design.

## What becomes a setting

A variable declared at the top level becomes a setting when its value is a
number, string, boolean or list of numbers. Variables defined by expressions,
such as `half_width = width / 2`, are calculated from the other values and
do not get their own controls.

## Comments

Put a range or choice list after the assignment:

| Comment after the value           | Control                              |
| --------------------------------- | ------------------------------------ |
| `// [40:5:400]`                   | Slider from 40 to 400, in steps of 5 |
| `// [40:400]`                     | Slider from 40 to 400                |
| `// [200]`                        | Number with an upper limit of 200    |
| `// [2, 3, 4]`                    | Choice of 2, 3 or 4                  |
| `// [round:Round, square:Square]` | Menu with a label for each value     |
| No comment on a boolean           | Checkbox                             |
| No comment on a string            | Text field                           |

`/* [Size] */` starts a group named Size. `/* [Hidden] */` hides the
settings that follow it, until another group begins.

A `//` comment immediately above a variable supplies its caption. Keep the
file's introductory comment separate with a blank line so it does not
become the first setting's caption.

## The setting that moves the model

A model with moving parts usually has one number that drives them: a crank
angle, a lid's opening, the time of day. Mark it with `drive` after its
range:

```kerf
crank = 0; // [0:5:360] drive

part("Wheel", at = [0, 0, 0]) circle(d = 60);
part("Crank", at = [0, 0, 3], rotate = [0, 0, crank]) rect([30, 8], center = true);
```

The playground gives it a Play button that steps it round its range, and
`kerf check model.kerf --drive` builds the model at every step and reports
any position that warns (parts colliding, a slot that misses), as
`--sweep crank=0:5:360` would. `kerf params` lists it with `"drive": true`.

## Changing settings without editing the file

The CLI accepts values with `-D` or a JSON file with `--params`:

```sh
kerf render box.kerf -D width=200
kerf render box.kerf --params box-settings.json
kerf params box.kerf
```

`box-settings.json` can contain `{"width": 200, "lid": false}`.
Use `kerf params` to list a design's settings as JSON.

String values need quotes, for example `-D 'label="Oak"'` for a design
with a `label` setting. In JavaScript, pass values through `render()`'s
`params` option and read the settings with `parameters()`. See the
[JavaScript API](javascript.md).
