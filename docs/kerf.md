# Kerf

Kerf is the width of material removed by a laser cut. Allowing for it helps
parts finish at the intended size and joints fit together. Measure it for
the material and cutting settings you use.

## Setting it

Set `$kerf` in millimetres:

```kerf
$kerf = 0.15;
```

With this value, KerfScript moves an outer cut path outward by 0.075 mm and
a hole's path inward by the same amount. The offset compensates for material
removed on either side of the beam.

Only closed cut outlines receive the offset. Engraving, scoring and open
cuts such as living hinges keep their original paths.

To use a value for a particular material, set it inside `material()`:

```kerf
material(thickness = 4, kerf = 0.12, name = "birch") {
  part("side", qty = 2) finger_rect([100, 60], "out");
}
```

On the command line, `--kerf 0.1` overrides the value for every part. Apply
kerf compensation in either KerfScript or your laser software, once per job.

## Measuring your kerf

1. Cut the [calibration square](../examples/calibration-square.kerf) with
   `$kerf = 0`. Leave any offset in your laser software at zero too.
2. Measure the square across the middle with calipers.
3. Subtract that measurement from 100 mm. A square measuring 99.82 mm gives
   a kerf of 0.18 mm.
4. Set `$kerf = 0.18` and cut another sample. Check the outside against
   100 mm and the hole against 20 mm, then adjust the value if needed.

Repeat the measurement when the material or cutting settings change. Thick
material can have a different cut width at its top and bottom faces.

The [kerf gauge](library.md#calibration) in the calibration library
measures it another way, without calipers on a square: it cuts strips in a
frame with single lines. Push the strips to one side and divide the gap
they leave by the number of strips plus one.

## Checking a fit

After calibrating kerf, measure your sheet's thickness and set `$thickness`
to that measurement. The nominal thickness on a material label can differ
from the sheet itself.

The [kerf and fit test](../examples/kerf-test.kerf) cuts slots slightly
narrower and wider than `$thickness`. Try a scrap from the same sheet in each
slot. A positive label means a wider slot; a negative label means a narrower
one. Choose the fit you need and use the result to refine your dimensions.

Both kerf and sheet thickness affect the fit. A tight or loose slot alone
does not tell you which value needs adjusting.

For finger joints, `joint_test()` in the calibration library cuts a pair
of pieces for each of a few kerf values; the pair that holds without glue
has the kerf to use. The [calibration set](../examples/calibration-set.kerf)
cuts the gauge, the slots and the joint pairs together.

## Limits

- Compensation can close a hole or notch narrower than the kerf. KerfScript
  warns when a hole disappears.
- Narrow bridges and fingers may be fragile or char during cutting even
  when their dimensions are correct. Test small features in your material.
- Compensation adjusts the 2D outline. It does not remove taper from the
  cut face in thick material.
