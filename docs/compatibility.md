# Laser software

Export SVG or DXF from KerfScript, then set up the cutting job in your laser
software. Check the imported size and layers before assigning power, speed
and operation order.

## What is in the files

**SVG**

- Millimetre dimensions with a matching `viewBox`.
- Named layer groups for engraving, scoring, cutting and any custom layers.
- Red cut paths, blue score paths and black filled engraving.
- Inner cut paths before outer outlines in the file.

**DXF**

- R12 polylines with millimetre units.
- Named layers such as `CUT`, `SCORE` and `ENGRAVE`.
- Engraving as outlines. Set the engraving layer to fill in your laser software.
- One sheet per file. Use the CLI's `--split` option for several sheets.

## Checked

| Program  | Version | SVG    | DXF    | Checks                           |
| -------- | ------- | ------ | ------ | -------------------------------- |
| Inkscape | 1.4.2   | Passed | Passed | Dimensions, layers and SVG fills |

Six reference models passed these import checks on 28 October 2026.
Drawing dimensions matched within 0.02 mm, including kerf compensation.
These results cover file imports; they do not establish a fit for a
particular machine or material.

## Not checked yet

LightBurn, xTool Studio, xTool Creative Space, RDWorks and LaserGRBL have
not yet been verified with the reference models. Import handling can differ
between programs, especially for units, layer colours and fills.

## Checklist for a new program

Download the calibration square and box from the
[models](https://kerfscript.mylasertools.com/models/) and check their imports:

1. **Size:** the calibration square's cut path is 100.15 mm wide with
   `$kerf = 0.15`, allowing for a finished 100 mm square. If the imported
   size differs, check the unit and DPI settings.
2. **Layers:** cutting, scoring and engraving can be assigned separate operations.
3. **Fill:** engraved text has filled letters. For DXF, select fill in the
   engraving layer's settings.
4. **Holes:** cut holes remain open and contain no engraving.
5. **Order:** the job preview cuts inner paths before outer outlines.
6. **Parts:** the box contains all six panels without overlaps.

## What the file does not decide

Set power, speed, passes and focus for your machine and material. Check the
job preview for engraving before cutting and holes before outer outlines;
laser software can reorder the paths in a file.

For multiple sheets, use a separate file and matching material settings for
each sheet. If KerfScript has already applied kerf compensation, leave the
laser software's kerf offset at zero. Test the job on scrap before cutting
the final material.
