// KerfScript's 2D shapes for OpenSCAD.
// Copyright (c) 2026 MyLaserTools. AGPL-3.0-only or MyLaserTools commercial licence.
//
// With this file included, the 2D part of a KerfScript design runs in
// OpenSCAD as it is: rect(), ellipse(), regular_polygon(), star(), line(),
// polyline(), arc(), stroke(), outline(), path() and lerp() work as they do
// in KerfScript, and cut(), score(), engrave(), guide(), layer(), part(),
// place(), step(), material() and hardware() pass their shapes through.
//
//   include <kerfscript.scad>
//
// OpenSCAD has areas only, so a KerfScript line (a score line, an arc, a
// polyline) is drawn as a strip $line_width wide with round ends;
// stroke(w) sets that width for its children, as it does in KerfScript.
// Set $kerf_3d = true to see the parts extruded to $thickness and placed
// where part(at, rotate) puts them.

$thickness = 3;
$line_width = 0.2;
$kerf_3d = false;

// Segments in a full circle of radius r, as OpenSCAD counts them
function kerf_fragments(r) =
  $fn > 0 ? max(3, $fn) : max(5, ceil(min(360 / $fa, r * 2 * PI / $fs)));

// --- Values ---------------------------------------------------------------

// a at t = 0, b at t = 1, for numbers and vectors
function lerp(a, b, t) = a + (b - a) * t;
function clamp(x, lo, hi) = min(max(x, lo), hi);

// Lists and text, as KerfScript's built-in functions
function kerf_chars(s, from, to) = from >= to ? "" : chr([for (i = [from:to - 1]) ord(s[i])]);
function slice(value, start = 0, end) =
  let (n = len(value), e = is_undef(end) ? n : min(end, n), b = max(0, start))
  is_string(value) ? kerf_chars(value, b, e) : b >= e ? [] : [for (i = [b:e - 1]) value[i]];
function contains(value, item) =
  is_string(value)
    ? len(item) == 0 || (len(item) <= len(value) && len([for (i = [0:len(value) - len(item)]) if (kerf_chars(value, i, i + len(item)) == item) i]) > 0)
    : len([for (x = value) if (x == item) x]) > 0;
function sum(values) = len(values) == 0 ? 0 : [for (v = values) 1] * values;
function reverse(value) =
  is_string(value) ? kerf_chars_reversed(value) : [for (i = [len(value) - 1:-1:0]) if (len(value)) value[i]];
function kerf_chars_reversed(s) = len(s) == 0 ? "" : chr([for (i = [len(s) - 1:-1:0]) ord(s[i])]);
function fold(values, initial, fn, i = 0) =
  i >= len(values) ? initial : fold(values, fn(initial, values[i]), fn, i + 1);
function scan(values, initial, fn, i = 0, out = []) =
  i >= len(values) ? out : let (next = fn(initial, values[i])) scan(values, next, fn, i + 1, concat(out, [next]));
// Smallest first, by key when given; equal keys keep their order
function sort(values, key) =
  len(values) <= 1 ? values
  : let (
    k = is_undef(key) ? function(x) x : key,
    keyed = [for (i = [0:len(values) - 1]) [k(values[i]), i]],
    order = kerf_merge_sort(keyed)
  )
  [for (o = order) values[o[1]]];
function kerf_merge_sort(a) =
  len(a) <= 1 ? a
  : let (m = floor(len(a) / 2)) kerf_merge(kerf_merge_sort(slice(a, 0, m)), kerf_merge_sort(slice(a, m)));
function kerf_merge(a, b, i = 0, j = 0, out = []) =
  i >= len(a) ? concat(out, slice(b, j))
  : j >= len(b) ? concat(out, slice(a, i))
  : b[j][0] < a[i][0] ? kerf_merge(a, b, i, j + 1, concat(out, [b[j]]))
  : kerf_merge(a, b, i + 1, j, concat(out, [a[i]]));
function upper(text) =
  len(text) == 0 ? "" : chr([for (i = [0:len(text) - 1]) let (c = ord(text[i])) c >= 97 && c <= 122 ? c - 32 : c]);
function lower(text) =
  len(text) == 0 ? "" : chr([for (i = [0:len(text) - 1]) let (c = ord(text[i])) c >= 65 && c <= 90 ? c + 32 : c]);
function join(values, separator = "") =
  fold([for (i = [0:len(values) - 1]) if (len(values)) i], "", function(acc, i) str(acc, i > 0 ? separator : "", values[i]));
function split(text, separator = " ", from = 0, i = 0, out = []) =
  len(separator) == 0 ? [for (k = [0:len(text) - 1]) if (len(text)) text[k]]
  : i > len(text) - len(separator) ? concat(out, [kerf_chars(text, from, len(text))])
  : kerf_chars(text, i, i + len(separator)) == separator
    ? split(text, separator, i + len(separator), i + len(separator), concat(out, [kerf_chars(text, from, i)]))
  : split(text, separator, from, i + 1, out);

// --- Shapes ---------------------------------------------------------------

// A rectangle with its corner at the origin, or centred, its corners
// rounded to r
module rect(size = 1, center = false, r = 0) {
  s = is_list(size) ? size : [size, size];
  rr = min(r, s[0] / 2, s[1] / 2);
  translate(center ? -s / 2 : [0, 0])
    if (rr > 0) translate([rr, rr]) offset(r = rr) square([s[0] - 2 * rr, s[1] - 2 * rr]);
    else square(s);
}

// An ellipse with radii r = [rx, ry], or width and height d = [w, h]
module ellipse(r = 1, d) {
  rad = is_undef(d) ? (is_list(r) ? r : [r, r]) : (is_list(d) ? d / 2 : [d / 2, d / 2]);
  n = kerf_fragments(max(rad[0], rad[1]));
  polygon([for (i = [0:n - 1]) let (a = 360 * i / n) [rad[0] * cos(a), rad[1] * sin(a)]]);
}

// n corners r from the centre, the first on the x axis
module regular_polygon(n = 6, r = 10) {
  k = max(3, floor(n));
  polygon([for (i = [0:k - 1]) let (a = 360 * i / k) [r * cos(a), r * sin(a)]]);
}

// n points r from the centre, the first straight up, inner between them
module star(n = 5, r = 10, inner) {
  ri = is_undef(inner) ? r * 0.45 : inner;
  k = max(2, floor(n));
  polygon([for (i = [0:2 * k - 1]) let (a = 90 + 180 * i / k) (i % 2 ? ri : r) * [cos(a), sin(a)]]);
}

// A line through the points, as a strip $line_width wide with round ends
module kerf_strip(points, closed = false) {
  w = $line_width;
  n = len(points);
  if (n == 1) translate(points[0]) circle(d = w, $fn = max(8, kerf_fragments(w / 2)));
  for (i = [0:n - (closed ? 1 : 2)])
    if (n > 1)
      hull() {
        translate(points[i]) circle(d = w, $fn = max(8, kerf_fragments(w / 2)));
        translate(points[(i + 1) % n]) circle(d = w, $fn = max(8, kerf_fragments(w / 2)));
      }
}

// A line from one point to another; with a width, a strip that wide with
// square ends
module line(from = [0, 0], to = [10, 0], width) {
  if (is_undef(width)) kerf_strip([from, to]);
  else {
    d = to - from;
    l = norm(d);
    if (l > 0) {
      nrm = [-d[1], d[0]] / l * width / 2;
      polygon([from + nrm, from - nrm, to - nrm, to + nrm]);
    }
  }
}

// Lines through a list of points
module polyline(points, closed = false) kerf_strip(points, closed);

// An arc line round the origin from angle start to end
module arc(r = 10, start = 0, end = 90) {
  n = max(2, ceil(kerf_fragments(r) * abs(end - start) / 360));
  kerf_strip([for (i = [0:n]) let (a = start + (end - start) * i / n) r * [cos(a), sin(a)]]);
}

// Lines in the children as areas `width` wide
module stroke(width = 1) {
  $line_width = width;
  children();
}

// The children's areas as their outline lines
module outline() {
  w = $line_width;
  difference() {
    offset(r = w / 2) children();
    offset(delta = -w / 2) children();
  }
}

// Gaps narrower than 2 r closed
module close(r = 0.5) offset(r = -r) offset(r = r) children();

// --- SVG path data ----------------------------------------------------------

function kerf_is_digit(c) = c >= "0" && c <= "9";
function kerf_is_command(c) = len(search(c, "MmLlHhVvCcSsQqTtAaZz")) > 0;

function kerf_digits(s, i, v = 0, n = 0) =
  i < len(s) && kerf_is_digit(s[i]) ? kerf_digits(s, i + 1, v * 10 + ord(s[i]) - 48, n + 1) : [v, i, n];

// The number starting at i and the index after it
function kerf_number(s, i) =
  let (
    sg = s[i] == "-" ? -1 : 1,
    i1 = s[i] == "-" || s[i] == "+" ? i + 1 : i,
    ip = kerf_digits(s, i1),
    fr = ip[1] < len(s) && s[ip[1]] == "." ? kerf_digits(s, ip[1] + 1) : [0, ip[1], 0],
    j = fr[1],
    ex = j < len(s) && (s[j] == "e" || s[j] == "E") && j + 1 < len(s)
      && (kerf_is_digit(s[j + 1]) || ((s[j + 1] == "-" || s[j + 1] == "+") && j + 2 < len(s) && kerf_is_digit(s[j + 2])))
      ? let (es = s[j + 1] == "-" ? -1 : 1, k = s[j + 1] == "-" || s[j + 1] == "+" ? j + 2 : j + 1, ed = kerf_digits(s, k)) [es * ed[0], ed[1]]
      : [0, j]
  )
  [sg * (ip[0] + fr[0] / pow(10, fr[2])) * pow(10, ex[0]), ex[1]];

// The path data as a list of command letters and numbers
function kerf_tokens(s, i = 0, out = []) =
  i >= len(s) ? out
  : kerf_is_command(s[i]) ? kerf_tokens(s, i + 1, concat(out, [s[i]]))
  : kerf_is_digit(s[i]) || s[i] == "-" || s[i] == "+" || s[i] == "."
    ? let (n = kerf_number(s, i)) kerf_tokens(s, max(n[1], i + 1), concat(out, [n[0]]))
  : kerf_tokens(s, i + 1, out);

function kerf_bezier(p0, p1, p2, p3, n) =
  [for (k = [1:n]) let (t = k / n, u = 1 - t) u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3];

function kerf_angle(u, v) =
  let (a = atan2(u[0] * v[1] - u[1] * v[0], u * v)) a;

// An SVG elliptical arc from p to q as points after p
function kerf_svg_arc(p, rx0, ry0, phi, large, sweep, q) =
  let (
    dx = (p[0] - q[0]) / 2,
    dy = (p[1] - q[1]) / 2,
    x1 = cos(phi) * dx + sin(phi) * dy,
    y1 = -sin(phi) * dx + cos(phi) * dy,
    rx1 = abs(rx0),
    ry1 = abs(ry0),
    lam = rx1 == 0 || ry1 == 0 ? 0 : (x1 * x1) / (rx1 * rx1) + (y1 * y1) / (ry1 * ry1),
    rx = lam > 1 ? rx1 * sqrt(lam) : rx1,
    ry = lam > 1 ? ry1 * sqrt(lam) : ry1
  )
  rx == 0 || ry == 0 || p == q ? [q]
  : let (
    num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1,
    den = rx * rx * y1 * y1 + ry * ry * x1 * x1,
    co = (large == sweep ? -1 : 1) * sqrt(max(0, num / den)),
    cx1 = co * rx * y1 / ry,
    cy1 = -co * ry * x1 / rx,
    cx = cos(phi) * cx1 - sin(phi) * cy1 + (p[0] + q[0]) / 2,
    cy = sin(phi) * cx1 + cos(phi) * cy1 + (p[1] + q[1]) / 2,
    t1 = kerf_angle([1, 0], [(x1 - cx1) / rx, (y1 - cy1) / ry]),
    dt0 = kerf_angle([(x1 - cx1) / rx, (y1 - cy1) / ry], [(-x1 - cx1) / rx, (-y1 - cy1) / ry]),
    dt = sweep == 0 && dt0 > 0 ? dt0 - 360 : sweep != 0 && dt0 < 0 ? dt0 + 360 : dt0,
    n = max(2, ceil(kerf_fragments(max(rx, ry)) * abs(dt) / 360))
  )
  [for (k = [1:n]) let (t = t1 + dt * k / n)
    [cx + rx * cos(phi) * cos(t) - ry * sin(phi) * sin(t), cy + rx * sin(phi) * cos(t) + ry * cos(phi) * sin(t)]];

// How many numbers each command takes
function kerf_arity(c) =
  let (u = search(c, "MLHVCSQTAZmlhvcsqtaz")[0]) [2, 2, 1, 1, 6, 4, 4, 2, 7, 0, 2, 2, 1, 1, 6, 4, 4, 2, 7, 0][u];

// Runs the commands from token i: cmd is the command in force, p the
// current point, s0 the subpath's start, ctl the last control point, cur
// the subpath so far and done the finished subpaths, each [points, closed]
function kerf_run(t, i = 0, cmd = "M", p = [0, 0], s0 = [0, 0], ctl = undef, cur = [], done = [], prev = "") =
  i >= len(t) ? (len(cur) > 1 ? concat(done, [[cur, false]]) : done)
  : is_string(t[i]) && (t[i] == "Z" || t[i] == "z")
    ? kerf_run(t, i + 1, t[i], s0, s0, undef, [], len(cur) > 2 ? concat(done, [[cur, true]]) : done, t[i])
  : is_string(t[i]) ? kerf_run(t, i + 1, t[i], p, s0, ctl, cur, done, prev)
  // a number after Z belongs to no command
  : cmd == "Z" || cmd == "z" ? kerf_run(t, i + 1, cmd, p, s0, ctl, cur, done, prev)
  : let (
    c = cmd,
    k = kerf_arity(c),
    a = [for (j = [0:k - 1]) t[i + j]],
    rel = c == "m" || c == "l" || c == "h" || c == "v" || c == "c" || c == "s" || c == "q" || c == "t" || c == "a",
    C = rel ? chr(ord(c) - 32) : c,
    o = rel ? p : [0, 0],
    // a lone point after M or m starts a subpath; more points are lines
    q = C == "M" ? o + [a[0], a[1]]
      : C == "L" || C == "T" ? o + [a[0], a[1]]
      : C == "H" ? [(rel ? p[0] : 0) + a[0], p[1]]
      : C == "V" ? [p[0], (rel ? p[1] : 0) + a[0]]
      : C == "C" ? o + [a[4], a[5]]
      : C == "S" || C == "Q" ? o + [a[2], a[3]]
      : o + [a[5], a[6]],
    smooth = is_undef(ctl) || !(prev == "C" || prev == "S" || prev == "c" || prev == "s") ? p : 2 * p - ctl,
    qsmooth = is_undef(ctl) || !(prev == "Q" || prev == "T" || prev == "q" || prev == "t") ? p : 2 * p - ctl,
    c1 = C == "C" ? o + [a[0], a[1]] : C == "S" ? smooth : undef,
    c2 = C == "C" ? o + [a[2], a[3]] : C == "S" ? o + [a[0], a[1]] : undef,
    qc = C == "Q" ? o + [a[0], a[1]] : C == "T" ? qsmooth : undef,
    seg = C == "M" ? []
      : C == "C" || C == "S" ? kerf_bezier(p, c1, c2, q, $fn > 0 ? $fn : 16)
      : C == "Q" || C == "T" ? kerf_bezier(p, p + (qc - p) * 2 / 3, q + (qc - q) * 2 / 3, q, $fn > 0 ? $fn : 16)
      : C == "A" ? kerf_svg_arc(p, a[0], a[1], a[2], a[3], a[4], q)
      : [q],
    started = C == "M" ? (len(cur) > 1 ? concat(done, [[cur, false]]) : done) : done,
    path = C == "M" ? [q] : concat(len(cur) ? cur : [p], seg),
    next = C == "M" ? (rel ? "l" : "L") : c,
    nctl = C == "C" || C == "S" ? c2 : C == "Q" || C == "T" ? qc : undef
  )
  kerf_run(t, i + k, next, q, C == "M" ? q : s0, nctl, path, started, c);

/** The subpaths of SVG path data, each [points, closed], y up as drawn */
function kerf_path(d) = kerf_run(kerf_tokens(d));

// Shapes from SVG path data: closed subpaths are areas (holes by even-odd,
// or each filled for fill = "nonzero"), open ones lines unless close
module path(d, fill = "evenodd", close = false) {
  subs = kerf_path(d);
  areas = [for (s = subs) if (s[1] || close) s[0]];
  lines = [for (s = subs) if (!(s[1] || close)) s[0]];
  if (len(areas)) {
    if (fill == "nonzero") for (a = areas) polygon(a);
    else {
      starts = [for (k = [0:len(areas) - 1]) k == 0 ? 0 : len([for (m = [0:k - 1], p = areas[m]) p])];
      polygon(
        [for (a = areas, p = a) p],
        [for (k = [0:len(areas) - 1]) [for (j = [0:len(areas[k]) - 1]) starts[k] + j]]
      );
    }
  }
  for (l = lines) kerf_strip(l);
}

// --- Layers, parts and assembly ---------------------------------------------

// What KerfScript cuts, scores and engraves; drawn as they are, scoring in
// blue and engraving in black, the guide layer in the background
module cut() children();
module score(side = "front") color("blue") children();
module engrave(side = "front") color("black") children();
module guide() % children();
module layer(name = "cut", mode, color, side, order, bleed) {
  if ($children > 0) {
    if (is_undef(color)) children();
    else color(color) children();
  }
}
module material(name, thickness, kerf) children();
module step(text, substeps = true) children();
module hardware(kind, from, to, size, label, sides, up, shape) {}

// A part: drawn flat, or with $kerf_3d extruded to $thickness and placed
// at each `at` (one [x, y, z] or a list), turned by `rotate`
module part(name = "part", qty = 1, at, rotate, stack, mirror, material, bend, on, slots, clearance, glue, face, bores, fit, halving) {
  if ($kerf_3d && !is_undef(at)) {
    ats = is_list(at[0]) ? at : [at];
    rots = is_undef(rotate) ? [for (a = ats) [0, 0, 0]] : is_list(rotate[0]) ? rotate : [for (a = ats) rotate];
    for (k = [0:len(ats) - 1]) translate(ats[k]) rotate(rots[k]) linear_extrude($thickness) children();
  } else children();
}

// Parts placed together, moved and turned as one
module place(at = [0, 0, 0], rotate = [0, 0, 0], pivot, explode) {
  if ($kerf_3d) translate(at) rotate(rotate) children();
  else children();
}
