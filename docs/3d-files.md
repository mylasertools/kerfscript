# 3D files

KerfScript writes a model in 3D as well as the files you cut: a GLB to look
at or render, a 3MF to 3D print in colour, or an STL. Each part becomes a
solid as thick as its sheet, and what is engraved or scored on it becomes a
thin coloured layer on its face.

```sh
kerf render box.kerf -o box.glb          # the assembled model, to view or render
kerf render sign.kerf -o sign.3mf --print # laid out to print in colour
kerf render coaster.kerf -o coaster.stl  # one mesh
```

The format follows the file's extension.

## What is in the model

- **Parts** are solids `$thickness` thick, where `part(at, rotate)` and
  `place()` put them. A part that bends on a living hinge is bent, its
  hinge's slits cut through it. Each copy of a part is a solid of its own.
- **Engraving and scoring** are separate bodies on the part's face, in their
  layer's colour, standing 0.1 mm off it (`--mark-height` sets how far).
  Score lines become strips 0.3 mm wide. Each overlaps the face by 0.01 mm,
  so the two never share a face. Marks for the back face (`side = "back"`)
  are on the back.
- **Hardware** from `hardware()` becomes rods, bars and balls in its colour.

A program that places no parts is laid out flat, as `--flat` does.

## Assembled or flat

By default the parts are where the assembly puts them. With `--flat` they
lie side by side on the bed, front face up, which is how a flat design
prints: a coaster, a sign, an ornament, a bookmark. Laid flat, marks for
the back face and hardware are left out, since nothing can stand under a
part on the bed.

## Laid out to print

`--print` lays the model out to 3D print in colour. Each part is one
object with everything glued on it (`glue =` and the layers of a
`stack`), each layer where the assembly puts it and in its own colour, so
a standee of three glued layers prints as one piece, not three to glue.
An upright part lies down on its back face, or on the lowest layer glued
under it. Marks stand 0.6 mm high, a raised colour of their own, and only
where they show: not under a layer glued over them or on the bed.

```sh
kerf render snow-scene.kerf -o snow-scene.3mf --print
```

Each layer takes its colour from its material: a colour in the name
(`material = "green"`, `"#cc3333 card"`) or a wood or sheet it names. A
stack with a part bent on a living hinge is laid out part by part, flat.

## Formats

| File   | Units               | Holds                                                                                                                                                                 |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.glb` | metres, y up (glTF) | a node and mesh for each body, with materials named after the sheet material or layer; each node's `extras` give its `kind` (part, mark, hardware), `part` and `copy` |
| `.3mf` | millimetres, z up   | each part one object, with its engraving and scoring as coloured parts of it, so a slicer prints each in its own colour                                               |
| `.stl` | millimetres, z up   | every body in one mesh, without colours                                                                                                                               |

A GLB of the assembled model carries its lights (tealights, LEDs, bulbs
and `light()`) as point lights (`KHR_lights_punctual`), each with its
colour and its intensity in candela; a strip of LEDs is several along it.
Translucent materials (vellum, paper, frosted acrylic) are partly
transparent and carry `KHR_materials_transmission`. Each light's node has
`extras` with `kind: "light"`, its `source`,
`lumens` and `flicker`, which is true for a flame. Glowing bodies, an LED
or a flame, are emissive. Blender and most glTF viewers light the scene
with them.

Every part and mark is a closed solid: each edge is shared by exactly two
triangles, facing out. A bent part is the exception: it is built from bands
across its hinge, which meet inside it.

## From JavaScript

```js
import { render, toModel } from '@mylasertools/kerfscript';

const result = render(source);
const glb = toModel(result, 'glb'); // a Uint8Array
const print = toModel(result, '3mf', { layout: 'print', markHeight: 0.6 });
```

`meshBodies(result, options)` gives the bodies themselves (positions and
triangles in millimetres) for a viewer of your own, and `toGlb()`, `to3mf()`
and `toStl()` write them. The options are `layout` (`"assembled"`,
`"flat"` or `"print"`), `markHeight`, `lineWidth`, `slitWidth`, `hardware`
and `gap`.
See the [JavaScript API](javascript.md).
