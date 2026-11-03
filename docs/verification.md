# Assembly verification

`kerf verify` checks declared requirements against the evaluated geometry of a
design: fit, retention, installation, support, stability and operating motion for
rigid sheet parts and cylindrical/box hardware. Each claim names its scope and
assumptions. Checks measure the evaluated geometry independently of the formulas
that generated it.

```sh
kerf verify model.kerf --spec model.verify.json -o report.json
```

The specification is JSON data. The command never imports or executes a sibling
JavaScript file. Supported options are `--spec`, `-o`/`--out` and `--font`.
Parameters belong in each specification configuration. `kerf check --sweep`
remains available for ordinary warning/parameter sweeps.

## Reading the result

The command returns `{ "kind": "report", "report": ... }`, or `invalid-spec` /
`invalid-snapshot` with input issues. Each claim has a status, diagnostic code,
configuration, implicated part/hardware references, measurements, assumptions and
coverage. Exit codes are:

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Every required claim passed within its reported scope                           |
| 1    | A required claim or required design configuration failed                        |
| 2    | A required claim is unverified, input is invalid, or a report cannot be written |

A `pass` applies to the listed requirements and configurations. Reports also list
uncovered capabilities; a passing fit alone does not establish retention or motion.
`strength` currently returns `unverified`. Material capacity, adhesive strength,
friction, wear, torque, actual gear/cam driving contact and flexible-body dynamics
need separate evidence. Unsupported cases and exhausted checking budgets remain
unverified.

Missing cutting metadata, open cutting lines affecting rigid material, bends,
legacy `echo("hardware", ...)`, compiler warnings, exhausted budgets and numerical
boundary cases cannot produce a required geometric pass. Cases refused by the
renderer remain failed required configurations; they are not dropped from coverage.

## A glue contact specification

This example checks a patch's bottom face against a host's top face. Measurements
use millimetres and square millimetres, after all model scaling and placement.

```json
{
  "schemaVersion": 1,
  "model": "Mounted decoration",
  "configurations": [{ "id": "default" }],
  "claims": [
    {
      "id": "decoration-contact",
      "kind": "glue-contact",
      "a": { "part": "host" },
      "b": { "part": "patch" },
      "faceA": "top",
      "faceB": "bottom",
      "minimumArea": 110
    }
  ]
}
```

Parts bind by unique name and copy, with `copy` defaulting to 1. Hardware binds by
unique native `hardware(..., label = "shaft")` labels. A missing or ambiguous
reference is an input error. Array positions cannot identify hardware. Claim IDs
starting with `$` are reserved for verifier diagnostics.

Configurations may contain `params`. Claims may restrict their `configurations`
to a subset, and may set `required: false` for informational checks. At least one
claim must be required. Optional checks never hide a required failure.

## Supported contracts

| Kind                  | Fields in addition to `id` and `kind`                                                                     | What is measured                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `glue-contact`        | `a`, `b`, `faceA`, `faceB`, `minimumArea`                                                                 | Opposing coplanar nominal faces and overlap after subtracting holes                                                                       |
| `tab-slot`            | `tab`, `receiver`, `region: [x0,y0,x1,y1]`, `clearance: [min,max]`, `flushTolerance`, `minimumLigament`   | Rectangular tongue, closed rectangular slot, both directional total clearances, side gaps, through engagement and remaining edge material |
| `captured-shaft`      | `shaft`, two `bearings`, `stack`, two `stops`, `clearance`, `endplay`, `minimumOverlap`, `maximumStopGap` | Coaxial bore fit, bearing engagement, ordered axial stack, endplay and positive end capture                                               |
| `material-assignment` | No extra fields                                                                                           | A stock profile exists for every sheet part and contains its design thickness                                                             |
| `cut-invariant`       | At least two configurations                                                                               | Actual local cut regions/lines, material, thickness, compensation and inventory stay fixed across the declared poses                      |
| `rigid-clearance`     | `minimumGap`, optional `bodies`                                                                           | Clearance between actual extruded cut regions and native hardware; defaults to the whole inventory                                        |
| `retention`           | `roots`, `links`, optional `removable`                                                                    | Every permanent component has checked attachment geometry and installed fastening leading to a supported root                             |
| `assembly-access`     | `initial`, `steps`, `minimumGap`, optional `scope`, `maxIntervals`                                        | Continuous straight insertion and optional tool paths against already installed bodies                                                    |
| `assembly-support`    | `plan`, `retention`, optional `holds`                                                                     | Previously installed components remain retained or explicitly held at every step; final temporary holds are released                      |
| `stability`           | `supports`, `loads`, `ground`, `gravity`, `minimumMargin`, optional `retention`                           | The declared gravity line lies within the actual ground contact support polygon                                                           |
| `joint-constraints`   | `bodies`, `roots`, `joints`, `expectedDof`                                                                | Fixed/revolute/prismatic/gear pose constraints and constraint-Jacobian mobility at the declared configurations                            |
| `motion-clearance`    | `from`, `to`, `moving`, `minimumGap`, optional `constraints`, `maxIntervals`                              | Continuous clearance for explicit rigid translations or rotations about fixed world axes                                                  |

`tab-slot.region` selects the tongue in the tab's own coordinates. It cannot be
an arbitrary crop out of a larger plate: at most one edge may continue into the
parent, along the insertion direction. Shapes outside this limited contract remain
unverified. A successful fit does not establish fastening or retention.

`captured-shaft` supports cylindrical hardware and circular polygon bores whose
panel normals follow the shaft direction. `stack` lists the spacers/rotors between
the two bearing faces. Each stop is a hardware reference with an `attachment`:

```json
{
  "body": { "hardware": "nut" },
  "attachment": {
    "kind": "threaded",
    "thread": { "hardware": "usable thread envelope" },
    "minimumEngagement": 3,
    "secured": true
  }
}
```

The other supported attachment is `{ "kind": "integral" }`, for a head at the
shaft end. `{ "kind": "unknown" }` leaves fastening unverified. Integral purchase
construction and installation of matching threaded hardware are explicit
assumptions. A rendered collar alone does not prove fastening. Hardware dimensions
are nominal in this implementation; thread capacity, clamp force, resistance to
loosening remain separate properties. Check the rotor's full swept envelope with
`motion-clearance`.

Working synthetic examples are in `test/fixtures/verification/`, including a
captured-shaft specification, a fully contracted glue coupon, two material redesigns
and a slider path. These are geometric test fixtures, not rated fastening designs.

## Retention and installation

A retention root identifies a body whose support is assumed. Each link references
a passed geometric contract and states the fastening actually installed:

```json
{
  "id": "attached",
  "kind": "retention",
  "roots": [{ "part": "host" }],
  "links": [{ "claim": "decoration-contact", "fastening": "glued", "installed": true }]
}
```

`glued` means a cured fixed adhesive bond is assumed at measured glue contact.
`captured` uses a passed shaft-capture contract. A tab fitting a slot does not prove
a lock: labelling it `locked` leaves retention unverified. Every permanent native
part and hardware item must reach a root. Explicit `removable` items are excluded
from this claim and still need their own support case.

`assembly-access.initial` contains zero or one already supported body. Every other
scoped body must occur exactly once in `steps`. Each step has `id`, `part`,
`from: [dx,dy,dz]` (the starting displacement from its final pose) and `held: true`
for the operator or fixture holding the incoming part. The checker moves it in a
straight line to its final position, testing all already installed bodies. A gap
of zero allows nonpenetrating terminal contact; no whole body collision exemptions
are applied. Rotation/flex insertion and automatic assembly planning are unsupported.

Optional `tool: {from, to, diameter, travel}` describes a cylindrical tool at the
working position and its starting displacement `travel`. Its approach is checked
after the incoming body is installed, including against that body. The envelope
must describe the tool's free space accurately.

`assembly-support.plan` references the access claim, and `retention` references the
final retention claim. Each installation step can name geometric contract IDs in
`fasten`; those connections become effective only after all their bodies are
installed. Optional `holds: [{step, bodies}]` declare temporary support at each
step boundary. Incoming `held: true` covers insertion only. Earlier loose bodies
must also be held until fastening, and the final assembly must stand without
temporary holds. Adhesive installation/cure timing remains an explicit assumption.

For `stability`, list a positive `mass` for every body in `loads`, with optional
local `center: [x,y,z]`. Otherwise the checker uses a uniform sheet or hardware
centroid, subtracting holes. List the bodies touching the horizontal `ground`
plane in `supports`; `gravity` is a downward world vector. Multiple loads require
a passed retention claim covering every load. The checker rejects ground penetration
and measures the gravity-line margin within the convex hull of actual contacts.
Sliding resistance, impact and structural capacity are separate properties.

## Mechanisms and continuous motion

`joint-constraints` declares ideal connections between body references `a` and `b`:

| Joint       | Additional fields                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `fixed`     | No extra fields; relative transform must match the first declared configuration                                          |
| `revolute`  | Local `anchorA`, `anchorB`, `axisA`, `axisB`; optional `range: [min,max]` in degrees relative to the first configuration |
| `prismatic` | Local `axisA`, `travel: [min,max]` relative to the first configuration                                                   |
| `gear`      | Local `axisA`, `axisB`, positive `ratio`; angles satisfy `angleB + ratio * angleA = 0`                                   |

Roots stay fixed. The constraint Jacobian establishes the number of independent
instantaneous degrees of freedom for at most 64 scoped bodies. Unintended free
bodies, separated anchors, wrong guide motion and conflicting mobility fail.
Redundant constraint rows are reported; singular ranks remain unverified. Gear
pose deltas use the principal quarter-turn branch; add intermediate configurations
for larger pose changes. The ideal joints do not establish physical bearings,
retainers or driving tooth contact.

Native `glue` and `stack` relationships add fixed constraints after contact checks.
Installed measured adhesive links also add fixed constraints. A glued decoration
cannot become a rotor simply because an animation turns it.

Motion uses one analytic world-space trajectory per moving body. Every unlisted
body stays fixed. For example:

```json
{
  "id": "turn",
  "kind": "motion-clearance",
  "from": "closed",
  "to": "open",
  "constraints": "hinge",
  "moving": [
    {
      "body": { "part": "arm" },
      "trajectory": { "kind": "rotate", "origin": [0, 0, 0], "axis": [0, 0, 1], "angle": 45 }
    }
  ],
  "minimumGap": 0.2
}
```

The other trajectory is `{ "kind": "translate", "by": [dx,dy,dz] }`. All controls
share phase 0 to 1. The destination must match the rendered endpoint, cut geometry
and inventory must stay fixed, and installed bonds must move together. With
`constraints`, both endpoints must pass that joint claim and the analytic path must
obey its supported joint tree, travel stops and gear rates. General closed linkages
and composed moving-axis constraints remain unverified.

Continuous clearance uses convex material decomposition preserving holes, exact
box envelopes, and inner/outer cylindrical bounds. Separating-axis bounds and
adaptive interval subdivision include all intermediate poses through a conservative
displacement bound. Approximation boundaries, unresolved contacts and exhausted
budgets return `unverified`. The report records a failing phase when available.
This proves the authored analytic path; arbitrary parameter expressions between
rendered poses do not acquire a continuous guarantee. Add a separate static
clearance claim to cover pairs that stay fixed throughout the path.

## Material profiles and frozen cuts

Optional `materials` map the evaluated material names to measured stock profiles:

```json
{
  "plywood": {
    "thickness": [2.9, 3.1],
    "kerf": [0.12, 0.18],
    "edgeError": 0.02,
    "lot": "measured sheet A"
  }
}
```

`thickness` and `kerf` are actual manufacturing intervals. `edgeError` is an
additional nonnegative uncertainty per cut edge. The snapshot records the design's
compensation kerf separately. Profiles do not redraw a slot for each possible
actual thickness. Larger actual kerf enlarges an internal opening and shrinks an
external tongue relative to its compensated design.

Tab/slot checks bound dimensional fit at the captured placements. The receiving
panel's actual maximum thickness also controls shoulder interference and through
engagement. Shaft stack checks bound endplay with fixed bearing locations; varying
bearing thickness changes retainer seating and currently makes capture unverified.
Profiles do not provide general tolerance propagation through an arbitrary mechanism.
Glue-contact claims remain nominal geometric claims even when profiles are present.

A redesign for a different stock size is a separate configuration, producing a new
set of cuts. Global `materials` profiles apply by default. Each configuration may
override them with its own `materials` map, so 3 mm and 4 mm redesigns can have
different measured lots. Choose supported configurations deliberately; finite
configurations and pose samples do not prove a continuous parameter range. Apply
`cut-invariant` only to operating poses within one manufactured design, not across
intentional stock redesigns. Continuous clearance and static stability currently
use nominal geometry; profile intervals apply to the supported fit/stack checks.

## JavaScript API

```js
import {
  render,
  snapshotFromRender,
  verify,
  verificationIsCurrent,
} from '@mylasertools/kerfscript';

const rendered = render(source, { params, analysis: true });
const snapshot = snapshotFromRender(rendered, {
  configuration: 'default',
  params,
  provenance: {
    sourceHash,
    engineHash, // SHA-256 of exact source and loaded runtime artifact
    dependencies: {}, // logical source names -> SHA-256 of resolved bytes
    fonts: {}, // font names -> SHA-256 of actual font bytes
  },
});
const result = verify(specification, [snapshot]);
if (result.kind === 'report') {
  const current = verificationIsCurrent(result.report, specification, [snapshot]);
}
```

The application supplies actual fingerprints; the portable core performs no file
access or hashing. Missing provenance makes the overall result unverified. The CLI
records source, loaded engine artifact, resolved external dependencies and fonts
itself. Reports retain exact parameters and the resolved specification, so a cached
result can be checked against changed inputs. A package version alone cannot identify
an edited checkout. Before reusing an archived report, capture current fingerprints
and call `verificationIsCurrent(report, specification, snapshots)`. Source, runtime,
dependency, font, parameter, render-setting or requirement/profile changes make it
stale. This checks supplied fingerprints; applications must hash actual input bytes.

`analysis: true` captures nominal cut regions and cut lines before toolpath kerf
compensation. It is opt-in and does not affect cutting output. The snapshot copies
and freezes the geometry; later mutations of a render result cannot change it.
Without analysis, unavailable cut lines remain `null`, distinct from a known empty
list. Verification never reconstructs authoritative cuts from the viewer's marks.

`verify(spec, snapshots, limits)` accepts `maxPoints` (default 200000), `maxClaims`
(1000), `maxConfigurations` (100) and `maxOperations` (2000000). Motion/access claims
may set `maxIntervals` from 1 to 10000 (default 1000). The command also bounds cases
before rendering.
The point budget includes the cylindrical/box hardware envelopes used by the checker.
Coordinate limits are 1000000 mm in local cut geometry and 10000000 mm for placement
translations. Linear acceptance predicates use a 0.001 mm uncertainty band; glue
area uncertainty scales with boundary length. Near-boundary results are unverified.
Zero-gap nonpenetrating terminal contact is supported for straight insertions and
fixed relative envelopes. Geometry invariance compares normalized exact coordinates, not bounding dimensions
or rounded cut lengths. The verification API is available in the JavaScript build;
the WASI JSON command surface has not yet gained a `verify` operation.

## Previewing findings

The site's assembly viewer exposes `view.verification(report, configuration)`.
It lists failures/unverified claims and highlights implicated part copies and
hardware. `createAssemblyView(element, {onVerificationSelect(finding) { ... }})`
lets the host select a configuration or a reported failing `measurements.phase`.
Installation findings also identify `assemblyStep`.
Every `show()` clears previous diagnostics; the host should check report freshness
before attaching a report to new inputs. The viewer does not display a global
certification badge.

`poseAssembly(rendered, moving, phase)` returns a render result with the exact
analytic motion applied to its assembly and hardware. It preserves the original
render result and cut files, so a diagnostic preview can show the same path that
was checked. It changes the preview pose only; rerender and recapture the source
to verify a new manufacturing configuration.

Run the public paired fixtures after building:

```sh
npm run build
npm run verify:fixtures
node scripts/verify-models.mjs path/to/contracts path/to/reports
```
