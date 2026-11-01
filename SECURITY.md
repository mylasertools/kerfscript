# Security

KerfScript runs programs that other people wrote: in the playground, in
apps like MyLaserTools, and from the command line. A program must not be able
to read files, reach the network, or keep running after its limits.

## Reporting a problem

Email **hi@mylasertools.com** with a description and, if you can, a
`.kerf` file that shows it. Please do not open a public issue for security
problems.

We reply within a week, keep you informed while we fix it, and credit you in
the changelog if you would like.

## What counts

- A program that reads files, fetches URLs or reaches anything outside the
  `resolve` function a host gives it.
- `kerf install` writing outside `kerf_libraries/`, or installing files
  that do not match `kerf.lock`.
- A program that escapes the step, loop or recursion limits, or hangs or
  exhausts memory in a way a host cannot stop.
- Output (SVG, DXF, JSON) that can carry script or markup into a page that
  shows it.

Wrong geometry is a bug, not a security problem, unless it can be triggered
on purpose to harm the person cutting the file. Report it as an issue.

## Supported versions

Fixes go into the latest release. Before 1.0 there are no back-ported fixes
to older versions.
