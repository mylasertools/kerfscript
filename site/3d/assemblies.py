# Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

# How the parts of each example go together. A part is drawn in its program's
# x/y (mm) and is its sheet thickness deep in z, from 0 up. A recipe returns,
# for each part, the matrix that puts it in the assembled model (z up), or
# None to leave it out. Models without a recipe are laid out flat.

import math
from mathutils import Matrix

MM = 0.001


def T(x=0, y=0, z=0):
    return Matrix.Translation((x * MM, y * MM, z * MM))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def box_of(p):
    pts = [q for ring in p["cut"] for q in ring]
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return min(xs), min(ys), max(xs), max(ys)


def named(parts, name, copy=1):
    return next(p for p in parts if p["name"] == name and p["copy"] == copy)


# Stand a part up: its x stays x, its y becomes height, its thickness
# points towards -y. Then turn it about z by deg.
def upright(deg=0):
    return R("Z", deg) @ R("X", 90)


_flat = {}


def flat(p, parts):
    """Lay the parts out in rows, like they come off the sheet."""
    key = id(parts)
    if key not in _flat:
        boxes = [box_of(q) for q in parts]
        total = sum((b[2] - b[0] + 8) * (b[3] - b[1] + 8) for b in boxes)
        width = max(max(b[2] - b[0] for b in boxes), math.sqrt(total) * 1.3)
        x = y = row = 0
        spots = {}
        for q, b in sorted(zip(parts, boxes), key=lambda qb: -(qb[1][3] - qb[1][1])):
            w, h = b[2] - b[0], b[3] - b[1]
            if x > 0 and x + w > width:
                x, y, row = 0, y - row - 8, 0
            spots[(q["name"], q["copy"])] = T(x - b[0], y - h - b[1], 0)
            x += w + 8
            row = max(row, h)
        _flat[key] = spots
    return _flat[key][(p["name"], p["copy"])]


def box_parts(w, d, h, t, lid_lift=0):
    def place(p, parts):
        n = p["name"]
        if n == "bottom":
            return T()
        if n == "lid":
            return T(0, 0, h - t + lid_lift)
        if n == "front":
            return T(0, t, 0) @ R("X", 90)
        if n == "back":
            return T(0, d, 0) @ R("X", 90)
        if n == "left":
            return R("Z", 90) @ R("X", 90)
        if n == "right":
            return T(w - t, 0, 0) @ R("Z", 90) @ R("X", 90)
        return None
    return place


# Stand a part up across the x axis: its x runs along y, its y becomes
# height and its thickness points towards +x.
SIDEWAYS = R("Z", 90) @ R("X", 90)


def placed(p, parts):
    """Where the program's own at and rotate put the part."""
    m = Matrix([p["matrix"][r * 4:r * 4 + 4] for r in range(4)])
    m.translation = m.translation * MM
    return m


def phone_stand(p, parts):
    t, span, brace_x = 4, 64, 57.2
    if p["name"] == "side":
        return T(0, 12 + t + (p["copy"] - 1) * (span + t), 0) @ R("X", 90)
    return T(brace_x - t / 2, 0, 0) @ SIDEWAYS


def solstice(p, parts):
    t, height = 3, 170
    n = p["name"]
    if n == "Base":
        return T()
    if n == "Crown":
        return T(0, 0, t + height)
    if n in ("Sun wall", "Moon wall"):
        a = (0 if n == "Sun wall" else 90) + (p["copy"] - 1) * 180
        return R("Z", a) @ T(0, -50 + t / 2, t) @ R("X", 90)
    return None


def hadal(p, parts):
    t = 3
    xs = [35, 55, 75, 95, 115, 135, 155, 175, 195]
    zs = [75, 79, 83, 85, 86, 85, 82, 78, 73]
    n = p["name"]
    if n == "Plinth":
        return T(0, 0, -t)
    if n == "Spine":
        return T(0, t / 2, 0) @ R("X", 90)
    if n.startswith("Cradle"):
        return T((65 if n.endswith("A") else 165) - t / 2, 0, 0) @ SIDEWAYS
    if n.startswith("Rib "):
        i = int(n.split()[1]) - 1
        return T(xs[i] - t / 2, 0, zs[i]) @ SIDEWAYS
    return None


def xenospora(p, parts):
    t, height, r = 3, 220, 30
    n = p["name"]
    if n == "Root":
        return T(0, 0, -t)
    if n == "Crown":
        return T(0, 0, height)
    if n == "Core A":
        return T(0, t / 2, 0) @ R("X", 90)
    if n == "Core B":
        return T(-t / 2, 0, 0) @ SIDEWAYS
    if n.startswith("Fin "):
        i = int(n.split()[1]) - 1
        return R("Z", i * 30) @ T(r - t / 2, 0, 0) @ SIDEWAYS
    return None


def stack(order):
    """Parts glued flat on top of each other, in this order."""
    def place(p, parts):
        z = 0
        for q in sorted(parts, key=lambda q: (order(q), q["copy"])):
            if q is p:
                return T(0, 0, z)
            z += q["thickness"]
        return None
    return place


def tilt_maze_order(q):
    return {"Base": 0, "Maze layer": 1, "Cover": 2}[q["name"]]


def topo_order(q):
    return 0 if q["name"] == "Base" else int(q["name"].split()[1])


def drawer_organizer(w=240, d=160, h=50, t=3, cols=4, rows=2):
    panels = box_parts(w, d, h, t)
    inner = (w - 2 * t, d - 2 * t)

    def place(p, parts):
        n = p["name"]
        if n == "long divider":
            y = t + inner[1] * p["copy"] / rows
            return T(t + 0.5, y + t / 2, t) @ R("X", 90)
        if n == "cross divider":
            x = t + inner[0] * p["copy"] / cols
            return T(x - t / 2, t + 0.5, t) @ SIDEWAYS
        return panels(p, parts)
    return place


def gears(p, parts):
    if p["name"] == "large gear":
        return T()
    return T(3 * (32 + 14) / 2, 0, 0) @ R("Z", 180 / 14)


def umbra(p, parts):
    t = 3
    depths = [245, 275, 185, 155, 125, 215]
    yaws = [9, 15, -3, -9, -15, 3]
    n = p["name"]
    if n == "Base":
        return T(0, 0, -t)
    if n == "Stone":
        return T(0, 300 + t / 2, 0) @ R("X", 90)
    if n == "Light holder":
        return R("X", 90)
    if n.startswith("Fin "):
        i = int(n.split()[1]) - 1
        return T(0, depths[i], 0) @ R("Z", yaws[i]) @ T(0, t / 2, 0) @ R("X", 90)
    return None


def wave_cathedral(p, parts):
    t = 3
    n = p["name"]
    if n == "Base":
        return T(0, 0, -t)
    if n.startswith("Rail "):
        return T((-100 if n.endswith("L") else 100) - t / 2, 0, 0) @ SIDEWAYS
    if n.startswith("Rib "):
        i = int(n.split()[1]) - 1
        return T(0, 16 + 18 * i + t / 2, 0) @ R("X", 90)
    return None


def morph(t=3, spacers=2):
    """Bottom cover, then layer 1, the spacers, layer 2 and so on."""
    pitch = (1 + spacers) * t

    def place(p, parts):
        n = p["name"]
        if n == "Bottom cover":
            return T()
        if n.startswith("Layer "):
            return T(0, 0, t + (int(n.split()[1]) - 1) * pitch)
        if n == "Spacer":
            g, j = divmod(p["copy"] - 1, spacers)
            return T(0, 0, t + g * pitch + t + j * t)
        return None
    return place


def morph_rods(layers=28, spacers=2, t=3):
    top = t + (layers + (layers - 1) * spacers) * t
    return [(24 * math.cos(math.radians(a)), 24 * math.sin(math.radians(a)), t, top, 6) for a in (0, 120, 235)]


def slot_desk_sign(t=3):
    """Four signs on a desk, two in front and two behind: each panel stands
    in its base's slot. One (x, y, turn) per sign."""
    spots = [(-95, 0, 8), (95, 10, -6), (-190, 150, 12), (45, 170, -4)]

    def place(p, parts):
        x, y, a = spots[p["variant"]]
        at = T(x, y, 0) @ R("Z", a)
        if p["name"] == "Base":
            return at
        if p["name"] == "Panel":
            return at @ T(0, t / 2, t) @ R("X", 90)
        return None
    return place


def polar(r, a):
    return r * math.cos(math.radians(a)), r * math.sin(math.radians(a))


def nut(x, y, z, up=1, d=7.9, h=3.2):
    """A brass M4 nut sitting on z, facing up (1) or down (-1)."""
    return ((x, y, z), (x, y, z + up * h), d, "brass", 6)


def relief(holes, t=3):
    """Fracture and Morphogen: the backer, then the layers from the deepest
    up to layer 0 at the front, held by three bolts with brass heads."""
    def order(q):
        return -1 if q["name"] == "Backer" else 100 - int(q["name"].split()[1])

    def pins(layers):
        top = (layers + 1) * t
        out = []
        for x, y in holes:
            out.append(((x, y, 0), (x, y, top), 4, "steel", 24))
            out.append(((x, y, top), (x, y, top + 0.8), 9, "brass", 32))
            out.append(((x, y, top + 0.8), (x, y, top + 3.6), 7, "brass", 32))
        return out
    return stack(order), pins


def orbit(t=3, np_=24, theta=0):
    """The guide's stack, base underside at z 0: base, ring on standoffs,
    hub sleeves around the sun, planets, carrier, spacer and crank. theta
    turns the crank; the carrier follows at a quarter of it."""
    orbit_r, mounting = 72, 121
    crank_turn = -125 + theta
    carrier = theta * 24 / (24 + 24 + 2 * np_)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "Spindle pedestal":
            return T(0, 0, -c * t)
        if n == "Foot":
            j, k = divmod(c - 1, 7)
            return T(*polar(mounting, 30 + 120 * j), -7 * t + k * t)
        if n == "Ring standoff":
            j, k = divmod(c - 1, 4)
            return T(*polar(mounting, 30 + 120 * j), 2 * t + k * t)
        if n == "Ring gear":
            return T(0, 0, 6 * t + 0.5 + (c - 1) * t)
        if n == "Hub sleeve":
            return T(0, 0, (2 * t + 0.5 if c <= 4 else 4 * t + 0.5) + (c - 1) * t)
        if n == "Sun gear":
            return T(0, 0, 6 * t + 0.5 + (c - 1) * t) @ R("Z", theta)
        if n == "Planet gear":
            j, k = divmod(c - 1, 2)
            beta = carrier + 120 * j
            spin = (1 + 24 / np_) * beta - 24 / np_ * theta + 180 - 180 / np_
            return T(*polar(orbit_r, beta), 6 * t + 0.5 + k * t) @ R("Z", spin)
        if n == "Carrier":
            return T(0, 0, 8 * t + 1.2 + (c - 1) * t) @ R("Z", carrier)
        if n == "Carrier spacer":
            return T(0, 0, 10 * t + 1.2)
        if n == "Crank":
            return T(0, 0, 12 * t + 0.5 + (c - 1) * t) @ R("Z", crank_turn)
        if n == "Handle":
            return T(0, 0, 14 * t + 1 + (c - 1) * t) @ R("Z", crank_turn) @ T(0, 44)
        return None

    hx, hy = polar(44, 90 + crank_turn)
    top = 14 * t + 1 + 6 * t
    pins = [((0, 0, -14), (0, 0, 56), 6, "steel", 32), ((0, 0, 14 * t + 1), (0, 0, 14 * t + 8), 14, "steel", 32),
            ((hx, hy, 14 * t + 0.5), (hx, hy, top + 3), 4, "steel", 24), nut(hx, hy, top)]
    for j in range(3):
        x, y = polar(orbit_r, carrier + 120 * j)
        pins += [((x, y, 6 * t), (x, y, 10 * t + 5), 4, "steel", 24), nut(x, y, 10 * t + 1.2)]
        x, y = polar(mounting, 30 + 120 * j)
        pins.append(nut(x, y, 9 * t + 0.5))
    return place, pins


def trace(t=3, teeth=80, offset=22, theta=0):
    """Base, paper, ring on standoffs, pedestal, rolling gear with its pencil
    sleeve, then the carrier with the planet spacer and handle. theta turns
    the carrier."""
    big, small = 1.5 * teeth, 36
    a, mount = big - small, big + 12
    spin = (1 - teeth / 24) * theta
    gx, gy = polar(a, theta)
    px, py = gx + polar(offset, spin)[0], gy + polar(offset, spin)[1]
    hx, hy = polar(35, 180 + theta)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "Foot":
            j, k = divmod(c - 1, 5)
            return T(*polar(mount, 30 + 120 * j), -5 * t + k * t)
        if n == "Ring standoff":
            j, k = divmod(c - 1, 4)
            return T(*polar(mount, 30 + 120 * j), 2 * t + k * t)
        if n == "Ring gear":
            return T(0, 0, 6 * t + (c - 1) * t)
        if n == "Pedestal":
            return T(0, 0, 2 * t + (c - 1) * t)
        if n == "Rolling gear":
            return T(gx, gy, 6 * t + 0.15 + (c - 1) * t) @ R("Z", spin)
        if n == "Pencil sleeve":
            return T(px, py, 3 * t + 0.15 + (c - 1) * t)
        if n == "Planet spacer":
            return T(gx, gy, 8 * t + 0.35 + (c - 1) * t)
        if n == "Carrier":
            return T(0, 0, 11 * t + 0.35 + (c - 1) * t) @ R("Z", theta)
        if n == "Handle":
            return T(hx, hy, 13 * t + 0.85 + (c - 1) * t)
        return None

    # The drawing: a hypotrochoid that closes after three carrier turns
    curve = []
    for i in range(0, 3 * 720 + 1):
        th = math.radians(i / 2)
        k = 1 - teeth / 24
        curve.append((a * math.cos(th) + offset * math.cos(k * th), a * math.sin(th) + offset * math.sin(k * th)))
    disc = lambda r, n=180: [polar(r, 360 * i / n) for i in range(n)]
    flats = [{"rings": [disc(big - 6), disc(13)], "z": 2 * t, "depth": 0.15, "color": "#f7f4ee",
              "lines": [curve], "line_color": "#3d6f7d", "line_width": 0.5}]
    top = 13 * t + 0.35
    pins = [((0, 0, -10), (0, 0, top + 8), 6, "steel", 32), ((0, 0, top + 0.5), (0, 0, top + 7.5), 14, "steel", 32),
            ((px, py, 2 * t + 0.15), (px, py, 2 * t + 21), 7, "pencil", 6),
            ((gx, gy, 6 * t - 3.6), (gx, gy, top + 4.5), 4, "steel", 24), nut(gx, gy, top),
            ((hx, hy, top), (hx, hy, top + 5 * t + 4.5), 4, "steel", 24), nut(hx, hy, top + 0.5 + 5 * t)]
    for j in range(3):
        pins.append(nut(*polar(mount, 30 + 120 * j), 8 * t))
    return place, pins, flats


def stride_joints(s=2, crank=15, theta=0):
    """Jansen's linkage at crank angle theta: O, Y, Z, X, W, V, U, T, as in
    the program."""
    def meet(p, r1, q, r2, sgn):
        vx, vy = q[0] - p[0], q[1] - p[1]
        d = math.hypot(vx, vy)
        a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h = math.sqrt(max(0, r1 * r1 - a * a))
        return (p[0] + vx * a / d - vy * h / d * sgn, p[1] + vy * a / d + vx * h / d * sgn)
    O, Y, Z = (0, 0), (-38, -7.8), polar(crank, theta)
    X = meet(Z, 50, Y, 41.5, -1)
    W = meet(Z, 61.9, Y, 39.3, 1)
    V = meet(Y, 40.1, X, 55.8, 1)
    U = meet(V, 39.4, W, 36.7, -1)
    Tj = meet(W, 49, U, 65.7, 1)
    return {k: (p[0] * s, p[1] * s) for k, p in zip("OYZXWVUT", (O, Y, Z, X, W, V, U, Tj))}


def stride(t=3, s=2, theta=0):
    """The board stands on two halved feet; the links hang in front of it at
    the guide's depths, C nearest the board and F at the front. theta turns
    the crank; the rocker and foot are drawn where they sit at angle 0."""
    J = stride_joints(s, theta=theta)
    J0 = stride_joints(s)
    ox, oz = 125 * s, 133 * s
    at = {k: (ox + x, oz + y) for k, (x, y) in J.items()}
    depth = {n: 10 + i * (t + 5) for i, n in enumerate("CARDBEF")}
    rods = {"A upper link": ("A", "Z", "X"), "B lower link": ("B", "Z", "W"),
            "D anchor link": ("D", "Y", "W"), "E coupler": ("E", "V", "U")}
    # Spacer stacks: joint, and the layer whose front face they start from
    spacers = {"Z, C to A": ("Z", "C"), "Z, A to B": ("Z", "A"), "X, A to R": ("X", "A"),
               "W, D to B": ("W", "D"), "W, B to F": ("W", "B"), "U, E to F": ("U", "E"),
               "V, R to E": ("V", "R"), "Y, R to D": ("Y", "R"), "Y, board to R": ("Y", None)}
    turn = -70 + theta

    def front(x, z, d):
        """A flat part with its back face d mm in front of the board."""
        return T(x, -d, z) @ R("X", 90)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Backboard":
            return T(0, c * t, 0) @ R("X", 90)
        if n == "Stand foot":
            j, k = divmod(c - 1, 2)
            return T((25 if j == 0 else 155) * s - t + k * t, 1.5 * t - 65, 0) @ SIDEWAYS
        if n == "C crank":
            return front(ox, oz, depth["C"]) @ R("Z", theta)
        if n in ("R rocker", "F foot"):
            # Turn the part as drawn about its first joint, Y or W
            a, b = ("Y", "X") if n[0] == "R" else ("W", "U")
            was = math.atan2(J0[b][1] - J0[a][1], J0[b][0] - J0[a][0])
            now = math.atan2(J[b][1] - J[a][1], J[b][0] - J[a][0])
            return (front(*at[a], depth[n[0]]) @ R("Z", math.degrees(now - was))
                    @ T(-J0[a][0], -J0[a][1]))
        if n in rods:
            layer, a, b = rods[n]
            ang = math.degrees(math.atan2(at[b][1] - at[a][1], at[b][0] - at[a][0]))
            return front(*at[a], depth[layer]) @ R("Z", ang)
        if n.startswith("Spacer "):
            joint, behind = spacers[n[7:]]
            return front(*at[joint], (depth[behind] + t if behind else 0) + (c - 1) * t)
        if n == "Hex socket":
            if c == 1:
                return front(ox, oz, depth["C"] + t) @ R("Z", theta)
            return front(ox, oz, -3 * t - 1 - 3 * t) @ R("Z", turn)
        if n == "Rear crank":
            return front(ox, oz, -3 * t - 1 - c * t) @ R("Z", turn)
        if n == "Handle grip":
            return front(ox, oz, -6 * t - 1 - c * t) @ R("Z", turn) @ T(40, 0)
        return None

    def span(k, d0, d1, d=6):
        x, z = at[k]
        return ((x, -d0, z), (x, -d1, z), d, "brass", 32)

    def cap(k, d):
        x, z = at[k]
        return ((x, -d, z), (x, -d - 3.2, z), 7.9, "brass", 6)

    last = depth["F"] + t
    pins = [span("Z", depth["C"], depth["B"] + t), cap("Z", depth["B"] + t),
            span("X", depth["A"], depth["R"] + t), cap("X", depth["R"] + t),
            span("W", depth["D"], last), cap("W", last),
            span("V", depth["R"], depth["E"] + t), cap("V", depth["E"] + t),
            span("U", depth["E"], last), cap("U", last),
            span("Y", 0, depth["D"] + t), cap("Y", depth["D"] + t),
            span("O", -3 * t, depth["C"]), span("O", depth["C"], depth["C"] + 2 * t, 4)]
    return place, pins


def tidal(t=3, fins=7, lift=8, phase=45, pitch_layers=9, theta=0):
    """Base and end walls, the rotor on its square shaft (journal, rings,
    cams, rings, journal), followers on the cams through the two guides,
    washers, crank and collars outside the walls."""
    pitch, cam_t, margin = pitch_layers * t, 3 * t, 8 * t
    inner = 2 * margin + cam_t + (fins - 1) * pitch + 0.8
    overall = inner + 6 * t
    shaft, mid, crank_turn = 45, 55, 160 + theta

    def station(i):
        return 3 * t + margin + cam_t / 2 + i * pitch

    def on_shaft(x):
        return T(x, mid, shaft) @ SIDEWAYS

    # Where each spacer ring sits along the shaft
    rings = [3 * t + k * t for k in range(8)]
    for i in range(fins - 1):
        rings += [station(i) + cam_t / 2 + k * t for k in range(pitch_layers - 3)]
    rings += [station(fins - 1) + cam_t / 2 + k * t for k in range(8)]

    def place(p, parts):
        n, c = p["name"], p["copy"]
        side = lambda k: (k - 1) * t if k <= 3 else overall - 3 * t + (k - 4) * t
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "End wall":
            return T(side(c), mid, 0) @ SIDEWAYS
        if n == "Journal":
            return on_shaft(side(c)) @ R("Z", theta)
        if n == "Guide half":
            z = (90, 126)[(c - 1) // 2]
            if c % 2:
                return T(3 * t, mid - 45, z)
            return T(3 * t, mid + 45, z + t) @ R("X", 180)
        if n == "Thrust washer":
            return on_shaft(-c * t if c <= 2 else overall + (c - 3) * t)
        if n.startswith("Cam "):
            i = int(n.split()[1]) - 1
            return on_shaft(station(i) - cam_t / 2 + (c - 1) * t) @ R("Z", i * phase + theta)
        if n.startswith("Fin "):
            i = int(n.split()[1]) - 1
            lift_z = shaft + 22 + lift * math.sin(math.radians(i * phase + theta))
            return T(station(i) - t + (c - 1) * t, mid, lift_z) @ SIDEWAYS
        if n == "Spacer ring":
            return on_shaft(rings[c - 1]) if c <= len(rings) else None
        if n == "Crank":
            return on_shaft(-5 * t + (c - 1) * t) @ R("Z", crank_turn)
        if n == "Handle":
            return on_shaft(-5 * t - c * t) @ R("Z", crank_turn) @ T(0, 30)
        return None

    hy, hz = polar(30, 90 + crank_turn)
    pins = [((-5 * t - 9, mid, shaft), (overall + 2 * t + 9, mid, shaft), 6, "steel", 4),
            ((-5 * t - 8, mid, shaft), (-5 * t, mid, shaft), 22, "steel", 32),
            ((overall + 2 * t, mid, shaft), (overall + 2 * t + 8, mid, shaft), 22, "steel", 32),
            ((-2 * t, mid + hy, shaft + hz), (-11 * t - 5, mid + hy, shaft + hz), 4, "steel", 24),
            ((-11 * t - 1, mid + hy, shaft + hz), (-11 * t - 4.2, mid + hy, shaft + hz), 7.9, "brass", 6)]
    return place, pins


def ascent(t=3, theta=0, ball_x=150):
    """The guide's stack, seen from the front with the shaft at the origin
    and the base underside at z 0: rear cheek, shroud rings round the wheel,
    front cheek with the gate, the chute floor between the cheek walls and
    the catch box on its pedestals. Behind the rear collar: hub rings, the
    crank and its grip. theta turns the crank clockwise, seen from the
    front; the marble rolls down the chute from the pocket that has just
    let it go, ball_x mm out from the shaft."""
    radius, D = 110, 16
    layers = math.ceil((D + 2) / t)
    gap = (layers + 1) * t
    centre = t + radius + 110
    # Wheel, crank and grip turn together; at 0 a pocket points 45 degrees
    # down to the right, into the release opening
    turn = -15 - theta
    slope = math.degrees(math.atan2(158.25 - 110, 258 - 65))
    floor_top = centre - 158.25
    crank_z = -40

    def depth(z0, x=0, y=0):
        """A part drawn in the front view, its back face at guide depth z0
        (the front is +z, towards -y in the model), moved to x, y."""
        return T(x, -z0, centre + y) @ upright()

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T()
        if n == "Rear cheek":
            return depth(-gap / 2 - t)
        if n == "Front cheek":
            return depth(gap / 2)
        if n == "Shroud":
            return depth(-gap / 2 + (c - 1) * t)
        if n == "Wheel":
            return depth(-layers * t / 2 + (c - 1) * t) @ R("Z", turn)
        if n == "Loading gate":
            return depth(gap / 2 + t, 0, -(radius + 2 - D / 2))
        if n == "Gusset":
            # Two in front of the stand and two behind, at x = -50 and 50
            x = -50 if c % 2 else 50
            if c <= 2:
                return T(x + t / 2, -gap / 2 - t, t) @ R("Z", 180) @ SIDEWAYS
            return T(x - t / 2, gap / 2 + t, t) @ SIDEWAYS
        if n == "Chute floor":
            # Its top face on the floor line, from (65, -110) to (258, -158.25)
            return T((65 + 258) / 2, 0, centre - (110 + 158.25) / 2) @ R("Y", slope) @ T(0, 0, -t)
        if n == "Catch floor":
            return T(283, 0, floor_top - t)
        if n == "Catch lid":
            return T(283, 0, floor_top + 22)
        if n == "Catch side wall":
            return T(283, 25 if c == 1 else 3 - 25, floor_top + 11) @ upright()
        if n == "Catch end wall":
            return T(308 - t, 0, floor_top + 11) @ SIDEWAYS
        if n == "Catch pedestal":
            return T(283, 20 if c == 1 else t - 20, t + (floor_top - 2 * t) / 2) @ upright()
        if n == "Hub ring":
            z0 = crank_z - 3 * t + (c - 1) * t if c <= 2 else crank_z + t + (c - 3) * t
            return depth(z0) @ R("Z", turn)
        if n == "Crank":
            return depth(crank_z - t + (c - 1) * t) @ R("Z", turn)
        if n == "Grip":
            return depth(crank_z - t - 0.8 - c * t) @ R("Z", turn) @ T(35, 0)
        return None

    def axial(x, y, z0, z1, d, kind, sides=32):
        """Hardware along the shaft direction at (x, y) in the front view,
        from guide depth z0 to z1."""
        return ((x, -z0, centre + y), (x, -z1, centre + y), d, kind, sides)

    face = gap / 2 + t
    pins = [axial(0, 0, -52, 28, 6, "steel"),
            axial(0, 0, gap / 2, face, 8, "brass"), axial(0, 0, -face, -gap / 2, 8, "brass"),
            axial(0, 0, face + 0.3, face + 7.3, 12, "steel"), axial(0, 0, -face - 7.3, -face - 0.3, 12, "steel")]
    # Six M4 x 40 bolts through cheeks and shroud, heads behind, nuts in front
    for a in (0, 60, 120, 180, 240, 285):
        x, y = polar(radius + 13, a)
        pins += [axial(x, y, -face - 0.8, -face - 0.8 + 40, 4, "steel", 24),
                 axial(x, y, -face - 0.8, -face, 9, "steel"), axial(x, y, -face - 3.6, -face - 0.8, 7.9, "brass", 6),
                 axial(x, y, face, face + 0.8, 9, "steel"), axial(x, y, face + 0.8, face + 4, 7.9, "brass", 6)]
    # The gate's pivot: a countersunk M4 bolt from inside, washer and wingnut
    gx, gy = D / 2 + 13, -(radius + 2 - D / 2)
    out = face + t
    pins += [axial(gx, gy, gap / 2, out + 6, 4, "steel", 24), axial(gx, gy, out, out + 0.8, 9, "steel"),
             axial(gx, gy, out + 0.8, out + 4.5, 8, "brass", 6),
             ((gx - 9, -out - 3, centre + gy), (gx + 9, -out - 3, centre + gy), 2.5, "brass", 4)]
    # The grip: M4 x 30 bolt through the crank and the sleeve, nyloc behind
    hx, hy = polar(35, turn)
    back = crank_z - t - 0.8 - 4 * t
    pins += [axial(hx, hy, crank_z + t, crank_z + t - 30, 4, "steel", 24),
             axial(hx, hy, crank_z + t, crank_z + t + 2.8, 7, "steel", 6),
             axial(hx, hy, crank_z - t - 0.8, crank_z - t, 9, "steel"),
             axial(hx, hy, back - 0.8, back, 9, "steel"), axial(hx, hy, back - 4.8, back - 0.8, 7.9, "brass", 6)]
    # The marble, rolling down the chute ball_x mm out from the shaft
    s, c = math.sin(math.radians(slope)), math.cos(math.radians(slope))
    bx, by = ball_x, -110 - (ball_x - 65) * s / c
    balls = [(bx + D / 2 * s, 0, centre + by + D / 2 * c, D)]
    return place, pins, balls


def expanse(t=3, theta=25):
    """The guide's stack, base underside at z 0: feet under the base, the
    rails standing in it, the disc (t + 2), the followers (t + 10) between
    the rails, the deck on its corner standoffs (t + 20) with the well walls,
    and the trays on their moving posts (2t + 40). theta turns the disc, from
    74 (closed) to 15 (open); the trays slide out with it."""
    W, D, crank, closed = 100, 140, 70, 74
    base_w, base_d, rail_y, well = 330.64, 190, 81.7, 45
    x = W / 2 + 2 + crank * (math.cos(math.radians(theta)) - math.cos(math.radians(closed)))
    corners = [(sx * (base_w / 2 - 8), sy * (base_d / 2 - 8)) for sx in (-1, 1) for sy in (-1, 1)]
    posts = [(s * x + px, py) for s in (1, -1) for px in (-W / 2 + 8, W / 2 - 8) for py in (-D / 2 + 8, D / 2 - 8)]
    floor = 2 * t + 40

    def place(p, parts):
        n, c = p["name"], p["copy"]
        side = 1 if c <= 2 else -1
        if n == "Base":
            return T()
        if n == "Foot":
            j, k = divmod(c - 1, 3)
            return T(*corners[j], -3 * t + k * t)
        if n == "Guide rail":
            return T(0, (1 if c == 1 else -1) * rail_y + t / 2, t) @ upright()
        if n == "Drive disc":
            return T(0, 0, t + 2) @ R("Z", theta)
        if n == "Right follower":
            return T(x, 0, t + 10)
        if n == "Left follower":
            return T(-x, 0, t + 10)
        if n == "Deck":
            return T(0, 0, t + 20)
        if n == "Well side wall":
            return T((1 if c == 1 else -1) * well - t / 2, 0, 2 * t + 20) @ SIDEWAYS
        if n == "Well end wall":
            return T(0, (1 if c == 1 else -1) * well + t / 2, 2 * t + 20) @ upright()
        if n == "Tray floor":
            return T((1 if c == 1 else -1) * x, 0, floor)
        if n == "Tray end wall":
            y = (1 if c % 2 else -1) * (D / 2 - t / 2)
            return T(side * x, y + t / 2, floor + t) @ upright()
        if n == "Tray side wall":
            dx = (1 if c % 2 else -1) * (W / 2 - t / 2)
            return T(side * x + dx - t / 2, 0, floor + t) @ SIDEWAYS
        return None

    def bolt(bx, by, top):
        """An M4 bolt up through the base, its head underneath, above the foot bottoms."""
        return [((bx, by, -2.8), (bx, by, 0), 7, "steel", 32), ((bx, by, 0), (bx, by, top), 4, "steel", 24)]

    def screws(sx, sy, under, over):
        """Screw heads under and on top of a standoff."""
        return [((sx, sy, under - 2.5), (sx, sy, under), 7, "steel", 32), ((sx, sy, over), (sx, sy, over + 2.5), 7, "steel", 32)]

    # Centre axle on the 2 mm thrust shim, and the two stop pins, each with
    # a sleeve, washer and nut
    pins = [((0, 0, t), (0, 0, t + 2), 10, "steel", 32)]
    for bx, by in [(0, 0), polar(35, 100), polar(35, 280)]:
        pins += bolt(bx, by, 2 * t + 6.2)
        pins += [((bx, by, t), (bx, by, t + 5.2), 6, "steel", 32),
                 ((bx, by, t + 5.2), (bx, by, t + 6), 9, "steel", 32), nut(bx, by, t + 6)]
    # Countersunk drive bolts in the disc, with their sleeves in the followers' slots
    for a in (theta, theta + 180):
        bx, by = polar(crank, a)
        pins += [((bx, by, t + 2), (bx, by, 2 * t + 14.2), 4, "steel", 24),
                 ((bx, by, 2 * t + 2), (bx, by, 2 * t + 10.2), 6, "steel", 32),
                 ((bx, by, 2 * t + 10.2), (bx, by, 2 * t + 11), 8, "steel", 32), nut(bx, by, 2 * t + 11)]
    # Fixed guide bolts: a 10 mm spacer under the follower, a sleeve in its slot
    for bx, by in [(sx * 86, sy * (D / 2 - 18)) for sx in (-1, 1) for sy in (-1, 1)]:
        pins += bolt(bx, by, 2 * t + 14.2)
        pins += [((bx, by, t), (bx, by, t + 10), 9, "brass", 32), ((bx, by, t), (bx, by, 2 * t + 10.2), 6, "steel", 32),
                 ((bx, by, 2 * t + 10.2), (bx, by, 2 * t + 11), 10, "steel", 32), nut(bx, by, 2 * t + 11)]
    # 20 mm deck standoffs at the corners, 30 mm tray posts on the followers
    for sx, sy in corners:
        pins += [((sx, sy, t), (sx, sy, t + 20), 8.1, "brass", 6)] + screws(sx, sy, 0, 2 * t + 20)
    for sx, sy in posts:
        pins += [((sx, sy, 2 * t + 10), (sx, sy, floor), 8.1, "brass", 6)] + screws(sx, sy, t + 10, floor + t)
    return place, pins


def celestial(t=3, theta=432):
    """The guide's stack, base underside at z 0: base on four feet, a
    pedestal and shim under each journal, the orbit gears on the left journal
    and the drive gears and crank on the right one at z 15, 35, 55 and 75,
    planets on the orbit gears and the sun on its rod at z 85. theta turns
    the crank; the orbit gears follow at -1/2, -1 and -2 times it."""
    m, w = 3, 1
    axle = 45 * m
    corners = [(x, y) for x in (-27 * m, axle + 27 * m) for y in (-27 * m, 27 * m)]
    levels = {"Lower": (60, 15), "Middle": (45, 35), "Upper": (30, 55)}
    turn = {zc: -theta * (90 - zc) / zc for zc, _ in levels.values()}

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "Foot":
            j, k = divmod(c - 1, 3)
            return T(*corners[j], -3 * t + k * t)
        if n == "Journal pedestal":
            j, k = divmod(c - 1, 2)
            return T(j * axle, 0, 2 * t + k * t)
        if n.endswith(" orbit gear"):
            zc, z = levels[n.split()[0]]
            return T(0, 0, z + (c - 1) * t) @ R("Z", turn[zc])
        if n.endswith(" drive gear"):
            zc, z = levels[n.split()[0]]
            return T(axle, 0, z + (c - 1) * t) @ R("Z", theta)
        if n == "Planet":
            j, k = divmod(c - 1, 3)
            zc, z = list(levels.values())[j]
            return R("Z", turn[zc]) @ T(zc * m / 2 - 12, 0, z + 2 * t + k * t)
        if n == "Sun":
            return T(0, 0, 85 + (c - 1) * t)
        if n == "Crank":
            return T(axle, 0, 75 + (c - 1) * t) @ R("Z", theta)
        if n == "Handle":
            return T(axle, 0, 82 + (c - 1) * t) @ R("Z", theta) @ T(0, 40)
        return None

    # Both journals: an M6 rod from under the base, the 8 mm tube clamped on
    # it, the shim and washer on the pedestal, and a retaining washer and nut
    # on the tube end
    pins = []
    for x, top, rod in ((0, 62.25, 99), (axle, 82.25, 92)):
        pins += [nut(x, 0, 0, -1, 11.5, 4), ((x, 0, -4), (x, 0, rod), 6, "steel", 32),
                 ((x, 0, 2 * t), (x, 0, top), 8, "steel", 32), ((x, 0, 4 * t), (x, 0, 14), 16, "steel", 32),
                 ((x, 0, 14), (x, 0, 15), 12, "steel", 32), ((x, 0, top), (x, 0, top + w), 14, "steel", 32),
                 nut(x, 0, top + w, 1, 11.5, 5)]
    # Orbit journal: a thrust washer on each side of every gear, floating
    # sleeves between them, then a spacer on the rod up to the sun
    for z in (15, 35, 55):
        pins += [((0, 0, z + 2 * t), (0, 0, z + 2 * t + w), 12, "steel", 32)]
        if z > 15:
            pins += [((0, 0, z - w), (0, 0, z), 12, "steel", 32)]
        if z < 55:
            pins += [((0, 0, z + 2 * t + w), (0, 0, z + 20 - w), 12, "brass", 32)]
    pins += [((0, 0, 62.25 + w + 5), (0, 0, 85), 10, "brass", 32),
             ((0, 0, 85 + 2 * t), (0, 0, 85 + 2 * t + w), 12, "steel", 32), nut(0, 0, 85 + 2 * t + w, 1, 11.5, 5)]
    # Drive compound: two M3 rods at +-12 mm turning with it, 14 mm spacers
    # between the gears and the crank, nuts under the lowest gear and on top
    pins += [((axle, 0, 75 + 2 * t), (axle, 0, 75 + 2 * t + w), 12, "steel", 32)]
    for s in (-12, 12):
        x, y = polar(s, theta)
        x += axle
        pins += [((x, y, 10), (x, y, 87), 3, "steel", 16), nut(x, y, 15, -1, 6.4, 3),
                 nut(x, y, 75 + 2 * t, 1, 6.4, 3)]
        pins += [((x, y, z + 2 * t), (x, y, z + 20), 6, "brass", 24) for z in (15, 35, 55)]
    # Handle: an M4 bolt up through the crank, a thrust washer each side of
    # the handle and a nut on top
    hx, hy = polar(40, 90 + theta)
    hx += axle
    pins += [nut(hx, hy, 75, -1), ((hx, hy, 71.8), (hx, hy, 102), 4, "steel", 24),
             ((hx, hy, 81), (hx, hy, 82), 10, "steel", 32), ((hx, hy, 97), (hx, hy, 98), 10, "steel", 32),
             nut(hx, hy, 98)]
    # Hold-down bolts through the base and feet
    for x, y in corners:
        pins += [nut(x, y, 2 * t), ((x, y, -6), (x, y, 2 * t), 4, "steel", 24), nut(x, y, 0, -1)]
    return place, pins


def flight(t=3, theta=0):
    """The board stands in two halved feet; the fixed root and guide posts
    stand off its front on glued rings, and the moving layers sit at the
    guide's depths: crank disc, drive rod, slider, left link, right link,
    wings. theta turns the crank from 240 degrees, where the wings are near
    the top of their beat."""
    crank_r, link, arm = 12, 50, 25
    O, guides, roots = (0, 85), ((0, 165), (0, 185)), ((-35, 180), (35, 180))
    crank = 240 + theta

    def meet(p, r1, q, r2, sgn):
        vx, vy = q[0] - p[0], q[1] - p[1]
        d = math.hypot(vx, vy)
        a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h = math.sqrt(max(0, r1 * r1 - a * a))
        return (p[0] + vx * a / d - vy * h / d * sgn, p[1] + vy * a / d + vx * h / d * sgn)

    cx, cy = polar(crank_r, crank)
    C = (O[0] + cx, O[1] + cy)
    S = (0, C[1] + math.sqrt(link * link - C[0] ** 2))
    # The outward branch: the link pin inboard of the root, the wing level
    # at crank angle 0 rather than hanging down
    BR = meet(S, link, roots[1], arm, 1)
    BL = (-BR[0], BR[1])
    wing = math.degrees(math.atan2(roots[1][1] - BR[1], roots[1][0] - BR[0]))
    at = {"O": O, "C": C, "S": S, "L": BL, "R": BR}
    depth = {"crank": t + 1, "rod": 5 * t + 1, "slider": 7 * t + 1, "left": 11 * t + 1,
             "right": 13 * t + 1, "wing": 16 * t + 4}
    # Spacer rings: joint and rear face, crank pin, slider pivot, left and
    # right link pins; the last four are spares
    rings = ([("C", depth["crank"] + k * t) for k in (1, 2, 3)]
             + [("S", d) for d in (6 * t + 1, 8 * t + 1, 9 * t + 1, 10 * t + 1, 12 * t + 1)]
             + [("L", depth["left"] + k * t) for k in (1, 2, 3, 4)]
             + [("R", depth["right"] + k * t) for k in (1, 2)])

    def front(x, z, d):
        """A flat part with its back face d mm in front of the board."""
        return T(x, -d, z) @ R("X", 90)

    def towards(a, b):
        """A rod drawn up its y axis, turned to run from joint a to joint b."""
        return R("Z", math.degrees(math.atan2(at[b][1] - at[a][1], at[b][0] - at[a][0])) - 90)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Backboard":
            return T(0, c * t, 0) @ R("X", 90)
        if n == "Stand foot":
            j, k = divmod(c - 1, 2)
            return T((-45, 45)[j] - t + k * t, 1.5 * t, 0) @ SIDEWAYS
        if n == "Right wing":
            return front(*roots[1], depth["wing"]) @ R("Z", wing)
        if n == "Left wing":
            return front(*roots[0], depth["wing"]) @ R("Z", -wing)
        if n == "Crank disc":
            return front(*O, depth["crank"]) @ R("Z", crank - 90)
        if n == "Rear crank":
            return front(*O, -3 * t - 4 - c * t) @ R("Z", crank - 90)
        if n == "Handle grip":
            return front(*O, -6 * t - 4 - c * t) @ R("Z", crank - 90) @ T(0, 30)
        if n == "Drive rod":
            return front(*C, depth["rod"]) @ towards("C", "S")
        if n == "Wing link":
            side = "left" if c == 1 else "right"
            return front(*S, depth[side]) @ towards("S", side[0].upper())
        if n == "Slider":
            return front(*S, depth["slider"])
        if n == "Root standoff":
            j, k = divmod(c - 1, 16)
            return front(*roots[j], k * t)
        if n == "Guide standoff":
            j, k = divmod(c - 1, 7)
            return front(*guides[j], k * t)
        if n == "Spacer ring":
            if c > len(rings):
                return None
            joint, d = rings[c - 1]
            return front(*at[joint], d)
        return None

    def bar(p, d0, d1, d, kind, sides=32):
        """Hardware along the depth axis at p, from depth d0 to d1."""
        return ((p[0], -d0, p[1]), (p[0], -d1, p[1]), d, kind, sides)

    def pivot(p, d0, d1, shim=None, head=None):
        """A 6 mm brass sleeve from d0 to d1 on an M4 bolt: head and washer
        behind (at d0 unless given), washer and nut in front, and a metal shim
        pack (from, to)."""
        h = d0 if head is None else head
        out = [bar(p, h - 3.3, d1 + 4.5, 4, "steel", 24), bar(p, d0, d1, 6, "brass"),
               bar(p, h, h - 0.5, 8, "steel"), bar(p, h - 0.5, h - 3.3, 7.9, "steel", 6),
               bar(p, d1, d1 + 0.5, 8, "steel"), bar(p, d1 + 0.5, d1 + 3.7, 7.9, "brass", 6)]
        if shim:
            out.append(bar(p, shim[0], shim[1], 12, "steel"))
        return out

    top = 17 * t + 4.2
    G = (O[0] + polar(30, crank)[0], O[1] + polar(30, crank)[1])
    pins = []
    # Fixed posts: the bolt head is behind the board and the sleeve bears on
    # its front
    for p in roots:
        pins += pivot(p, 0, top, (16 * t, 16 * t + 4), -3 * t)
    for p in guides:
        pins += pivot(p, 0, 8 * t + 1.2, (7 * t, 7 * t + 1), -3 * t)
    # Moving pivots
    pins += pivot(C, t + 1, 6 * t + 1.2)
    pins += pivot(S, 5 * t + 1, 14 * t + 1.2)
    pins += pivot(BL, 11 * t + 1, top, (16 * t + 1, 16 * t + 4))
    pins += pivot(BR, 13 * t + 1, top, (16 * t + 1, 16 * t + 4))
    # The spindle in its journal, clamped to both cranks by a full nut inside
    # and two jam nuts outside each one
    pins += [bar(O, -6 * t - 8.9, 2 * t + 5.9, 4, "steel", 24), bar(O, -3 * t - 0.1, t - 2.9, 6, "brass"),
             bar(O, t - 2.7, t + 0.5, 7.9, "brass", 6), bar(O, t + 0.5, t + 1, 8, "steel"),
             bar(O, 2 * t + 1, 2 * t + 1.5, 8, "steel"), bar(O, 2 * t + 1.5, 2 * t + 5.9, 7.9, "brass", 6),
             bar(O, -3 * t - 0.3, -3 * t - 3.5, 7.9, "brass", 6), bar(O, -3 * t - 3.5, -3 * t - 4, 8, "steel"),
             bar(O, -6 * t - 4, -6 * t - 4.5, 8, "steel"), bar(O, -6 * t - 4.5, -6 * t - 8.9, 7.9, "brass", 6)]
    # The handle grip turns on its sleeve, bolted to the rear crank
    pins += [bar(G, -3 * t - 1.2, -11 * t - 8.2, 4, "steel", 24), bar(G, -3 * t - 1.2, -3 * t - 4, 7.9, "steel", 6),
             bar(G, -6 * t - 4, -11 * t - 4.2, 6, "brass"), bar(G, -11 * t - 4.2, -11 * t - 4.7, 8, "steel"),
             bar(G, -11 * t - 4.7, -11 * t - 7.9, 7.9, "brass", 6)]
    return place, pins


def bloom(t=3, ring=35):
    """The guide's stack, z 0 at the top of the base: base laminates, feet
    below, hub and drive ring, retainer, grip, then on each ring pin a spacer
    and the coupler, and each petal on its two sleeves through its slot.
    ring is the drive ring's angle, 55 closed to 15 open."""
    n, pivot, link, spacing = 6, 60, 70, 30

    def guide(k):
        return 360 * k / n

    # The slider-crank: ring pin k is ring degrees past guide k, and the
    # coupler holds the petal's inner pin this far out
    a = math.radians(ring)
    out = pivot * math.cos(a) + math.sqrt(link * link - (pivot * math.sin(a)) ** 2)

    def ring_pin(k):
        return polar(pivot, guide(k) + ring)

    def place(p, parts):
        nm, c = p["name"], p["copy"]
        if nm == "Base":
            return T(0, 0, -2 * t + (c - 1) * t)
        if nm == "Foot cap":
            return T(*polar(65, guide(c - 0.5)), -3 * t)
        if nm == "Foot ring":
            j, k = divmod(c - 1, 5)
            return T(*polar(65, guide(j + 0.5)), -4 * t - k * t)
        if nm == "Hub":
            return T(0, 0, 0.4)
        if nm == "Drive ring":
            return T(0, 0, 0.2) @ R("Z", ring)
        if nm == "Retainer":
            return T(0, 0, t + 0.4)
        if nm == "Grip ring":
            return T(*polar(43, 90 + ring), t + 0.4 + (c - 1) * t)
        if nm == "Ring pivot spacer":
            return T(*ring_pin(c - 1), t + 0.2)
        if nm == "Coupler":
            (px, py), (sx, sy) = ring_pin(c - 1), polar(out, guide(c - 1))
            return T(px, py, 2 * t + 1) @ R("Z", math.degrees(math.atan2(sy - py, sx - px)))
        if nm == "Inner pin spacer":
            j, k = divmod(c - 1, 2)
            return T(*polar(out, guide(j)), k * t)
        if nm == "Outer pin spacer":
            j, k = divmod(c - 1, 3)
            return T(*polar(out + spacing, guide(j)), k * t)
        if nm == "Petal":
            return T(*polar(out, guide(c - 1)), 3 * t + 1.5) @ R("Z", guide(c - 1))
        return None

    def bolt(x, y, z0, z1):
        return ((x, y, z0), (x, y, z1), 4, "steel", 24)

    def sleeve(x, y, z0, z1):
        return ((x, y, z0), (x, y, z1), 6, "brass", 32)

    def shim(x, y, z0, z1):
        return ((x, y, z0), (x, y, z1), 11, "steel", 32)

    bottom = -2 * t
    # Centre bolt through base, hub and retainer
    pins = [bolt(0, 0, bottom - 2, 2 * t + 5), nut(0, 0, 2 * t + 0.4)]
    # Stop sleeves through the arc slots, washer and nut on the sleeve end
    for ang in (0, 180):
        x, y = polar(42, ang)
        pins += [sleeve(x, y, 0, t + 0.4), shim(x, y, t + 0.4, t + 1.2), bolt(x, y, bottom - 2, t + 5.5),
                 nut(x, y, t + 1.2)]
    # Feet: countersunk flush in the base, nut in the recess under the cap
    for k in range(n):
        x, y = polar(65, guide(k + 0.5))
        pins += [bolt(x, y, -3 * t - 4, 0), nut(x, y, -3 * t, -1)]
    # Grip: countersunk up through the ring, sleeve standing on the ring
    x, y = polar(43, 90 + ring)
    pins += [sleeve(x, y, t + 0.2, 6 * t + 0.6), bolt(x, y, 0.2, 6 * t + 5), nut(x, y, 6 * t + 0.6)]
    for k in range(n):
        # Ring pin: sleeve on the ring, spacer and 0.8 mm of shims under the coupler
        x, y = ring_pin(k)
        pins += [sleeve(x, y, t + 0.2, 3 * t + 1.2), shim(x, y, 2 * t + 0.2, 2 * t + 1), bolt(x, y, 0.2, 3 * t + 6),
                 shim(x, y, 3 * t + 1.2, 3 * t + 2), nut(x, y, 3 * t + 2)]
        # Petal pins: bolts down from above, sleeves through the slot, shims
        # on the spacer packs, washer and nut under the base
        for r, z in ((out, 2 * t), (out + spacing, 3 * t)):
            x, y = polar(r, guide(k))
            pins += [sleeve(x, y, bottom - 0.3, 3 * t + 1.5), shim(x, y, z, z + (1 if r == out else 1.5)),
                     bolt(x, y, bottom - 5, 4 * t + 1.5), nut(x, y, 4 * t + 1.5, h=2.8),
                     shim(x, y, bottom - 1.1, bottom - 0.3), nut(x, y, bottom - 1.1, -1)]
    return place, pins


def index_sequencer(t=3, n=4, c=90, theta=-18):
    """The guide's stack, base underside at z 0: feet below, the driver
    (arm, then locking disc) on A at the origin, the wheel block (wheel,
    hubs, dial) on its pedestal at B = (c, 0), the pointer on spacers above
    it and the grip on its sleeve. theta turns the driver from the pin
    pointing at B; the wheel follows the pin while it is in a slot and
    waits, locked, for the rest of the turn."""
    alpha = 180 / n
    r = c * math.sin(math.radians(alpha))
    rim = math.hypot(c * math.cos(math.radians(alpha)), 3)
    grip = 0.48 * r
    # Turn k of the driver indexes the wheel 360 / n further, so the wheel
    # angle runs on from turn to turn
    k = math.floor((theta + 180) / 360)
    th = theta - 360 * k
    if abs(th) <= 90 - alpha:
        # The slot points from B at the pin
        px, py = polar(r, th)
        wheel = math.degrees(math.atan2(py, px - c)) % 360 - 180
    else:
        wheel = -alpha if th > 0 else alpha
    wheel -= 360 / n * k
    feet = [(x, y) for x in (-r - 8, c + rim + 8) for y in (-rim - 8, rim + 8)]

    def driver(z):
        return T(0, 0, z) @ R("Z", theta)

    def output(z):
        return T(c, 0, z) @ R("Z", wheel)

    def place(p, parts):
        name, k = p["name"], p["copy"]
        if name == "Base":
            return T(0, 0, (k - 1) * t)
        if name == "Foot ring":
            j, i = divmod(k - 1, 3)
            return T(*feet[j], -3 * t + i * t)
        if name == "Foot cap":
            return T(*feet[k - 1], -4 * t)
        if name == "Output pedestal":
            return T(c, 0, 2 * t + (k - 1) * t)
        if name == "Driver arm":
            return driver(2 * t + 0.5 + (k - 1) * t)
        if name == "Locking disc":
            return driver(4 * t + 0.5 + (k - 1) * t)
        if name == "Grip ring":
            return driver(6 * t + 1.5 + (k - 1) * t) @ T(-grip)
        if name == "Geneva wheel":
            return output(4 * t + 1 + (k - 1) * t)
        if name == "Output hub":
            return output(6 * t + 1 + (k - 1) * t)
        if name == "Station dial":
            return output(10 * t + 1)
        if name == "Pointer spacer":
            return T(c, 0, 11 * t + 2.5 + (k - 1) * t)
        if name == "Pointer":
            return T(c, 0, 13 * t + 2.5)
        return None

    def disc(x, y, z0, z1, d=10):
        return ((x, y, z0), (x, y, z1), d, "steel", 32)

    pin, grip_at = polar(r, theta), polar(grip, theta + 180)
    dowel_in, dowel_out = polar(10, theta + 180), polar(10, wheel + 180)
    # Driver: sleeve 4t + 1.2 from the base, shims under the arm and over the disc
    top_a = 6 * t + 1.2
    pins = [((0, 0, -3), (0, 0, top_a + 6), 4, "steel", 24), nut(0, 0, 0, -1),
            ((0, 0, 2 * t), (0, 0, top_a), 6, "brass", 32),
            disc(0, 0, 2 * t, 2 * t + 0.5), disc(0, 0, 6 * t + 0.5, 6 * t + 1),
            disc(0, 0, top_a, top_a + 0.8, 11), nut(0, 0, top_a + 0.8),
            ((*dowel_in, 2 * t + 0.5), (*dowel_in, 6 * t + 0.5), 2, "dowel", 16)]
    # Wheel: sleeve 7t + 1.7 from the pedestal, then the pointer's stack
    top_b = 11 * t + 1.7
    pins += [((c, 0, -3), (c, 0, 14 * t + 7.5), 4, "steel", 24), nut(c, 0, 0, -1),
             ((c, 0, 4 * t), (c, 0, top_b), 6, "brass", 32),
             disc(c, 0, 4 * t, 4 * t + 1), disc(c, 0, 11 * t + 1, 11 * t + 1.5),
             disc(c, 0, top_b, top_b + 0.8, 11), nut(c, 0, 14 * t + 2.5),
             ((c + dowel_out[0], dowel_out[1], 4 * t + 1), (c + dowel_out[0], dowel_out[1], 11 * t + 1), 2, "dowel", 16)]
    # Drive pin: a 2t + 0.8 sleeve on a flush flat-head bolt, small washer and nut clear of the wheel
    top_p = 6 * t + 1.3
    pins += [((*pin, 2 * t + 0.5), (*pin, top_p + 5.2), 4, "steel", 24),
             ((*pin, 4 * t + 0.5), (*pin, top_p), 6, "brass", 32),
             disc(*pin, top_p, top_p + 0.5, 9), nut(*pin, top_p + 0.5)]
    # Grip: a 5t + 1.7 sleeve on the locking disc, shims at both ends of the rings
    top_g = 11 * t + 2.2
    pins += [((*grip_at, 2 * t + 0.5), (*grip_at, top_g + 6), 4, "steel", 24),
             ((*grip_at, 6 * t + 0.5), (*grip_at, top_g), 6, "brass", 32),
             disc(*grip_at, 6 * t + 0.5, 6 * t + 1.5), disc(*grip_at, 11 * t + 1.5, 11 * t + 2),
             disc(*grip_at, top_g, top_g + 0.8, 11), nut(*grip_at, top_g + 0.8)]
    return place, pins


def vault(t=3, h=90, codes=(3, 1, 7), lid_lift=45, lid_back=0, slide=10, spin=(0, 0, 0)):
    """The box on its base, front at y 0: doubled front and rear walls, side
    walls, corner and floor cleats, lid ledges. Everything else hangs from
    the lid and is lifted with it by lid_lift (and moved back by lid_back):
    bearing pads, rotors (gate wheel, three hub discs, dial) turned to the
    code, the fence on its spacers and keepers, slid back by slide with the
    knob, and the rear tongues on their spacers. spin turns each rotor off
    its code, in degrees."""
    w, d = 260, 180
    dial_x, guide_x, tongue_x = (70, 130, 190), (35, 225), (45, 195)
    lid = T(0, lid_back, lid_lift)
    turn = [36 * k + s for k, s in zip(codes, spin)]

    def wall(y):
        """A front or rear wall standing on the base, its back face at y."""
        return T(0, y, t) @ R("X", 90)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T()
        if n == "Front wall":
            return wall(t)
        if n == "Front inner wall":
            return wall(2 * t)
        if n == "Rear inner wall":
            return wall(d - t)
        if n == "Rear wall":
            return wall(d)
        if n == "Side wall":
            return T(0 if c == 1 else w - t, 2 * t, t) @ SIDEWAYS
        if n == "Corner cleat":
            # Pairs of strips in the four corners, against the inner walls
            j, k = divmod(c - 1, 2)
            x = t if j % 2 == 0 else w - t - 12
            y = 3 * t + k * t if j < 2 else d - 2 * t - k * t
            return T(x, y, t) @ R("X", 90)
        if n == "Floor cleat":
            if c <= 2:
                return T(t + 12 if c == 1 else w - t, 40, t) @ R("Z", 90)
            return T(80, 2 * t if c == 3 else d - 2 * t - 12, t)
        if n == "Lid ledge":
            j, k = divmod(c - 1, 2)
            return T(t + 12 if j == 0 else w - t, 50, h - 2 * t + k * t) @ R("Z", 90)
        if n == "Lid":
            return lid @ T(0, 0, h)
        if n == "Bearing pad":
            j, k = divmod(c - 1, 2)
            return lid @ T(dial_x[j], 75, h - 2 * t + k * t)
        if n == "Rear tongue":
            return lid @ T(tongue_x[c - 1], d - t - 22.5, h - 3 * t)
        if n == "Tongue spacer":
            j, k = divmod(c - 1, 2)
            return lid @ T(tongue_x[j], d - t - 22.5, h - 2 * t + k * t)
        if n.startswith("Gate wheel "):
            j = int(n.split()[2].rstrip(",")) - 1
            return lid @ T(dial_x[j], 75, h - 3 * t - 0.5) @ R("Z", turn[j])
        if n == "Hub disc":
            j, k = divmod(c - 1, 3)
            return lid @ T(dial_x[j], 75, h - 2 * t - 0.5 + k * t) @ R("Z", turn[j])
        if n == "Dial":
            return lid @ T(dial_x[c - 1], 75, h + t) @ R("Z", turn[c - 1])
        if n == "Fence":
            return lid @ T(0, slide, h - 3 * t)
        if n == "Fence spacer":
            j, k = divmod(c - 1, 2)
            return lid @ T(guide_x[j], 29, h - 2 * t + k * t)
        if n == "Fence keeper":
            return lid @ T(guide_x[c - 1], 29, h - 4 * t - 0.4)
        if n == "Knob stem":
            return lid @ T(130, 20 + slide, h - 2 * t + 1 + (c - 1) * t)
        if n == "Knob":
            return lid @ T(130, 20 + slide, h + t + 1)
        return None

    def lifted(x, y, z):
        return x, y + lid_back, z + lid_lift

    def rod(x, y, z0, z1, dia, kind="steel", sides=24):
        return (lifted(x, y, z0), lifted(x, y, z1), dia, kind, sides)

    def bolt(x, y, top, bottom, dia, washer, nut_d, nut_h):
        """A bolt with its head and a washer on top, a washer and nut below."""
        return [rod(x, y, bottom - 0.8 - nut_h - 1, top + 0.8 + nut_h, dia),
                rod(x, y, top, top + 0.8, washer, sides=32), nut(*lifted(x, y, top + 0.8), d=nut_d, h=nut_h),
                rod(x, y, bottom - 0.8, bottom, washer, sides=32), nut(*lifted(x, y, bottom - 0.8), up=-1, d=nut_d, h=nut_h)]

    pins = []
    for x, a in zip(dial_x, turn):
        # M4 rotor bolt, the 0.5 mm shim under the dial, two 2 mm pins
        pins += bolt(x, 75, h + 2 * t, h - 3 * t - 0.5, 4, 9, 7.9, 3.2)
        pins.append(rod(x, 75, h + t - 0.5, h + t, 9, sides=32))
        for px, py in ((6, 0), (0, 6)):
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            pins.append(rod(x + px * ca - py * sa, 75 + px * sa + py * ca, h - 3 * t - 0.5, h + 2 * t, 2, sides=12))
    for x in guide_x:
        # M3 guide bolt through the lid, a brass sleeve 3t + 0.4 long and the keeper
        pins += bolt(x, 29, h + t, h - 4 * t - 0.4, 3, 7, 6.4, 2.4)
        pins.append(rod(x, 29, h - 3 * t - 0.4, h, 6, "brass", 32))
    # Knob bolt, with the 1 mm packing washer between the fence and the stem
    pins += bolt(130, 20 + slide, h + 2 * t + 1, h - 3 * t, 4, 9, 7.9, 3.2)
    pins.append(rod(130, 20 + slide, h - 2 * t, h - 2 * t + 1, 9, sides=32))
    return place, pins


def inversor(t=3, s=60, line=140, swing=30, paper=True):
    """The base on its feet, the fixed posts at O and Q, then the links on
    five layers: input link (h t), short link AB and pen link PD (h 3t),
    short link AD and pen link PB (h 5t), arm OB (h 7t), arm OD (h 9t), h
    above the base. Every moving joint stands on a glide; the pencil is the
    pin at P and the paper is under its sleeve. swing is the input link's
    angle at Q from the axis OQ, between the stops at -44.3 and 44.3 degrees
    (line 140); paper lays a strip under the pencil with the line drawn from
    the lower stop up to the pencil."""
    arm, crank = 150, 55
    W, Dp = 255, 240
    ox, oy = 35, Dp / 2
    line_x = (arm * arm - s * s) / (2 * crank)
    half = line / 2
    sw = 2 * math.degrees(math.atan(half / line_x))
    stop_a = sw + math.degrees(math.asin(10 / 35))
    Z0 = 2 * t            # top of the base

    def meet(p, r1, q, r2, sgn):
        vx, vy = q[0] - p[0], q[1] - p[1]
        d = math.hypot(vx, vy)
        a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h = math.sqrt(max(0, r1 * r1 - a * a))
        return (p[0] + vx * a / d - vy * h / d * sgn, p[1] + vy * a / d + vx * h / d * sgn)

    ax, ay = polar(crank, swing)
    A = (crank + ax, ay)
    B = meet((0, 0), arm, A, s, 1)
    D = meet((0, 0), arm, A, s, -1)
    P = (B[0] + D[0] - A[0], B[1] + D[1] - A[1])
    rel = {"O": (0, 0), "Q": (crank, 0), "A": A, "B": B, "D": D, "P": P}
    at = {k: (ox + x, oy + y) for k, (x, y) in rel.items()}
    # Links: joint the part's first hole goes on, second joint, height h
    links = {"Input link": [("Q", "A", t)], "Short link": [("A", "B", 3 * t), ("A", "D", 5 * t)],
             "Pen link": [("D", "P", 3 * t), ("B", "P", 5 * t)], "Arm": [("O", "B", 7 * t), ("O", "D", 9 * t)]}
    # Rings stacked on the joints: (joint, h) for each copy
    spacer = [("A", 2 * t), ("A", 4 * t), ("B", 4 * t), ("B", 6 * t), ("D", 4 * t),
              ("D", 6 * t), ("D", 7 * t), ("D", 8 * t), ("O", 8 * t)]
    glide = [("A", 0), ("B", 0), ("D", 0)]
    glide_ring = [("B", t), ("B", 2 * t), ("D", t), ("D", 2 * t)]
    sleeve = [("P", h * t) for h in (0, 1, 2, 4, 6, 7, 8)]
    post = [("O", h * t) for h in range(7)] + [("Q", 0)]
    hand = 6 * t + 3.7
    feet = [(14, 14), (W - 14, 14), (14, Dp - 14), (W - 14, Dp - 14)]
    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "Foot":
            x, y = feet[(c - 1) // 2]
            return T(x, y, -(1 + (c - 1) % 2) * t)
        if n in links:
            a, b, h = links[n][c - 1]
            ang = math.degrees(math.atan2(at[b][1] - at[a][1], at[b][0] - at[a][0]))
            return T(*at[a], Z0 + h) @ R("Z", ang)
        table = {"Spacer ring": spacer, "Glide": glide, "Glide ring": glide_ring,
                 "Pencil sleeve": sleeve, "Post ring": post}
        if n in table:
            j, h = table[n][c - 1]
            return T(*at[j], Z0 + h)
        if n == "Handle grip":
            return T(*at["A"], Z0 + hand + (c - 1) * t)
        return None

    def bar(j, z0, z1, d, kind="brass", sides=32):
        x, y = at[j]
        return ((x, y, z0), (x, y, z1), d, kind, sides)

    def cap(j, z):
        """Washer and nut on top at z."""
        return [bar(j, z, z + 0.5, 9, "steel"), bar(j, z + 0.5, z + 3.7, 7.9, "brass", 6)]

    pins = []
    # Fixed pivots: bolt head under the base, bush from the base up
    for j, top in (("O", 10 * t), ("Q", 2 * t)):
        pins += [bar(j, -2.8, 0, 7, "steel"), bar(j, 0, Z0 + top + 4.5, 4, "steel", 24),
                 bar(j, Z0, Z0 + top, 6)] + cap(j, Z0 + top)
    # Moving joints: head in the glide, bush up to the top link
    for j, top in (("A", 6 * t), ("B", 8 * t), ("D", 10 * t)):
        end = Z0 + (hand + 4 * t + 3.7 + 1.5 if j == "A" else top + 4.5)
        pins += [bar(j, Z0 + 0.2, Z0 + 2.7, 7, "steel"), bar(j, Z0 + 2.7, end, 4, "steel", 24),
                 bar(j, Z0 + 2.7, Z0 + top, 6)] + cap(j, Z0 + top)
    # The handle grips turn on their own bush above the nut at A
    pins += [bar("A", Z0 + hand, Z0 + hand + 4 * t, 6)] + cap("A", Z0 + hand + 4 * t)
    # Dowel stops, glued in the base
    for sg in (1, -1):
        x, y = polar(35, sg * stop_a)
        pins.append(((ox + crank + x, oy + y, 0), (ox + crank + x, oy + y, Z0 + t + 1), 6, "dowel", 32))
    # The pencil, its tip on the paper
    px, py = at["P"]
    pins.append(((px, py, Z0 + 0.1), (px, py, Z0 + 9 * t + 30), 7, "pencil", 6))

    flats = []
    if paper:
        X = ox + line_x
        rect = [(X - 11, oy - half - 12), (X + 11, oy - half - 12), (X + 11, oy + half + 12), (X - 11, oy + half + 12)]
        # Drawn from the lower stop up to where the pencil is now
        flats.append({"rings": [rect], "z": Z0, "depth": 0.1, "color": "#f7f4ee",
                      "lines": [[(X, oy - half), (X, py)]], "line_color": "#3d3d48", "line_width": 0.6})
    return place, pins, flats


def weave_drawing(teeth=63, left=40, right=32, arm=200, step=5):
    """The pintograph as weave.kerf computes it: disc and drive centres,
    and pen(a) giving both pins and the pencil at crank angle a."""
    m, z0, z1, s = 2.5, 30, 60, 95
    c1, c2 = (z0 + z1) * m / 2, (z0 + teeth) * m / 2
    gx = (c1 * c1 - c2 * c2) / (4 * s)
    G = (gx, -math.sqrt(c1 * c1 - (gx + s) ** 2))

    def pen(a):
        p1 = polar(left, 90 - a * z0 / z1)
        p2 = polar(right, 90 - a * z0 / teeth)
        P1, P2 = (p1[0] - s, p1[1]), (p2[0] + s, p2[1])
        vx, vy = P2[0] - P1[0], P2[1] - P1[1]
        d = math.hypot(vx, vy)
        h = math.sqrt(arm * arm - d * d / 4)
        return P1, P2, (P1[0] + vx / 2 - vy * h / d, P1[1] + vy / 2 + vx * h / d)

    turns = teeth // math.gcd(z1, teeth) * z1 // z0
    curve = [pen(i * step)[2] for i in range(turns * 360 // step + 1)]
    return s, G, pen, curve


def weave(t=3, teeth=63, left=40, right=32, arm=200, theta=340):
    """Base on four feet, two axle spacers round each axle, the discs and
    drive gear on brass bushes, the crank pins with their spacers, the left
    arm with the pen sleeve under it and the right arm on top, the handle
    on the drive gear and the A5 paper with the whole drawing on it. theta
    turns the crank; the discs follow at -30/60 and -30/teeth of it."""
    s, G, pen, curve = weave_drawing(teeth, left, right, arm)
    # The drawing for the paper, sampled finer, as the kerf does for the box
    ys = [p[1] for p in weave_drawing(teeth, left, right, arm, 5)[3]]
    xs = [p[0] for p in curve]
    paper_y = min(min(ys) - 8, max(88, (min(ys) + max(ys)) / 2 - 74))
    by0, by1 = -116, math.ceil(paper_y + 148 + 10)
    feet = [(-167.5, by0 + 20), (167.5, by0 + 20), (-167.5, by1 - 20), (167.5, by1 - 20)]
    D1, D2 = (-s, 0), (s, 0)
    axles = [D1, D2, G]
    P1, P2, P = pen(theta)
    turn1, turn2 = -theta * 30 / 60, -theta * 30 / teeth
    H = (G[0] + polar(24, theta)[0], G[1] + polar(24, theta)[1])
    zg = 4 * t                 # gears, two plies
    zn = 6 * t + 3.2           # top of the nut on a disc
    za, zb = zn + t, zn + 2 * t  # left arm on one spacer, right arm on two
    heading = lambda A: math.degrees(math.atan2(P[1] - A[1], P[0] - A[0]))

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "Foot":
            j, k = divmod(c - 1, 2)
            return T(*feet[j], -2 * t + k * t)
        if n == "Axle spacer":
            j, k = divmod(c - 1, 2)
            return T(*axles[j], 2 * t + k * t)
        if n == "Left disc":
            return T(*D1, zg + (c - 1) * t) @ R("Z", turn1)
        if n == "Right disc":
            return T(*D2, zg + (c - 1) * t) @ R("Z", turn2)
        if n == "Drive gear":
            return T(*G, zg + (c - 1) * t) @ R("Z", theta)
        if n == "Pin spacer":
            return T(*P1, zn) if c == 1 else T(*P2, zn + (c - 2) * t)
        if n == "Arm":
            return T(*P1, za) @ R("Z", heading(P1)) if c == 1 else T(*P2, zb) @ R("Z", heading(P2))
        if n == "Pen sleeve":
            return T(*P, za - (4 - c) * t)
        if n == "Handle":
            return T(*H, 6 * t + 4 + (c - 1) * t)
        return None

    pins = []
    # Axles: M4 bolt up from under the base, the bush on the base, a washer
    # and nut clamping it over the gear
    for x, y in axles:
        pins += [nut(x, y, 0, -1), ((x, y, -3.2), (x, y, 6 * t + 5), 4, "steel", 24),
                 ((x, y, 2 * t), (x, y, 6 * t + 0.2), 6, "brass", 32),
                 ((x, y, 6 * t + 0.2), (x, y, 6 * t + 1), 10, "steel", 32), nut(x, y, 6 * t + 1)]
    # Crank pins: bolt up through the disc, nutted on it, the bush up through
    # the spacers and the arm, a washer and nut on top
    for (x, y), top in ((P1, za + t), (P2, zb + t)):
        pins += [nut(x, y, zg, -1), ((x, y, zg - 3.2), (x, y, top + 4.7), 4, "steel", 24), nut(x, y, 6 * t),
                 ((x, y, zn), (x, y, top + 0.2), 6, "brass", 32),
                 ((x, y, top + 0.2), (x, y, top + 1), 10, "steel", 32), nut(x, y, top + 1)]
    # Handle: bolt through the drive gear, nutted on it, the bush and the
    # five rings between two washers
    x, y = H
    pins += [nut(x, y, zg, -1), ((x, y, zg - 3.2), (x, y, 11 * t + 8.7), 4, "steel", 24), nut(x, y, 6 * t),
             ((x, y, 6 * t + 3.2), (x, y, 6 * t + 4), 10, "steel", 32),
             ((x, y, 6 * t + 3.2), (x, y, 11 * t + 4.2), 6, "brass", 32),
             ((x, y, 11 * t + 4.2), (x, y, 11 * t + 5), 10, "steel", 32), nut(x, y, 11 * t + 5)]
    # The pencil, from the paper up through the sleeve and both arms
    pins.append(((P[0], P[1], 2 * t + 0.1), (P[0], P[1], zb + t + 30), 7, "pencil", 6))
    flats = [{"rings": [[(-105, paper_y), (105, paper_y), (105, paper_y + 148), (-105, paper_y + 148)]],
              "z": 2 * t, "depth": 0.1, "color": "#f7f4ee",
              "lines": [curve], "line_color": "#3d6f7d", "line_width": 0.4}]
    return place, pins, flats


def echo(t=3, ratio=2.5, sx=0.5, sy=0.8):
    """The base board flat on the table, top at z 0, with the anchor blocks
    on it; the anchor arm and stylus arm on the glide feet, the link and the
    pencil arm above them. ratio picks the holes; the stylus is at (sx, sy)
    across the original's square, 0 to 1 each way (the default is on the
    drawing). The pencil and the two sheets of paper follow."""
    a, n = 240, 72
    O = (40, 115)
    zones = {1.5: (230, 112, 64), 2: (180, 115, 82), 2.5: (152, 119, 86), 3: (138, 122, 80), 4: (132, 120, 58)}
    cx, cy, s = zones[ratio]
    S = (cx - s / 2 + s * sx, cy - s / 2 + s * sy)

    # Two-link solution for the stylus: a / ratio along u from X, n along v
    p = a / ratio
    dx, dy = S[0] - O[0], S[1] - O[1]
    r = math.hypot(dx, dy)
    phi = math.acos((r * r - p * p - n * n) / (2 * p * n))
    ua = math.atan2(dy, dx) - math.atan2(-n * math.sin(phi), p + n * math.cos(phi))
    va = ua - phi
    u, v = (math.cos(ua), math.sin(ua)), (math.cos(va), math.sin(va))
    B = (O[0] + a * u[0], O[1] + a * u[1])
    X = (O[0] + n * v[0], O[1] + n * v[1])
    C = (B[0] + n * v[0], B[1] + n * v[1])
    P = (B[0] + ratio * n * v[0], B[1] + ratio * n * v[1])
    du, dv = math.degrees(ua), math.degrees(va)
    low, high = 2 * t, 3 * t + 0.5

    def place(p_, parts):
        nm, c = p_["name"], p_["copy"]
        if nm == "Base board":
            return T(0, 0, -t)
        if nm == "Nut block":
            return T(*O, 0)
        if nm == "Anchor block":
            return T(*O, t)
        if nm == "Anchor arm":
            return T(*O, low) @ R("Z", du)
        if nm == "Stylus arm":
            return T(*X, low) @ R("Z", du)
        if nm == "Link":
            return T(*O, high) @ R("Z", dv)
        if nm == "Pencil arm":
            return T(*B, high) @ R("Z", dv)
        if nm == "Glide foot":
            j, k = divmod(c - 1, 2)
            return T(*(B, C, X)[j], k * t)
        if nm == "Stylus collar":
            return T(*S, 3 * t + (c - 1) * t)
        if nm == "Pencil guide":
            return T(*P, 4 * t + 0.5 + (c - 1) * t)
        return None

    def bar(q, z0, z1, d, kind, sides=32):
        return ((q[0], q[1], z0), (q[0], q[1], z1), d, kind, sides)

    top = 4 * t + 0.5
    pins = []
    # Moving joints: bolt head and washer inside the feet, sleeve through both
    # arms, an M6 washer between them, washer and nut on top
    for q in (B, C, X):
        pins += [bar(q, low - 3.4, top + 5, 4, "steel", 24), bar(q, low - 3.4, low - 0.6, 7.9, "steel", 6),
                 bar(q, low - 0.6, low - 0.1, 8, "steel"), bar(q, low - 0.1, top + 0.1, 6, "brass"),
                 bar(q, 3 * t, 3 * t + 0.5, 12, "steel"),
                 bar(q, top + 0.1, top + 0.6, 8, "steel"), bar(q, top + 0.6, top + 3.8, 7.9, "brass", 6)]
    # The anchor: bolt from above into the nut held in the hex hole
    pins += [bar(O, -t + 0.1, top + 0.6, 4, "steel", 24), bar(O, t - 3.2, t, 7.9, "brass", 6),
             bar(O, low, top + 0.1, 6, "brass"), bar(O, 3 * t, 3 * t + 0.5, 12, "steel"),
             bar(O, top + 0.1, top + 0.6, 8, "steel"), bar(O, top + 0.6, top + 3.4, 7.9, "steel", 6)]
    # Stylus: an 8 mm dowel resting on the paper; pencil through its guide
    pins += [bar(S, 0.15, 5 * t + 32, 8, "dowel"), bar(P, 0.15, 7 * t + 95, 7.5, "pencil", 6)]

    # The original, a five-petal flower, and the copy the pencil has drawn
    def flower(c0, size, k=1.0):
        out = []
        for i in range(721):
            th = math.radians(90 + i / 2)
            rr = 0.30 * size * (1 + 0.25 * math.cos(5 * th))
            q = (c0[0] + rr * math.cos(th), c0[1] + rr * math.sin(th))
            out.append((O[0] + k * (q[0] - O[0]), O[1] + k * (q[1] - O[1])))
        return out

    def middle(c0, size, k=1.0):
        out = []
        for i in range(97):
            th = 2 * math.pi * i / 96
            q = (c0[0] + 0.07 * size * math.cos(th), c0[1] + 0.07 * size * math.sin(th))
            out.append((O[0] + k * (q[0] - O[0]), O[1] + k * (q[1] - O[1])))
        return out

    def sheet(c0, size):
        h = size / 2
        return [[(c0[0] - h, c0[1] - h), (c0[0] + h, c0[1] - h), (c0[0] + h, c0[1] + h), (c0[0] - h, c0[1] + h)]]

    kc = (O[0] + ratio * (cx - O[0]), O[1] + ratio * (cy - O[1]))
    flats = [{"rings": sheet((cx, cy), s), "z": 0, "depth": 0.15, "color": "#f7f4ee",
              "lines": [flower((cx, cy), s), middle((cx, cy), s)], "line_color": "#1f2a44", "line_width": 0.6},
             {"rings": sheet(kc, ratio * s), "z": 0, "depth": 0.15, "color": "#f7f4ee",
              "lines": [flower((cx, cy), s, ratio), middle((cx, cy), s, ratio)], "line_color": "#4a4a4a",
              "line_width": 0.8}]
    return place, pins, flats


def peck(t=3, n=6, D=240, swing=165, reach=30):
    """The paddle top surface at z 0, handle towards -y, the hens standing on
    it facing the middle and the weight hanging below on the strings. swing
    is where the swing pulls, in degrees round the paddle: the weight is
    swung out reach mm the opposite way, so the hen nearest swing pecks with
    her beak on the board, her neighbours bow part way and the rest stand
    with their heads up on slack strings."""
    P, H, plate_r, drop, hub = (0.0, 18.0), (7.0, 0.0), 8, 110, 6
    A = (P[0] + 11 * math.cos(math.radians(15)), P[1] + 11 * math.sin(math.radians(15)))
    beak = (33.0, 38.0)
    # The head and neck outline, as in the program, for where the string
    # leaves the neck
    neck = [(0, 18), (13.9, 16.1), (16.5, 21), (21, 28), (23, 30), (24.5, 33), (28, 35.5), (33, 38), (28, 40), (27, 43),
            (24, 46.5), (23, 49), (21, 48), (19.5, 50.5), (17.5, 49), (15.5, 50), (15, 46.5), (13.5, 42), (10, 36), (5, 29), (0, 24)]
    ring = D / 2 - 60
    rho = math.hypot(beak[0] - P[0], beak[1] - P[1])
    tip = math.degrees(math.atan2(beak[1] - P[1], beak[0] - P[0]) + math.asin(P[1] / rho))
    angles = [90 + 180 / n + 360 * i / n for i in range(n)]

    def rp(q, a):
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        return (P[0] + c * (q[0] - P[0]) - s * (q[1] - P[1]), P[1] + s * (q[0] - P[0]) + c * (q[1] - P[1]))

    def s_of(a):
        """String from the neck to the top of the paddle hole, head at a."""
        q = rp(A, a)
        return math.hypot(q[0] - H[0], q[1] - H[1])

    def head_for(s):
        if s >= s_of(0):
            return 0.0
        lo, hi = -tip, 0.0
        for _ in range(50):
            mid = (lo + hi) / 2
            if s_of(mid) > s:
                hi = mid
            else:
                lo = mid
        return (lo + hi) / 2

    # The weight's knot: the far string pulls its head right down and the
    # weight hangs as low as that lets it; the others are as long as they
    # need to be, or slack with the head up
    s_up = s_of(0)
    l_up = math.hypot(ring - H[0] - plate_r, drop)
    l_max = l_up + s_up - s_of(-tip)
    kx, ky = polar(reach, swing + 180)
    holes = [polar(ring - H[0], a) for a in angles]
    ends = [(kx + polar(plate_r, a)[0], ky + polar(plate_r, a)[1]) for a in angles]
    flat = [math.hypot(e[0] - h[0], e[1] - h[1]) for e, h in zip(ends, holes)]
    z = min(math.sqrt(l_max ** 2 - d * d) for d in flat)
    heads = [head_for(s_up - max(0.0, math.hypot(d, z) - l_up)) for d in flat]
    top = -2 * t - z  # top of the string plate

    def hen(i):
        a = angles[i]
        return T(*polar(ring, a), 0) @ R("Z", a + 180)

    def about_p(a):
        return T(P[0], P[1]) @ R("Z", a) @ T(-P[0], -P[1])

    right, middle = T(0, -0.5 * t, 0) @ R("X", 90), T(0, 0.5 * t, 0) @ R("X", 90)
    left = T(0, 0.5 * t, 0) @ R("Z", 180) @ R("X", 90)

    def place(p, parts):
        nm, c = p["name"], p["copy"]
        if nm == "Paddle top":
            return T(0, 0, -t)
        if nm == "Paddle base":
            return T(0, 0, -2 * t)
        if nm in ("Right body", "Left body", "Body spacer", "Head", "Right tail", "Left tail"):
            if c > n:
                return None
            M, a = hen(c - 1), heads[c - 1]
            if nm == "Right body":
                return M @ right
            if nm == "Left body":
                return M @ left
            if nm == "Body spacer":
                return M @ middle
            if nm == "Head":
                return M @ middle @ about_p(a)
            if nm == "Right tail":
                return M @ right @ about_p(a)
            return M @ left @ about_p(-a)
        if nm == "String plate":
            return T(kx, ky, top - t)
        if nm == "Knot ring":
            return T(kx, ky, top - 2 * t)
        if nm == "Weight disc":
            return T(kx, ky, top - 2 * t - c * t)
        return None

    def world(i, x, y, zz):
        """Hen i's frame: x forward, y to her left, z up."""
        ox, oy = polar(ring, angles[i])
        c, s = math.cos(math.radians(angles[i] + 180)), math.sin(math.radians(angles[i] + 180))
        return (ox + c * x - s * y, oy + s * x + c * y, zz)

    def inside(q, pts):
        x, y = q
        ins = False
        for k in range(len(pts)):
            (x0, y0), (x1, y1) = pts[k - 1], pts[k]
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                ins = not ins
        return ins

    pins = []
    for i in range(n):
        a = heads[i]
        pts = [rp(q, a) for q in neck]
        q0 = rp(A, a)
        # Walk down the string until it is out of the neck
        f = 0.0
        while f < 1:
            q = (q0[0] + (H[0] - q0[0]) * f, q0[1] + (H[1] - q0[1]) * f)
            if not inside(q, pts) and math.hypot(q[0] - P[0], q[1] - P[1]) > hub:
                break
            f += 0.01
        q = (q0[0] + (H[0] - q0[0]) * (f + 0.03), q0[1] + (H[1] - q0[1]) * (f + 0.03))
        hole_top, hole_bottom = world(i, H[0], 0, 0), world(i, H[0], 0, -2 * t)
        pins += [(world(i, q[0], 0, q[1]), hole_top, 0.8, "steel", 8), (hole_top, hole_bottom, 0.8, "steel", 8),
                 (hole_bottom, (ends[i][0], ends[i][1], top), 0.8, "steel", 8)]
        # The M3 pivot bolt: head on her right, nut on her left
        pins += [(world(i, P[0], -1.5 * t - 2, P[1]), world(i, P[0], 1.5 * t + 3, P[1]), 3, "steel", 16),
                 (world(i, P[0], -1.5 * t - 2, P[1]), world(i, P[0], -1.5 * t, P[1]), 5.5, "steel", 32),
                 (world(i, P[0], 1.5 * t, P[1]), world(i, P[0], 1.5 * t + 2.4, P[1]), 6.35, "brass", 6)]
    # The M4 bolt up through the weight, nut on the string plate
    low = top - 9 * t
    pins += [((kx, ky, low - 2.8), (kx, ky, low), 7, "steel", 32), ((kx, ky, low), (kx, ky, top + 4), 4, "steel", 24),
             nut(kx, ky, top)]
    return place, pins


def dabble(t=3, neck_lift=12, wing_lift=10, tail_lift=8, theta=95):
    """The box (base, end walls, guide rail, deck), the rotor on its square
    shaft (journals, rings, three cams, washers, collar, crank), the follower
    discs on their dowels, and the duck on the deck: core between the sides,
    neck and tail on their tubes, wings on the long tube. theta turns the
    crank: 0 to 190 the head dips and the tail tips up, 190 to 350 the wings
    rise and fall."""
    BL, W0, rb = 210, 6, 25
    lmax = max(neck_lift, wing_lift, tail_lift)
    z_s = 2 * t + rb + lmax + 8
    rail_z = z_s + rb + lmax + 2 * t + 3
    z_d = rail_z + 2 * t + 22 + 2 * t
    x0 = 92
    pn, rn, pw, rw, pt, rt, boss = (28, 16), 11, (10, 32), 18, (-36, 26), 14, 4
    dip, flap_at, flap = (80, 30, 80), 190, (80, 0, 80)
    asin, deg = math.asin, math.degrees

    def bump(a, L, p):
        x = a % 360
        if x < p[0]:
            return L / 2 * (1 - math.cos(math.pi * x / p[0]))
        if x < p[0] + p[1]:
            return L
        if x < sum(p):
            return L / 2 * (1 + math.cos(math.pi * (x - p[0] - p[1]) / p[2]))
        return 0

    s_n = neck_lift - bump(theta, neck_lift, dip)
    s_w = bump(theta - flap_at, wing_lift, flap)
    s_t = bump(theta, tail_lift, dip)
    un = pn[0] + rn * (1 + math.cos(asin(neck_lift / 2 / rn))) / 2
    uw = pw[0] - rw * (1 + math.cos(asin(wing_lift / 2 / rw))) / 2
    ut = pt[0] - rt * (1 + math.cos(asin(tail_lift / 2 / rt))) / 2
    # Turns of the neck (head down is negative), wings and tail (tip up is
    # negative), each about its pivot, seen from the front
    a_n = asin((s_n - neck_lift / 2) / rn)
    a_w = asin((s_w - wing_lift / 2) / rw)
    a_t = asin((s_t - tail_lift / 2) / rt)
    neck = deg(a_n - asin(neck_lift / 2 / rn))
    wing = -deg(a_w + asin(wing_lift / 2 / rw))
    tail = -deg(a_t + asin(tail_lift / 2 / rt))
    pin = (pw[0] - rw * math.cos(a_w), pw[1] + rw * math.sin(a_w))
    rods = [(un, s_n, pn[1] + s_n - neck_lift / 2 - boss),
            (uw, s_w, pin[1] - 2),
            (ut, s_t, pt[1] + s_t - tail_lift / 2 - boss)]
    xs = [x0 + u for u, _, _ in rods]
    xn, xw, xt = xs

    def on_shaft(x):
        return T(x, 0, z_s) @ SIDEWAYS

    # Spacer rings, stacked from the left end of each gap
    gaps = [(W0 + 2 * t, xt - 1.5 * t), (xt + 1.5 * t, xw - 1.5 * t),
            (xw + 1.5 * t, xn - 1.5 * t), (xn + 1.5 * t, BL - W0 - 2 * t)]
    rings = [a + k * t for a, b in gaps for k in range(int((b - a - 0.4) // t))]

    def front(y0):
        """A duck layer drawn side on, its back face at y0, facing front."""
        return T(x0, y0, z_d) @ R("X", 90)

    def back(y0):
        """A mirrored duck layer, its front face at y0, facing back."""
        return T(x0, y0, z_d) @ R("Z", 180) @ R("X", 90)

    def turn(p, a, mirrored=False):
        if mirrored:
            return T(-p[0], p[1]) @ R("Z", -a) @ T(p[0], -p[1])
        return T(*p) @ R("Z", a) @ T(-p[0], -p[1])

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Base":
            return T(0, 0, (c - 1) * t)
        if n == "End wall":
            x = W0 + (c - 1) * t if c <= 2 else BL - W0 - 2 * t + (c - 3) * t
            return T(x, 0, 0) @ SIDEWAYS
        if n == "Guide rail":
            return T(0, 0, rail_z + (c - 1) * t)
        if n == "Deck":
            return T(0, 0, z_d - 2 * t + (c - 1) * t)
        if n == "Journal":
            x = W0 + (c - 1) * t if c <= 2 else BL - W0 - 2 * t + (c - 3) * t
            return on_shaft(x) @ R("Z", theta)
        if n == "Thrust washer":
            return on_shaft(W0 - t if c == 1 else BL - W0)
        if n == "Shaft collar":
            return on_shaft(BL - W0 + c * t) @ R("Z", theta)
        if n in ("Neck cam", "Wing cam", "Tail cam"):
            x = xs[("Neck cam", "Wing cam", "Tail cam").index(n)]
            return on_shaft(x - 1.5 * t + (c - 1) * t) @ R("Z", theta)
        if n == "Spacer ring":
            return on_shaft(rings[c - 1]) if c <= len(rings) else None
        if n == "Follower disc":
            k, j = divmod(c - 1, 2)
            u, s, _ = rods[k]
            return T(x0 + u, 0, z_s + rb + s + j * t)
        if n == "Crank":
            return on_shaft(W0 - 4 * t + (c - 1) * t) @ R("Z", theta)
        if n == "Handle":
            return on_shaft(W0 - 4 * t - c * t) @ R("Z", theta) @ T(0, 30)
        if n == "Left side":
            return front(-1.5 * t - (c - 1) * t)
        if n == "Right side":
            return back(1.5 * t + (c - 1) * t)
        if n == "Body core":
            return front(-1.5 * t + c * t)
        if n == "Neck front":
            return front(0) @ turn(pn, neck)
        if n == "Neck back":
            return back(0) @ turn(pn, neck, True)
        if n == "Tail front":
            return front(0) @ turn(pt, tail)
        if n == "Tail back":
            return back(0) @ turn(pt, tail, True)
        if n == "Left wing":
            return front(-3.5 * t - 0.8) @ turn(pw, wing)
        if n == "Right wing":
            return back(3.5 * t + 0.8) @ turn(pw, wing, True)
        return None

    def across(p, y0, y1, d, kind, sides=32):
        """Hardware across the duck at duck point p, from y0 to y1."""
        return ((x0 + p[0], y0, z_d + p[1]), (x0 + p[0], y1, z_d + p[1]), d, kind, sides)

    pins = [((W0 - 4 * t - 2, 0, z_s), (BL - W0 + 3 * t + 2, 0, z_s), 6, "steel", 4)]
    # The pushrods, glued in their follower discs, up to the duck
    for u, s, top in rods:
        pins.append(((x0 + u, 0, z_s + rb + s), (x0 + u, 0, z_d + top), 6, "dowel", 32))
    # Neck and tail tubes, glued in the sides, with a washer each side of the
    # moving piece
    for p in (pn, pt):
        pins += [across(p, -3.5 * t, 3.5 * t, 6, "brass"),
                 across(p, t, t + 0.8, 10, "steel"), across(p, -t - 0.8, -t, 10, "steel")]
    # The wing tube and its bolt, washers inside and outside the wings
    e = 4.5 * t + 1.1
    pins += [across(pw, -e, e, 6, "brass"), across(pw, -e - 3.6, e + 4.2, 4, "steel", 24),
             across(pw, 3.5 * t, 3.5 * t + 0.8, 10, "steel"), across(pw, -3.5 * t - 0.8, -3.5 * t, 10, "steel"),
             across(pw, e, e + 0.8, 10, "steel"), across(pw, -e - 0.8, -e, 10, "steel"),
             across(pw, e + 0.8, e + 4, 7.9, "brass", 6), across(pw, -e - 0.8, -e - 3.6, 7, "steel")]
    # The wing pin through both wings
    pins.append(across(pin, -4.5 * t - 0.8, 4.5 * t + 0.8, 4, "steel"))
    # Handle bolt: head between the crank and the wall, nut outside the grips
    hy, hz = -30 * math.sin(math.radians(theta)), z_s + 30 * math.cos(math.radians(theta))
    pins += [((W0 - t + 2.8, hy, hz), (W0 - 10 * t - 4.2, hy, hz), 4, "steel", 24),
             ((W0 - t, hy, hz), (W0 - t + 2.8, hy, hz), 7, "steel", 32),
             ((W0 - 10 * t, hy, hz), (W0 - 10 * t - 3.2, hy, hz), 7.9, "brass", 6)]
    return place, pins


def lambda_(t=3, gap=92, theta=0):
    """Two side frames joined by end plates; on each frame a lambda outside
    and one inside, on the shared square shaft: rocker, eccentric with its
    coupler, then the leg hanging from P. theta turns the shaft; the four
    eccentrics are a quarter turn apart. The legs hang plumb, so every
    point of a leg follows its P, and the soles in stance stand on z = 0."""
    r, H = 15, 55
    L = 2.5 * r
    out_face, in_face = gap / 2 + 2 * t, gap / 2
    front = math.ceil(4.36 * r + 60 / 2 + 6)

    def meet(p, r1, q, r2, sgn):
        vx, vy = q[0] - p[0], q[1] - p[1]
        d = math.hypot(vx, vy)
        a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h = math.sqrt(max(0, r1 * r1 - a * a))
        return (p[0] + vx * a / d - vy * h / d * sgn, p[1] + vy * a / d + vx * h / d * sgn)

    def joints(a):
        """Crank pin B, rocker joint C and foot point P in the side view (x, z)."""
        B = polar(r, a)
        C = meet(B, L, (2 * r, 0), L, 1)
        P = (2 * C[0] - B[0], 2 * C[1] - B[1])
        return {k: (x, z + H) for k, (x, z) in zip("BCP", (B, C, P))}

    # Legs: side (-1 right, 1 left), outside or in, and the eccentric's phase
    legs = [(-1, True, 0), (-1, False, 180), (1, True, 90), (1, False, 270)]
    J = [joints(theta + ph) for _, _, ph in legs]
    A, D = (0, H), (2 * r, H)

    def span(k, s0, s1):
        """World y from s0 to s1 out from the frame face, leg k's side."""
        side, outside, _ = legs[k]
        a, b = (out_face + s0, out_face + s1) if outside else (in_face - s0, in_face - s1)
        return side * a, side * b

    def top(k, s0, s1):
        return max(span(k, s0, s1))

    def flat_at(x, y, z, a=0):
        """A part drawn in the side view, its back face at y."""
        return T(x, y, z) @ upright() @ R("Z", a)

    def ang(p, q):
        return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))

    lay = {"collar": 0.5, "rocker": 4, "ecc": 8 + t, "leg": 12 + 3 * t,
           "ring_d": 0.5, "ring_c": 7.5, "ring_p": 17.5, "handle": 17 + 5 * t}

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Right frame":
            return T(0, -in_face - (2 - c) * t, 0) @ upright()
        if n == "Left frame":
            return T(0, in_face + (2 - c) * t, 0) @ R("Z", 180) @ upright()
        if n == "Front plate":
            return T(front, 0, 0) @ SIDEWAYS
        if n == "Rear plate":
            return T(-56, 0, 0) @ SIDEWAYS
        if n == "Journal":
            return flat_at(0, (-in_face - t, -in_face, in_face + t, out_face)[c - 1], H, theta)
        if n == "Thrust collar":
            k = c - 1
            return flat_at(0, top(k, lay["collar"], lay["collar"] + t), H, theta + legs[k][2])
        if n == "Rocker":
            k = c - 1
            return flat_at(D[0], top(k, lay["rocker"], lay["rocker"] + t), D[1], ang(D, J[k]["C"]))
        if n in ("Eccentric", "Coupler", "Leg"):
            k, ply = divmod(c - 1, 2)
            s0 = (lay["leg"] if n == "Leg" else lay["ecc"]) + ply * t
            y = top(k, s0, s0 + t)
            j = J[k]
            if n == "Eccentric":
                return flat_at(0, y, H, theta + legs[k][2])
            if n == "Coupler":
                return flat_at(j["B"][0], y, j["B"][1], ang(j["B"], j["P"]))
            return flat_at(j["P"][0], y, j["P"][1])
        if n == "Spacer ring":
            k, w = divmod(c - 1, 3)
            at = (D, J[k]["C"], J[k]["P"])[w]
            s0 = lay[("ring_d", "ring_c", "ring_p")[w]]
            return flat_at(at[0], top(k, s0, s0 + t), at[1])
        if n == "Handle":
            s0 = lay["handle"] + (c - 1) * t
            return flat_at(0, top(0, s0, s0 + t), H, theta + 200)
        if n == "Handle grip":
            s0 = lay["handle"] + 2 * t + 0.5 + (c - 1) * t
            gx, gz = polar(35, theta + 200)
            return flat_at(gx, top(0, s0, s0 + t), H + gz)
        return None

    def bar(x, z, y0, y1, d, kind, sides=32):
        return ((x, y0, z), (x, y1, z), d, kind, sides)

    def pivot(x, z, ya, yb):
        """A 6 mm brass bush from ya to yb on an M4 bolt: washer and head
        beyond ya, washer and nut beyond yb."""
        u = 1 if yb > ya else -1
        return [bar(x, z, ya - u * 3.3, yb + u * 3.9, 4, "steel", 24), bar(x, z, ya, yb, 6, "brass"),
                bar(x, z, ya, ya - u * 0.5, 8, "steel"), bar(x, z, ya - u * 0.5, ya - u * 3.3, 7.9, "steel", 6),
                bar(x, z, yb, yb + u * 0.5, 8, "steel"), bar(x, z, yb + u * 0.5, yb + u * 3.7, 7.9, "brass", 6)]

    left_end = out_face + lay["ecc"] + 2 * t
    right_end = out_face + lay["handle"] + 2 * t
    pins = [bar(0, H, left_end + 0.5, -right_end - 1.5, 6, "steel", 4)]
    for side in (-1, 1):
        # The fixed bush at D runs from one rocker's outer face to the other's
        pins += pivot(D[0], D[1], side * (out_face + lay["rocker"] + t), side * (in_face - lay["rocker"] - t))
    for k in range(4):
        j = J[k]
        a, b = span(k, lay["rocker"], lay["ecc"] + 2 * t)
        pins += pivot(*j["C"], a, b)
        a, b = span(k, lay["ecc"], lay["leg"] + 2 * t)
        pins += pivot(*j["P"], a, b)
    gx, gz = polar(35, theta + 200)
    # The grip discs turn on a bush, bolted through the handle
    a, b = span(0, lay["handle"], lay["handle"] + 2 * t + 0.5 + 5 * t)
    m = span(0, lay["handle"], lay["handle"] + 2 * t)[1]
    pins += pivot(gx, H + gz, a, b)[2:] + [bar(gx, H + gz, a + 3.3, b - 3.9, 4, "steel", 24),
                                           bar(gx, H + gz, m, b, 6, "brass")]
    return place, pins


# "lambda" is a Python keyword, so the function is lambda_; the audit looks
# it up by the slug


def crawl_leg(u=80, theta=0, rear=False):
    """Klann's leg (patent proportions, u mm per unit) with the crank pin at
    theta, about the crank axle, in the program's side view: front legs reach
    forward (+x), rear legs are their mirror image on the same crank pin."""
    po = (1.599, 0.75)
    pat = {"A": (1.366, 1.366), "B": (1.009, 0.574), "P": (1.331, 0.75), "E": (0.741, 0.75),
           "K": (0.232, 0.866), "H": (0.866, 1.5), "F": (0.0, 0.0)}
    q = {k: ((po[0] - x) * u, (y - po[1]) * u) for k, (x, y) in pat.items()}
    dist = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])

    def meet(p, r1, c, r2, sgn):
        vx, vy = c[0] - p[0], c[1] - p[1]
        d = math.hypot(vx, vy)
        a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h = math.sqrt(max(0, r1 * r1 - a * a))
        return (p[0] + vx * a / d - vy * h / d * sgn, p[1] + vy * a / d + vx * h / d * sgn)
    a = 180 - theta if rear else theta
    P = polar(dist(q["P"], (0, 0)), a)
    E = meet(P, dist(q["P"], q["E"]), q["B"], dist(q["B"], q["E"]), 1)
    K = meet(P, dist(q["P"], q["K"]), E, dist(q["E"], q["K"]), 1)
    H = meet(K, dist(q["K"], q["H"]), q["A"], dist(q["A"], q["H"]), -1)
    F = meet(K, dist(q["K"], q["F"]), H, dist(q["H"], q["F"]), 1)
    j = {"A": q["A"], "B": q["B"], "P": P, "E": E, "K": K, "H": H, "F": F}
    if rear:
        j = {k: (-x, y) for k, (x, y) in j.items()}
    return j


def crawl(t=3, theta=90, u=80):
    """Four plates on four M4 tie rods at the rocker axles. Each group of a
    front and a rear leg sits on one crank pin: an outer group outside each
    side plate (theta) and an inner group inside it (theta + 180). Seen from
    the right (-y), front to the right; theta turns the outer crank pins."""
    c = 10
    # Offsets from a group's crank disc: gap 5, rockers, gap 4, front leg and
    # rear arm, gap 4, rear leg and front arm, gap 4, rear rockers, gap 5
    off = {"g": 5, "a": 9 + t, "b": 13 + 2 * t, "d": 17 + 3 * t}
    depth = 22 + 4 * t
    d_in = c + depth
    d_out = d_in + 9 * t
    ply = {"Uf": "g", "Lf": "g", "Gf": "a", "Cr": "a", "Gr": "b", "Cf": "b", "Ur": "d", "Lr": "d"}
    # name, disc face, direction along y, crank phase, side
    groups = []
    for s in (1, -1):
        groups += [(d_out * s, s, 0, s), (d_in * s, -s, 180, s)]
    J = {}
    for gi, (_, _, ph, _) in enumerate(groups):
        J[gi] = {"f": crawl_leg(u, theta + ph), "r": crawl_leg(u, theta + ph, True)}
    h = 7 - min(J[g][k]["F"][1] for g in J for k in "fr")

    def ys(g, s0, s1):
        """World y span of offsets s0..s1 from group g's disc face."""
        D, dirn = groups[g][0], groups[g][1]
        a, b = D + dirn * s0, D + dirn * s1
        return min(a, b), max(a, b)

    def slab(y0, y1):
        """Lay a part flat in the side view, its sheet filling y0..y1."""
        return T(0, y1, h) @ R("X", 90)

    flip = T(0, 0, t) @ R("X", 180)
    flip_x = T(0, 0, t) @ R("Y", 180)
    # Link name: joints (drawn from, along), and what it's called on the sheet
    links = {"Connecting arm": ("C", "P", "E"), "Leg": ("G", "K", "H"),
             "Upper rocker": ("U", "A", "H"), "Lower rocker": ("L", "B", "E")}
    # Plates and crank parts along y: (name, y0) per copy
    plates = {"Side plate": [d_in + 4 * t, -d_in - 5 * t], "Outer plate": [d_out + depth + 4 * t, -d_out - depth - 5 * t]}
    discs = []
    for s in (1, -1):
        for y0, ph in ((d_in, 180), (d_in + 7 * t, 0), (d_out + depth, 0)):
            for k in range(2):
                discs.append((s * (y0 + k * t) - (t if s < 0 else 0), ph))
    journals = [plates["Side plate"][0], plates["Outer plate"][0], plates["Side plate"][1], plates["Outer plate"][1]]
    hubs = []
    for s in (1, -1):
        for y0 in (d_in + 2 * t, d_in + 5 * t, d_out + depth + 2 * t):
            hubs += [s * (y0 + k * t) - (t if s < 0 else 0) for k in range(2)]
    top = d_out + depth + 5 * t
    hubs += [top, -top - t, -top - 2 * t]
    # Spacer rings: group, joint, leg, offset of its near face
    rings = []
    for g in range(4):
        L = lambda k: off[k]
        rings += [(g, "E", "f", L("g") + t), (g, "E", "f", L("a")), (g, "E", "f", L("a") + t),
                  (g, "E", "r", L("a") + t), (g, "E", "r", L("b")), (g, "E", "r", L("b") + t),
                  (g, "H", "f", L("g") + t), (g, "K", "f", L("a") + t), (g, "K", "r", L("a") + t),
                  (g, "H", "r", L("b") + t), (g, "P", "f", L("a") + t)]

    def at(g, leg, k):
        x, z = J[g][leg][k]
        return x, z

    def place(p, parts):
        n, cc = p["name"], p["copy"]
        if n in plates:
            y0 = plates[n][cc - 1]
            m = slab(y0, y0 + t)
            return m @ flip_x if y0 > 0 else m
        if n == "Crank disc":
            y0, ph = discs[cc - 1]
            return slab(y0, y0 + t) @ R("Z", theta + ph)
        if n == "Journal":
            y0 = journals[cc - 1]
            return slab(y0, y0 + t) @ R("Z", theta)
        if n == "Hub ring":
            y0 = hubs[cc - 1]
            return slab(y0, y0 + t) @ R("Z", theta)
        if n == "End cap":
            return slab(top + t, top + 2 * t) @ R("Z", theta)
        if n == "Handle crank":
            y0 = -top - 2 * t - cc * t
            return slab(y0, y0 + t) @ R("Z", theta - 90)
        if n == "Handle grip":
            y0 = -top - 4 * t - cc * t
            return slab(y0, y0 + t) @ R("Z", theta - 90) @ T(36, 0)
        if n in links:
            key, j1, j2 = links[n]
            g, leg = (cc - 1) // 2, "fr"[(cc - 1) % 2]
            y0, y1 = ys(g, off[ply[key + leg]], off[ply[key + leg]] + t)
            a, b = at(g, leg, j1), at(g, leg, j2)
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            m = slab(y0, y1) @ T(a[0], a[1]) @ R("Z", ang)
            return m @ flip if leg == "r" else m
        if n == "Spacer ring":
            g, k, leg, s0 = rings[cc - 1]
            x, z = at(g, leg, k)
            y0, y1 = ys(g, s0, s0 + t)
            return slab(y0, y1) @ T(x, z)
        return None

    pins = []

    def along(g, x, z, s0, s1, d, kind, sides=32):
        y0, y1 = ys(g, s0, s1)
        pins.append(((x, y0, z + h), (x, y1, z + h), d, kind, sides))

    def fastener(g, x, z, s0, s1, head_low=True):
        """A brass sleeve over s0..s1 on an M4 bolt: washers, the head on
        one side and a nut on the other."""
        along(g, x, z, s0 - 0.1, s1 + 0.1, 6, "brass")
        along(g, x, z, s0 - 0.8, s0 - 0.1, 9, "steel")
        along(g, x, z, s1 + 0.1, s1 + 0.8, 9, "steel")
        if head_low:
            along(g, x, z, s0 - 3.6, s0 - 0.8, 7, "steel", 6)
            along(g, x, z, s1 + 0.8, s1 + 4.0, 7.9, "brass", 6)
            along(g, x, z, s0 - 3.6, s1 + 4.0, 4, "steel", 24)
        else:
            along(g, x, z, s0 - 4.0, s0 - 0.8, 7.9, "brass", 6)
            along(g, x, z, s1 + 0.8, s1 + 3.6, 7, "steel", 6)
            along(g, x, z, s0 - 4.0, s1 + 3.6, 4, "steel", 24)

    for g in range(4):
        G = lambda leg, k: at(g, leg, k)
        o = off
        # Joints between layers; the elbow bolts keep their heads to the discs
        fastener(g, *G("f", "H"), o["g"], o["a"] + t)
        fastener(g, *G("f", "E"), o["g"], o["b"] + t)
        fastener(g, *G("f", "K"), o["a"], o["b"] + t)
        fastener(g, *G("r", "K"), o["a"], o["b"] + t)
        fastener(g, *G("r", "E"), o["a"], o["d"] + t, head_low=False)
        fastener(g, *G("r", "H"), o["b"], o["d"] + t)
        # Rocker sleeves clamped between nuts on the tie rods
        for leg, k, lay in (("f", "A", "g"), ("f", "B", "g"), ("r", "A", "d"), ("r", "B", "d")):
            x, z = G(leg, k)
            s0 = o[lay]
            along(g, x, z, s0 - 0.1, s0 + t + 0.1, 6, "brass")
            for a, b in ((s0 - 0.8, s0 - 0.1), (s0 + t + 0.1, s0 + t + 0.8)):
                along(g, x, z, a, b, 9, "steel")
            along(g, x, z, s0 - 4.0, s0 - 0.8, 7.9, "brass", 6)
            along(g, x, z, s0 + t + 0.8, s0 + t + 4.0, 7.9, "brass", 6)
        # The crank pin's sleeve under both arms, nuts each side
        x, z = G("f", "P")
        along(g, x, z, o["a"] - 0.1, o["b"] + t + 0.1, 6, "brass")
        along(g, x, z, o["a"] - 4.0, o["a"] - 0.1, 7.9, "brass", 6)
        along(g, x, z, o["b"] + t + 0.1, o["b"] + t + 4.0, 7.9, "brass", 6)
        # Nuts on the crank pin at each face of the crank disc
        along(g, x, z, 0, 3.2, 7.9, "brass", 6)
        along(g, x, z, -2 * t - 3.2, -2 * t, 7.9, "brass", 6)
        # Shim washers beside the rings in the 4 mm gaps
        for k, leg, s0 in ((("E", "f", o["g"] + t)), ("E", "f", o["a"] + t), ("E", "r", o["a"] + t), ("E", "r", o["b"] + t),
                           ("H", "f", o["g"] + t), ("K", "f", o["a"] + t), ("K", "r", o["a"] + t), ("H", "r", o["b"] + t),
                           ("P", "f", o["a"] + t)):
            along(g, *G(leg, k), s0 + t, s0 + 4, 11, "steel")
    # Outer groups: the crank pin ends at the far disc's nut
    for g in (0, 2):
        x, z = at(g, "f", "P")
        along(g, x, z, -2 * t - 3.2, depth + 2 * t + 3.2, 4, "steel", 24)
        along(g, x, z, depth - 3.2, depth, 7.9, "brass", 6)
        along(g, x, z, depth + 2 * t, depth + 2 * t + 3.2, 7.9, "brass", 6)
    # The inner crank pin runs from one inner disc to the other
    x, z = at(1, "f", "P")
    pins.append(((x, -d_in - 2 * t - 3.2, z + h), (x, d_in + 2 * t + 3.2, z + h), 4, "steel", 24))
    # Tie rods through all four plates, nuts each side of each plate
    for k in "AB":
        for leg in "fr":
            x, z = at(0, leg, k)
            pins.append(((x, -top - 4.2, z + h), (x, top + 4.2, z + h), 4, "steel", 24))
            for y0 in plates["Side plate"] + plates["Outer plate"]:
                for a, b in ((y0 - 4.0, y0 - 0.8), (y0 + t + 0.8, y0 + t + 4.0)):
                    pins.append(((x, a, z + h), (x, b, z + h), 7.9, "brass", 6))
                for a, b in ((y0 - 0.8, y0), (y0 + t, y0 + t + 0.8)):
                    pins.append(((x, a, z + h), (x, b, z + h), 9, "steel", 32))
    # Square bars: inner stub through each side plate, outer stub through
    # each outer plate to the end cap or the handle crank
    pins.append(((0, d_in, h), (0, d_out, h), 6, "steel", 4))
    pins.append(((0, -d_in, h), (0, -d_out, h), 6, "steel", 4))
    pins.append(((0, d_out + depth, h), (0, top + 2 * t, h), 6, "steel", 4))
    pins.append(((0, -d_out - depth, h), (0, -top - 4 * t, h), 6, "steel", 4))
    # Handle grip on its sleeve, bolted through the handle crank
    # The handle is keyed a quarter turn behind the outer crank pins, clear
    # of the name on the outer plate in the picture
    gx, gz = polar(36, theta - 90)
    y_c = -top - 4 * t
    pins += [((gx, y_c + 2 * t + 3.2, gz + h), (gx, y_c - 6 * t - 4, gz + h), 4, "steel", 24),
             ((gx, y_c + 2 * t + 3.2, gz + h), (gx, y_c + 2 * t, gz + h), 7, "steel", 6),
             ((gx, y_c, gz + h), (gx, y_c - 6 * t - 0.2, gz + h), 6, "brass", 32),
             ((gx, y_c - 6 * t - 0.2, gz + h), (gx, y_c - 6 * t - 3.4, gz + h), 7.9, "brass", 6)]
    return place, pins


def wellspring_lantern(n=24, theta=0, t=3):
    """The lantern's real angle when the crown has turned theta. Peg gearing
    is not conjugate, so the lantern does not follow the exact ratio: step up
    from 10 degrees behind the exact ratio in 0.5 degree steps to the first
    angle where no peg overlaps a stave, then bisect back to where the
    driving peg just touches its stave. The program does the same.
    Returns (beta, nominal beta); beta turns the lantern drawing about +x."""
    pitch, staves, engage, zL = 18, 8, 11, 100
    Rc, rl = pitch * n / (2 * math.pi), pitch * staves / (2 * math.pi)
    xi, xo = Rc - 12.5, Rc + 4.5
    zbot, ztop = rl - engage, rl + 9
    sin = lambda d: math.sin(math.radians(d))
    cos = lambda d: math.cos(math.radians(d))

    def gap(a):
        """Smallest gap between a crown peg and a stave, top stave family at
        mesh angle a (stave y = rl sin a, z = rl cos a above the axle)."""
        g = [1e9]
        for i in range(n):
            ph = theta + 360 * i / n
            px, py = Rc * cos(ph), Rc * sin(ph)
            if px > 0 and abs(py) < rl + 9:
                for j in range(staves):
                    b = a + 360 * j / staves
                    sy, sz = rl * sin(b), rl * cos(b)
                    dz = abs(min(max(sz, zbot), ztop) - sz)
                    if dz < 3:
                        g.append(math.sqrt(max(0, xi - px, px - xo) ** 2 + max(0, abs(py - sy) - math.sqrt(9 - dz * dz)) ** 2) - 3)
        return min(g)

    a0 = n / staves * theta + 180 / staves
    f, k = a0 - 10, 0
    while not (gap(f) >= 0 or k > 60):
        f, k = f + 0.5, k + 1
    lo, hi = f - 0.5, f
    for _ in range(40):
        m = (lo + hi) / 2
        if gap(m) >= 0:
            hi = m
        else:
            lo = m
    return 67.5 - hi, 67.5 - a0


def wellspring(t=3, n=24, pots=10, theta=195):
    """Base, walkway on five posts, the tower round the vertical shaft with
    the crown wheel, collars and draw-bar on it, the ox in the draw-bar's
    slot; the lantern on the horizontal axle in its bearing, the well
    uprights with the wheel and pots between them, the well walls and the
    trough on the outer upright and its post. theta turns the draw-bar
    (counterclockwise from above, from +x); the lantern and wheel follow at
    n/8 times it, clockwise seen from the trough end."""
    pitch, staves, engage, zL, Rw = 18, 8, 11, 100, 75
    Rc, rl = pitch * n / (2 * math.pi), pitch * staves / (2 * math.pi)
    zc = zL + rl + 9
    peg_tip = zL + rl - engage
    deck_z = zL + 12
    tower_n = math.floor((zc - 4.2 - 2 * t) / t)
    tower_top = 2 * t + tower_n * t
    collar_n = math.ceil((deck_z + t + 1 + 53 - zc - 2 * t) / t)
    zd = zc + 2 * t + collar_n * t
    Ri = Rc + 32
    Ro = Ri + 64
    L = Ri + 32
    wx = Ro + 2
    lx_in, lx_out = Rc - 12.5, Rc + 4.5
    lbx = lx_out + 2 * t + 4.2
    wix = wx - 4.2 - 2 * t
    wox = wx + 4 * t + 4.2
    Yw = 70
    ty0, ty1 = -12, 22
    tz = zL + 38
    tx = wx + 2 * t + 0.5
    post_x = tx + 86
    beta, _ = wellspring_lantern(n, theta, t)

    def across(x, z=2 * t):
        """A plate standing across the axle, its back face at x."""
        return T(x, 0, z) @ SIDEWAYS

    def on_axle(x, b):
        return T(x, 0, zL) @ R("X", b) @ SIDEWAYS

    def place(p, parts):
        nm, c = p["name"], p["copy"]
        if nm == "Base":
            return T(0, 0, (c - 1) * t)
        if nm == "Walkway":
            return T(0, 0, deck_z)
        if nm == "Walkway post":
            return R("Z", 60 * c) @ T(0, t / 2, 2 * t) @ R("X", 90)
        if nm == "Tower disc":
            return T(0, 0, 2 * t + (c - 1) * t)
        if nm == "Crown wheel":
            return T(0, 0, zc + (c - 1) * t) @ R("Z", theta)
        if nm == "Shaft collar":
            return T(0, 0, zc + 2 * t + (c - 1) * t)
        if nm == "Draw-bar":
            return T(0, 0, zd + (c - 1) * t) @ R("Z", theta)
        if nm == "Ox":
            return R("Z", theta) @ T(L - t + (c - 1) * t, 0, deck_z + t + 1) @ SIDEWAYS
        if nm == "Lantern plate":
            x = lx_in - 2 * t + (c - 1) * t if c <= 2 else lx_out + (c - 3) * t
            return on_axle(x, beta)
        if nm == "Lantern bearing":
            return across(lbx + (c - 1) * t)
        if nm == "Water wheel":
            return on_axle(wx + (c - 1) * t, beta)
        if nm == "Wheel hub":
            return on_axle(wx + 2 * t + (c - 1) * t, beta)
        if nm == "Pot":
            i, k = divmod(c - 1, 2)
            g = 360 * i / pots
            return on_axle(wx, beta) @ T(*polar(Rw - 1, g), 2 * t + k * t) @ R("Z", g - 90)
        if nm == "Inner upright":
            return across(wix + (c - 1) * t)
        if nm == "Outer upright":
            return across(wox + (c - 1) * t)
        if nm == "Well wall":
            return T(wx - 4.2, Yw + t if c == 1 else -Yw, 2 * t) @ R("X", 90)
        if nm == "Trough floor":
            return T(tx, 0, tz)
        if nm == "Trough side":
            return T(tx, ty1 if c == 1 else ty0 + t, tz + t) @ R("X", 90)
        if nm == "Trough end":
            return across(tx, tz + t)
        if nm == "Trough post":
            return across(post_x + (c - 1) * t)
        return None

    def bar(x0, x1, d, kind, sides=32):
        """Hardware along the horizontal axle."""
        return ((x0, 0, zL), (x1, 0, zL), d, kind, sides)

    def hexnut(x0, x1):
        return bar(x0, x1, 7.9, "brass", 6)

    # The vertical shaft: an M4 rod in two bushes in the tower, washers on
    # the tower top under the nut that carries the crown, a nut on top
    pins = [((0, 0, 2 * t + 2), (0, 0, zd + 2 * t + 5), 4, "steel", 24),
            ((0, 0, 2 * t), (0, 0, 6 * t), 6, "brass", 32),
            ((0, 0, tower_top - 4 * t), (0, 0, tower_top), 6, "brass", 32),
            ((0, 0, tower_top), (0, 0, zc - 3.2), 10, "steel", 32),
            nut(0, 0, zc - 3.2), nut(0, 0, zd + 2 * t)]
    # Crown pegs, pointing down from the crown's top face
    for i in range(n):
        x, y = polar(Rc, theta + 360 * i / n)
        pins.append(((x, y, peg_tip), (x, y, zc + 2 * t), 6, "dowel", 32))
    # The horizontal axle: lantern clamped on its spacer, the bearing, then
    # the wheel and hub clamped between the well uprights
    pins += [bar(lx_in - 2 * t - 4.7, wox + 2 * t + 5.7, 4, "steel", 24),
             hexnut(lx_in - 2 * t - 3.2, lx_in - 2 * t), bar(lx_in, lx_out, 6, "brass"),
             hexnut(lx_out + 2 * t, lx_out + 2 * t + 3.2), bar(lx_out + 2 * t + 3.2, lbx, 10, "steel"),
             bar(lbx, lbx + 2 * t, 6, "brass"),
             bar(wix, wix + 2 * t, 6, "brass"), bar(wx - 4.2, wx - 3.2, 10, "steel"), hexnut(wx - 3.2, wx),
             hexnut(wx + 4 * t, wx + 4 * t + 3.2), bar(wx + 4 * t + 3.2, wox, 10, "steel"),
             bar(wox, wox + 2 * t, 6, "brass"), bar(wox + 2 * t, wox + 2 * t + 1, 10, "steel"),
             hexnut(wox + 2 * t + 1, wox + 2 * t + 4.2)]
    # Lantern staves
    for j in range(staves):
        y, z = polar(rl, 22.5 + 360 * j / staves + beta)
        pins.append(((lx_in - 2 * t, y, zL + z), (lx_out + 2 * t, y, zL + z), 6, "dowel", 32))
    return place, pins


def cascade(t=3, value=13):
    """The board leans back 20 degrees in its two feet, back face rising from
    (y 0, z 45). Parts drawn in board coordinates (x across, y up from the
    bottom edge) sit at a depth d in front of its front face: the two board
    layers behind it, the rails' three layers on it, the rockers 1 mm off it
    and the reset levers and bar 1 mm behind it. value is the number the
    rockers hold, 0 to 31: a 1 tips its rocker's right end down. One marble
    is rolling down the top chute and three lie in the tray."""
    n, pitch, low, lean, rise, tip = 5, 78, 40, 20, 45, 20
    feet = (-92, 66)
    piv = [(0, low + (n - 1 - k) * pitch) for k in range(n)]
    turn = [-tip if (value >> k) & 1 else tip for k in range(n)]
    sl, cl = math.sin(math.radians(lean)), math.cos(math.radians(lean))

    def front(d, x=0, y=0, a=0):
        """A part drawn in board coordinates, its back face d mm in front of
        the board's front face, moved by x, y and turned by a."""
        return T(0, 0, rise) @ R("X", -lean) @ T(0, -2 * t - d, 0) @ R("X", 90) @ T(x, y) @ R("Z", a)

    def at(x, y, h):
        """The world point h mm in front of board point (x, y)."""
        y0 = -2 * t - h
        return (x, y0 * cl + y * sl, rise - y0 * sl + y * cl)

    def place(p, parts):
        nm, c = p["name"], p["copy"]
        if nm == "Board face":
            return front(-t)
        if nm == "Board back":
            return front(-2 * t)
        if nm == "Stand foot":
            j, k = divmod(c - 1, 2)
            return T(feet[j] - t + k * t, 0, 0) @ SIDEWAYS
        if nm == "Rocker face":
            return front(1 + 2 * t, *piv[c - 1], turn[c - 1])
        if nm == "Rocker":
            j, k = divmod(c - 1, 2)
            return front(1 + k * t, *piv[j], turn[j])
        if nm == "Reset lever":
            j, k = divmod(c - 1, 2)
            return front(-2 * t - 1 - (k + 1) * t, *piv[j], turn[j])
        if nm == "Reset bar face":
            return front(-3 * t - 1)
        if nm == "Reset bar":
            return front(-4 * t - 1)
        if nm == "Chute rail":
            j, k = divmod(c - 1, 3)
            return front(k * t, *piv[j])
        if nm == "Stop rail":
            j, k = divmod(c - 1, 3)
            return front(k * t, *piv[j])
        if nm == "Last stop rail":
            return front((c - 1) * t, *piv[n - 1])
        if nm == "Hopper":
            return front((c - 1) * t, *piv[0])
        if nm == "Return wall":
            return front((c - 1) * t)
        if nm == "Tray floor":
            return T(feet[0] + t, -62, 0)
        if nm == "Tray side":
            return T(feet[0] + t if c == 1 else feet[1] - 2 * t, -62, t) @ SIDEWAYS
        if nm == "Tray end":
            return T(feet[0] + 2 * t, -59 if c == 1 else 18, t) @ upright()
        return None

    def axial(x, y, h0, h1, d, kind, sides=32):
        return (at(x, y, h0), at(x, y, h1), d, kind, sides)

    pins = []
    # Each rocker's spindle: M4 x 30 with its head on the rocker, a thrust
    # washer, the brass tube through the board, a washer, the levers, a nut
    for x, y in piv:
        top, back = 1 + 3 * t, -2 * t - 1 - 2 * t
        pins += [axial(x, y, top + 2.8, back - 4.5, 4, "steel", 24), axial(x, y, top, top + 2.8, 7, "steel"),
                 axial(x, y, 0.2, 1, 12, "steel"), axial(x, y, 1, -2 * t - 1, 6, "brass"),
                 axial(x, y, -2 * t - 0.1, -2 * t - 0.9, 12, "steel"), axial(x, y, back, back - 3.2, 7.9, "brass", 6)]
    # The reset bar's guides: countersunk M4 bolts flush with the channel
    # floor, a spacer washer, a sleeve through the slot, washer and nut
    for y in (piv[n - 1][1] + 30, piv[1][1] + 30):
        end = -4 * t - 1.4
        pins += [axial(43, y, 0, end - 4.5, 4, "steel", 24), axial(43, y, -2 * t - 0.1, -2 * t - 0.9, 12, "steel"),
                 axial(43, y, -2 * t, end, 6, "brass"), axial(43, y, end, end - 0.8, 12, "steel"),
                 axial(43, y, end - 0.8, end - 4, 7.9, "brass", 6)]
    # Marbles: one rolling down the top chute, resting on the board and the
    # chute floor, and three in the tray
    D = 16
    a = math.radians(12)
    xc = -62
    yf = piv[0][1] + 42.5 + (-9 - xc) * math.tan(a)
    balls = [(*at(xc + D / 2 * math.sin(a), yf + D / 2 * math.cos(a), D / 2), D)]
    balls += [(x, 6, t + D / 2, D) for x in (-70, -53.5, 10)]
    return place, pins, balls


def tally(t=3, n=4, count=2026, crank=100):
    """The box on its base, drum shaft along x from the inside of the left
    wall, 38 mm up, the pinion shaft 42 mm behind it. Drums from the highest
    digit (left) to the units, then the crank through the right wall. Each
    drum layer is drawn with the shaft at its origin and stood up across x;
    tile d sits on the face at 63 - 36d. count is what the window shows;
    crank turns the handle from straight up, and between 324 and 360 the
    units drum (and any drum above a run of 9s) rolls on by one digit. The
    lid lies on the table against the left wall, 50 mm forward. The table is at z = 0."""
    a, zA, front, back = 42, 38, 36, 64
    box_w = t * (1 + 8 * n) + 0.5
    s = min(max((crank - 324) / 36, 0), 1)
    digits = [count // 10 ** j % 10 for j in range(n)]
    # Progress of each drum through its step, and how many steps it has made
    prog = []
    for j in range(n):
        prog.append(s if all(dd == 9 for dd in digits[:j]) else 0)
    steps = [count // 10 ** j + prog[j] for j in range(n)]
    theta = {j: 27 + 36 * (digits[j] + prog[j]) for j in range(n)}
    theta[-1] = 27 + crank

    def base(j):
        """x where drum j's carry gear goes; its pinion's first gear is t before"""
        return 7 * t + 8 * t * (n - 2 - j)

    def wheel(j, x):
        return T(x, 0, zA) @ SIDEWAYS @ R("Z", theta[j])

    def pinion(j, x):
        # Pinion j is turned by drum j and turns drum j + 1
        return T(x, a, zA) @ SIDEWAYS @ R("Z", 225 - 90 * steps[j + 1])

    # A tile on the drum face at angle al: its x along the shaft, y round the
    # drum (so the digit is upright in the window), engraved face outwards
    flip = Matrix(((0, 0, 1, 0), (0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))

    def tile(al):
        ca, sa = math.cos(math.radians(al)), math.sin(math.radians(al))
        hw = math.tan(math.radians(18)) * 30 - 0.15
        return T(30 * ca - hw * sa, 30 * sa + hw * ca, 0) @ R("Z", al) @ flip

    def layout(p, parts):
        nm, c = p["name"], p["copy"]
        if nm == "Fit test":
            return None
        if nm == "Base":
            return T(-t, -front - t, -t)
        if nm == "Left wall":
            return T(-t, -front - t, 0) @ SIDEWAYS
        if nm == "Right wall":
            return T(box_w, -front - t, 0) @ SIDEWAYS
        if nm == "Bearing pad":
            return T(box_w + t, 0, zA) @ SIDEWAYS
        if nm == "Front":
            return T(-t, -front, 0) @ R("X", 90)
        if nm == "Back":
            return T(-t, back + t, 0) @ R("X", 90)
        if nm == "Lid":
            return T(-2 * t - box_w - t, -front - t - 50, 0)
        if nm == "Lid locator":
            return T(-2 * t - box_w - t + t + 10, -front - t - 50 + (t if c == 1 else back + front - 8 + t), -t)
        if nm == "Shaft spacer":
            return wheel(n - 1, 0)
        if nm == "Digit ring":
            j = c - 1
            return wheel(j, base(j) + 7 * t)
        if nm in ("Carry gear", "Lock disc"):
            j = c - 2  # copy 1 is the crank's, then drums 0 to n - 2
            return wheel(j, base(j) + (t if nm == "Lock disc" else 0))
        if nm == "Drum disc":
            j, k = divmod(c - 1, 5)
            return wheel(j, base(j) + 2 * t + k * t)
        if nm.startswith("Tile "):
            dg, j = int(nm.split()[1]), c - 1
            return wheel(j, base(j) + 2 * t) @ tile(63 - 36 * dg)
        if nm == "Pinion gear":
            j, k = divmod(c - 1, 2)
            return pinion(j - 1, base(j - 1) - t + k * t)
        if nm == "Pinion lock":
            j = c - 2
            return pinion(j, base(j) + t)
        if nm == "Crank hub":
            return wheel(-1, base(-1) + 2 * t + (c - 1) * t)
        if nm == "Crank inner":
            return wheel(-1, base(-1) + 5 * t)
        if nm == "Crank outer":
            return wheel(-1, base(-1) + 6 * t)
        if nm == "Handle ring":
            return wheel(-1, base(-1) + 7 * t + 0.8 + (c - 1) * t) @ T(*polar(30, 63))
        if nm == "Cap ring":
            return wheel(-1, -2 * t if c == 1 else base(-1) + 7 * t + 0.5)
        if nm == "Cap":
            return wheel(-1, -3 * t if c == 1 else base(-1) + 8 * t + 0.5)
        return None

    def along(y, z, x0, x1, d, kind="steel", sides=32):
        return ((x0, y, z), (x1, y, z), d, kind, sides)

    def at(j, r, ang, cy=0):
        """Shaft-frame point (r, ang) of something turned with drum j, in world y, z"""
        th = theta[j] if j in theta else 0
        px, py = polar(r, ang + th)
        return cy + px, zA + py

    end = base(-1) + 8 * t + 0.5
    pins = [along(0, zA, -2 * t, end, 6), along(a, zA, -t, box_w + t, 4)]
    # Brass tube spacers on the pinion shaft
    edges = [0] + [x for j in range(n - 2, -2, -1) for x in (base(j) - t, base(j) + 2 * t)]
    for x0, x1 in zip(edges[0::2], edges[1::2]):
        if x1 - x0 > 1:
            pins.append(along(a, zA, x0, x1 - 0.2, 6, "brass"))
    # 2 mm pins through each drum's layers and the crank's
    for j in range(-1, n):
        x0 = base(j) if j < n - 1 else t
        x1 = base(j) + 8 * t if j >= 0 else base(-1) + 7 * t
        for ang in (0, 90):
            y, z = at(j, 6.5, ang)
            pins.append(along(y, z, x0, x1, 2, "steel", 12))
    for j in range(-1, n - 1):
        px, py = polar(6, 225 - 90 * steps[j + 1])
        pins.append(along(a + px, zA + py, base(j) - t, base(j) + 2 * t, 2, "steel", 12))
    # Handle: nut in the inner crank, M4 bolt, washer, 6 mm brass tube with
    # the rings on it, washer, bolt head
    hy, hz = at(-1, 30, 63)
    xc = base(-1) + 7 * t
    h0 = xc + 0.8
    h1 = h0 + 4 * t + 0.3
    pins += [along(hy, hz, base(-1) + 5 * t - 0.2, base(-1) + 6 * t, 7.9, "brass", 6),
             along(hy, hz, base(-1) + 5 * t, h1 + 0.8, 4, "steel", 24),
             along(hy, hz, xc, h0, 9), along(hy, hz, h0, h1, 6, "brass"),
             along(hy, hz, h1, h1 + 0.8, 9), along(hy, hz, h1 + 0.8, h1 + 3.6, 7)]
    # Everything above was drawn with the top of the base at z = 0; the
    # table is t lower
    def place(p, parts):
        m = layout(p, parts)
        return None if m is None else T(0, 0, t) @ m

    pins = [((x0, y0, z0 + t), (x1, y1, z1 + t), dd, kind, sides) for (x0, y0, z0), (x1, y1, z1), dd, kind, sides in pins]
    return place, pins


def ease(u, a, b):
    """0 before a, 1 after b, smoothly between."""
    x = min(1, max(0, (u - a) / (b - a)))
    return x * x * (3 - 2 * x)


def hours_pose(u, cycles=40):
    """The pendulum swings 3 degrees each way. The recipe's own escape angle
    for a swing is where a tooth sits on the entry pallet's impulse face
    (swing 0 to 0.6) or the exit pallet's (-0.6 to 0); each face is used
    one way only. Swinging left the tooth rides the entry face, then drops
    onto the exit pallet and waits; swinging right it rides the exit face
    and drops onto the entry pallet, a tooth on. Forty swings turn it once."""
    ph = 90 + 360 * cycles * u
    swing = 3 * math.sin(math.radians(ph))
    k, rest = divmod(ph - 90, 360)
    esc = lambda sw: hours(swing=sw)[0].escape
    if rest < 180:
        e = esc(swing) if swing >= 0 else esc(-3)
    else:
        e = esc(swing) if swing <= 0 else esc(3) - 9
    return {"swing": swing, "escape": e - 9 * k}


def vault_pose(u):
    off = (-144, 108, -216)
    dials = ease(u, 0, 0.3) - ease(u, 0.9, 1)
    return {"spin": tuple(o * (1 - dials) for o in off),
            "slide": 10 * (ease(u, 0.3, 0.4) - ease(u, 0.8, 0.9)),
            "lid_lift": 45 * (ease(u, 0.4, 0.55) - ease(u, 0.65, 0.8))}


def tempo(t=3, L=250, n=30, lift=3, amplitude=4, phase=15):
    """Graham deadbeat escapement on two plates standing in a base. Between
    the plates the escape wheel and the anchor; in front the hand on the
    wheel arbor and the crutch, rod and bob on the anchor arbor; behind, the
    click, ratchet and drum on the wheel arbor and the weight pot below it.
    The pendulum swings alpha = amplitude * sin(phase); the wheel stands
    still while a pallet locks it, turns through the pallet width during
    each impulse and drops half a tooth on per beat, as in the program."""
    deg = math.radians
    Rw = n * 15 / (2 * math.pi)
    pitch = 360 / n
    span = math.floor(n / 4) + 0.5
    hs = span * pitch / 2
    D = Rw / math.cos(deg(hs))
    rho = Rw * math.tan(deg(hs))
    lock, drop, swing = 1.5, 1.5, 5.5
    w = pitch / 2 - drop
    c = (lift - lock) / 2
    h = deg(swing - c + lift) * rho + 2
    gap = 4 * t + 1
    front_d = 2 * t + gap
    zP = max(L + 70, D + Rw + 45)
    zW = zP - D
    PW = 2 * (Rw + 40)
    pillars = [(-(PW / 2 - 12), zP + 34), (PW / 2 - 12, zP + 34), (-(PW / 2 - 12), zW - Rw - 20), (PW / 2 - 12, zW - Rw - 20)]
    sleeve, core_r = 28, 5
    core_d = -(1 + sleeve + 2 * t + 1.5 * t)
    fp = front_d + 2 * t
    hand_d = fp + 1
    crutch_d = fp + 2 * t + 2
    rod_d = crutch_d + 2 * t
    bob_back = rod_d - 3 * t
    click_d = -(1 + sleeve + t)

    # The pose, as the program works it out
    alpha = amplitude * math.sin(deg(phase))
    theta_x = (hs - w / 2) % pitch

    def impulse(u):
        return max(0, w * u - 0.05)
    cycle = math.floor((phase + 90) / 360)
    psi = phase - 360 * cycle
    if psi <= 90:
        turn = 0 if alpha < -c else impulse((alpha + c) / lift) if alpha < lift - c else pitch / 2
    else:
        turn = pitch / 2 if alpha > c else pitch / 2 + impulse((c - alpha) / lift) if alpha > c - lift else pitch
    theta = theta_x + pitch * cycle + turn
    pot_top = zW + 2 * t - 40 - core_r * deg(theta)

    def at_front(x, z, d):
        return T(x, -d, z + 2 * t)

    def turned(a):
        return R("Y", -a) @ R("X", 90)

    def swung(x, y):
        ca, sa = math.cos(deg(alpha)), math.sin(deg(alpha))
        return x * ca - y * sa, zP + x * sa + y * ca

    bob = swung(0, -L)
    W = (0, zW)
    P = (0, zP)

    def place(p, parts):
        nm, k = p["name"], p["copy"] - 1
        if nm == "Front plate":
            return at_front(0, 0, fp - t) @ turned(0)
        if nm == "Front plate inner":
            return at_front(0, 0, front_d) @ turned(0)
        if nm == "Back plate":
            return at_front(0, 0, k * t) @ turned(0)
        if nm == "Base":
            return T(0, 0, t)
        if nm == "Base lower":
            return T()
        if nm == "Pillar ring":
            j, i = divmod(k, 4)
            return at_front(*pillars[j], (2 + i) * t) @ turned(0)
        if nm == "Escape wheel":
            return at_front(*W, (3 + k) * t + 0.5) @ turned(-theta)
        if nm == "Anchor":
            return at_front(*P, (3 + k) * t + 0.5) @ turned(alpha)
        if nm == "Hand":
            return at_front(*W, hand_d) @ turned(-theta - 120)
        if nm == "Arbor spacer":
            spots = [(W, 2 * t), (W, front_d - t), (P, 2 * t), (P, front_d - t), (P, fp), (P, fp + t)]
            q, d = spots[k]
            return at_front(*q, d) @ turned(0)
        if nm == "Crutch":
            return at_front(*P, crutch_d + k * t) @ turned(alpha)
        if nm == "Pendulum rod":
            return at_front(*P, rod_d + k * t) @ turned(alpha)
        if nm == "Bob face":
            return at_front(*bob, rod_d + 4 * t) @ turned(alpha)
        if nm == "Bob disc":
            return at_front(*bob, bob_back + (0, 1, 2, 5, 6)[k] * t) @ turned(alpha)
        if nm == "Bob cheek":
            return at_front(*bob, rod_d + (k // 2) * t) @ turned(alpha + 180 * (k % 2))
        if nm == "Click disc":
            return at_front(*W, click_d) @ turned(-theta)
        if nm in ("Click ring", "Ratchet wheel"):
            return at_front(*W, click_d - t) @ turned(-theta)
        if nm == "Drum core":
            return at_front(*W, click_d - (k + 2) * t) @ turned(-theta)
        if nm == "Drum flange":
            return at_front(*W, click_d - 5 * t) @ turned(-theta)
        if nm == "Winding knob":
            return at_front(*W, click_d - (6 + k) * t) @ turned(-theta)
        if nm == "End collar":
            return at_front(*W, click_d - 8 * t) @ turned(-theta)
        if nm == "Weight base":
            return T(core_r, -core_d, pot_top - 17 * t)
        if nm == "Weight ring":
            return T(core_r, -core_d, pot_top - (16 - k) * t)
        if nm == "Weight bail":
            return T(core_r, -core_d, pot_top - t)
        return None

    def bar(q, d0, d1, dia, kind, sides=32):
        """Hardware along the depth axis at q (x, height above the base top)."""
        return ((q[0], -d0, q[1] + 2 * t), (q[0], -d1, q[1] + 2 * t), dia, kind, sides)

    pins = [
        # Arbors, 4 mm steel rod
        bar(P, -1, crutch_d + 2 * t, 4, "steel"),
        bar(W, click_d - 8 * t, hand_d + t, 4, "steel"),
        # Brass bushes glued in the plates
        bar(P, 0, 2 * t, 6, "brass"), bar(P, front_d, fp, 6, "brass"),
        bar(W, 0, 2 * t, 6, "brass"), bar(W, front_d, fp, 6, "brass"),
        # Washers: under the hand, two under the crutch, behind the back plate
        bar(W, fp, fp + 1, 9, "steel"),
        bar(P, fp + 2 * t, fp + 2 * t + 2, 9, "steel"),
        bar(W, -1, 0, 9, "steel"),
        # The brass tube sleeve between the back plate and the click disc
        bar(W, -1 - sleeve, -1, 6, "brass"),
    ]
    for q in pillars:
        pins += [bar(q, -2.8, fp + 4.5, 4, "steel", 24), bar(q, -2.8, 0, 7, "steel", 6),
                 bar(q, 6 * t, front_d, 9, "steel"), bar(q, fp, fp + 3.2, 7.9, "brass", 6)]
    # Crutch bolts A and B, M3, heads behind the crutch and nuts in front of the rod
    for y in (-40, -56):
        q = swung(0, y)
        pins += [bar(q, crutch_d - 2, rod_d + 2 * t + 3.5, 3, "steel", 24), bar(q, crutch_d - 2, crutch_d, 5.5, "steel"),
                 bar(q, rod_d + 2 * t, rod_d + 2 * t + 2.4, 6.4, "brass", 6)]
    # Bob clamp bolts, M4 with washers and wing nuts
    for y in (-12, 12):
        q = swung(0, -L + y)
        front = rod_d + 5 * t
        pins += [bar(q, bob_back - 2.8, front + 5, 4, "steel", 24), bar(q, bob_back - 2.8, bob_back, 7, "steel", 6),
                 bar(q, front, front + 1, 9, "steel"), bar(q, front + 1, front + 4.2, 7.9, "brass", 6)]
    # The string, from the right of the drum core down to the pot's bail
    sx = core_r + 0.45
    pins.append(((sx, -core_d, zW + 2 * t), (sx, -core_d, pot_top), 0.8, "steel", 12))
    return place, pins


def hours(t=3, hour=10, minute=10, swing=3, escape=None):
    """The clock hangs facing -y: the back plate's front face at y = 0, depths
    d forward from it at y = -d, plate x/y as world x/z with the dial centre
    raised by Z0 so the bob clears the floor. Back to front between the
    plates: escape wheel and anchor, escape pinion with the third wheel,
    third pinion with the centre wheel, centre pinion with the great wheel,
    ratchet and click, drum and flange; then the motion works, dial and hands
    in front, the pendulum and wall bar behind. hour and minute set every
    wheel (the escape wheel's angle comes from the anchor, the train follows
    it); swing turns the anchor and pendulum, degrees, positive to the right.
    The same sums as the program's Assembly section, 0.75 s beat."""
    m, shift = 2, 0.55
    z_great, z_centre, z_third, z_leaf, z_cannon, z_minute, z_hour, n_esc = 64, 64, 60, 8, 10, 30, 32, 40
    beat = 0.75
    G = (0, -m * (z_great + z_leaf) / 2)
    M = (0, 0)
    c = m * (z_centre + z_leaf) / 2
    Tt = (c * math.cos(math.radians(70)), c * math.sin(math.radians(70)))
    E = (0, Tt[1] + math.sqrt((m * (z_third + z_leaf) / 2) ** 2 - Tt[0] ** 2))
    ah, Rw = 65, 45
    A = (0, E[1] + ah)
    S = (-40, 0)
    pillars = [(-80, -110), (80, -110), (-60, A[1]), (60, A[1])]
    posts = [polar(76, a) for a in (45, 135, 225, 315)]
    L = 9806.65 * beat * beat / (math.pi ** 2)
    Z0 = L + 60 - A[1]

    # Escapement geometry, as the program draws the anchor
    span = math.floor(n_esc / 4) + 0.5
    phi = span * 180 / n_esc
    L0 = math.sqrt(Rw * Rw + ah * ah - 2 * ah * Rw * math.cos(math.radians(phi)))
    pallet_w = math.pi * Rw / n_esc - 1.1
    lift, s0 = 2, 0.6
    ro, ri = L0 + pallet_w / 2, L0 - pallet_w / 2

    def tip_at(r, side):
        qy = (Rw * Rw - r * r - ah * ah) / (2 * ah)
        return math.degrees(math.atan2(qy, side * math.sqrt(r * r - qy * qy)))

    eo, ei = tip_at(ro, -1) - s0, tip_at(ri, -1) - s0 + lift
    xi, xo = tip_at(ri, 1) + s0, tip_at(ro, 1) + s0 - lift

    def pt(r, a):
        x, y = polar(r, a)
        return (x, y + ah)

    def seg_circle(p, q, r):
        v = (q[0] - p[0], q[1] - p[1])
        a = v[0] ** 2 + v[1] ** 2
        b = 2 * (p[0] * v[0] + p[1] * v[1])
        cc = p[0] ** 2 + p[1] ** 2 - r * r
        s = math.sqrt(max(0, b * b - 4 * a * cc))
        u = (-b - s) / (2 * a)
        if not 0 <= u <= 1:
            u = (-b + s) / (2 * a)
        return (p[0] + v[0] * u, p[1] + v[1] * u)

    # The engaged tooth's leading corner: locked on a pallet, or riding its
    # impulse face in the middle of the swing
    if swing >= s0:
        cp = pt(ro, tip_at(ro, -1))
    elif swing >= 0:
        cp = seg_circle(pt(ro, eo + swing), pt(ri, ei + swing), Rw)
    elif swing > -s0:
        cp = seg_circle(pt(ri, xi + swing), pt(ro, xo + swing), Rw)
    else:
        cp = pt(ri, tip_at(ri, 1))
    gamma = math.degrees(math.atan2(cp[1], cp[0]))
    pa = 360 / n_esc
    time_angle = -6 * (60 * (hour % 12) + minute)
    a_escape = gamma + pa * math.floor((60 * time_angle - gamma) / pa + 0.5) if escape is None else escape
    a_minute = a_escape / 60
    a_third = -a_minute * z_centre / z_leaf
    a_great = -a_minute * z_leaf / z_great
    a_stud = -a_minute * z_cannon / z_minute
    a_hour = a_minute / 12

    def mesh(c1, r1, z1, c2, z2):
        b = math.degrees(math.atan2(c2[1] - c1[1], c2[0] - c1[0]))
        return b + 180 + 180 / z2 + (b - r1) * z1 / z2

    r_great = a_great + mesh(M, 0, z_leaf, G, z_great)
    r_centre = a_minute + mesh(Tt, 0, z_leaf, M, z_centre)
    r_third = a_third + mesh(E, 0, z_leaf, Tt, z_third)
    r_mwheel = a_stud + mesh(M, 0, z_cannon, S, z_minute)
    r_hwheel = a_hour + mesh(S, 0, z_leaf, M, z_hour)
    bob = (A[0] + polar(L, swing - 90)[0], A[1] + polar(L, swing - 90)[1])

    # Depths of the back faces
    d_escape, d_epinion, d_third, d_tpinion = 1, 1 + 2 * t, 1 + 2.5 * t, 1 + 3.5 * t
    d_centre, d_cpinion, d_great, d_ratchet = 1 + 4 * t, 1 + 5 * t, 1 + 5.5 * t, 1 + 7.5 * t
    d_drum, d_flange, d_front = 1 + 8.5 * t, 1 + 12.5 * t, 2 + 13.5 * t
    f0 = d_front + 2 * t
    d_cannon, d_minute, d_mpinion, d_hour = f0 + 1, f0 + 1 + 0.5 * t, f0 + 1 + 1.5 * t, f0 + 1 + 2.5 * t
    d_dial, d_hhand, d_mhand = f0 + 2 + 3.5 * t, f0 + 3 + 4.5 * t, f0 + 4 + 6.5 * t
    d_pend, d_wall = -(2 * t + 1) - 4 * t, -(6 * t + 4)

    def at(p, d, a=0):
        return T(p[0], -d, Z0 + p[1]) @ R("Y", -a) @ R("X", 90)

    def stk(c, p, d, a=0):
        return at(p, d + (c - 1) * t, a)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Back plate":
            return stk(c, M, -2 * t)
        if n == "Front plate":
            return stk(c, M, d_front)
        if n == "Wall bar":
            return at(M, d_wall - t)
        if n == "Wall bar, nut layer":
            return at(M, d_wall - 2 * t)
        if n == "Wall pad":
            return at(pillars[c - 1], d_wall - t)
        if n == "Wall pad, nut layer":
            return at(pillars[c - 1], d_wall - 2 * t)
        if n == "Great wheel":
            return stk(c, G, d_great, r_great)
        if n == "Centre pinion":
            return stk(c, M, d_cpinion, a_minute)
        if n == "Centre wheel":
            return at(M, d_centre, r_centre)
        if n == "Third pinion":
            return stk(c, Tt, d_tpinion, a_third)
        if n == "Third wheel":
            return at(Tt, d_third, r_third)
        if n == "Escape pinion":
            return stk(c, E, d_epinion, a_escape)
        if n == "Escape wheel":
            return stk(c, E, d_escape, a_escape)
        if n == "Anchor":
            return stk(c, A, d_escape, swing)
        if n == "Drum":
            return stk(c, G, d_drum, r_great)
        if n == "Drum flange":
            return at(G, d_flange, r_great)
        if n in ("Ratchet wheel", "Click"):
            return at(G, d_ratchet, r_great)
        if n == "Winding knob":
            return stk(c, G, d_hhand, r_great)
        if n == "Cannon pinion":
            return stk(c, M, d_cannon, a_minute)
        if n == "Minute wheel":
            return at(S, d_minute, r_mwheel)
        if n == "Minute pinion":
            return stk(c, S, d_mpinion, a_stud)
        if n == "Hour wheel":
            return at(M, d_hour, r_hwheel)
        if n == "Dial":
            return at(M, d_dial)
        if n == "Hour hand":
            return at(M, d_hhand, a_hour)
        if n == "Minute hand":
            return at(M, d_mhand, a_minute)
        if n == "Pendulum top":
            return at(A, d_pend + 3 * t if c == 1 else d_pend, swing)
        if n == "Pendulum top, channel":
            return stk(c, A, d_pend + t, swing)
        if n == "Bob":
            return at(bob, d_pend + 3 * t, swing)
        if n == "Bob back":
            return at(bob, d_pend, swing)
        if n == "Bob, channel":
            return stk(c, bob, d_pend + t, swing)
        return None

    def bar(p, d0, d1, d, kind="steel", sides=32):
        """Hardware along the depth axis at plate point p, from depth d0 to d1."""
        return ((p[0], -d0, Z0 + p[1]), (p[0], -d1, Z0 + p[1]), d, kind, sides)

    def nut_at(p, d0, d1):
        return bar(p, d0, d1, 7.9, "brass", 6)

    pins = []
    # Arbors: 4 mm steel rod in 6 mm brass tube bushes, one in each plate,
    # with brass collars to hold the wheels' places
    ends = {"M": (M, -2 * t - 1, d_mhand + t + 0.5), "G": (G, -2 * t - 1, d_hhand + 2 * t),
            "T": (Tt, -2 * t - 1, f0 + 0.5), "E": (E, -2 * t - 1, f0 + 0.5), "A": (A, d_pend - 0.5, f0 + 0.5)}
    for k, (p, d0, d1) in ends.items():
        pins += [bar(p, d0, d1, 4, "steel", 24), bar(p, -2 * t, 0, 6, "brass"), bar(p, d_front, f0, 6, "brass")]
    pins += [bar(G, 0, d_great, 6, "brass"), bar(G, d_flange + t, d_front, 6, "brass"), bar(G, f0, d_hhand, 6, "brass"),
             bar(M, 0, d_centre, 6, "brass"), bar(M, d_cpinion + 3 * t, d_front, 6, "brass"), bar(M, f0, d_cannon, 6, "brass"),
             bar(M, d_hour, d_hhand + t, 6, "brass"), bar(M, d_hhand + t + 0.5, d_mhand, 6, "brass"),
             bar(Tt, 0, d_third, 6, "brass"), bar(Tt, d_tpinion + 2 * t, d_front, 6, "brass"),
             bar(E, 0, d_escape, 6, "brass"), bar(E, d_epinion + 2 * t, d_front, 6, "brass"),
             bar(A, 0, d_escape, 6, "brass"), bar(A, d_escape + 2 * t, d_front, 6, "brass"), bar(A, d_pend + 4 * t, -2 * t, 6, "brass")]
    # Click pivot and spring pins, 4 mm rod glued in the great wheel, turning with it
    ca, sa = math.cos(math.radians(r_great)), math.sin(math.radians(r_great))
    cpin = polar(36, 128)
    fend = (cpin[0] + polar(36, 235)[0], cpin[1] + polar(36, 235)[1])
    spin = (fend[0] + polar(2.7, 325)[0], fend[1] + polar(2.7, 325)[1])
    for q, top in ((cpin, d_ratchet + t + 0.8), (spin, d_ratchet + t)):
        w = (G[0] + q[0] * ca - q[1] * sa, G[1] + q[0] * sa + q[1] * ca)
        pins.append(bar(w, d_great, top, 4, "steel", 24))
        if q is cpin:
            pins.append(bar(w, d_ratchet + t, d_ratchet + t + 0.8, 8, "steel"))
    # Pillars: M4 bolts, head on the front plate, 6 mm brass tubes between the
    # plates and out to the wall bar or pads, nut sunk in the nut layer
    for p in pillars:
        pins += [bar(p, d_wall - 2 * t, f0 + 2.8, 4, "steel", 24), bar(p, f0, f0 + 2.8, 7, "steel"),
                 bar(p, 0, d_front, 6, "brass"), bar(p, d_wall, -2 * t, 6, "brass"),
                 nut_at(p, d_wall - 2 * t, d_wall - 2 * t + 3)]
    # Dial posts: M4 bolts, nut inside the movement, tube up to the dial, head on its face
    for p in posts:
        pins += [bar(p, d_front - 3.2, d_dial + t + 2.8, 4, "steel", 24), nut_at(p, d_front - 3.2, d_front),
                 bar(p, f0, d_dial, 6, "brass"), bar(p, d_dial + t, d_dial + t + 2.8, 7, "steel")]
    # Minute wheel stud: M4 bolt, head inside the movement, a brass sleeve for
    # the minute wheel and pinion, washer and nut
    pins += [bar(S, d_front - 2.8, d_mpinion + 2 * t + 4, 4, "steel", 24), bar(S, d_front - 2.8, d_front, 7, "steel"),
             bar(S, f0, d_mpinion + 2 * t, 6, "brass"), bar(S, d_mpinion + 2 * t, d_mpinion + 2 * t + 0.8, 9, "steel"),
             nut_at(S, d_mpinion + 2 * t + 0.8, d_mpinion + 2 * t + 4)]
    # Pendulum: a 6 mm dowel between the channel layers, from 12 mm below the
    # arbor to 20 mm below the bob's centre
    dz = d_pend + 2 * t
    top, low = polar(12, swing - 90), polar(L + 20, swing - 90)
    pins.append(((A[0] + top[0], -dz, Z0 + A[1] + top[1]), (A[0] + low[0], -dz, Z0 + A[1] + low[1]), 6, "dowel", 24))
    # The wall screw in the top of the keyhole
    pins += [bar((0, A[1] + 5), d_wall - 2 * t - 12, d_wall + 1, 4, "steel", 24), bar((0, A[1] + 5), d_wall, d_wall + 1.5, 8, "steel")]
    # String off the left of the drum down to the weight
    sx, sd = G[0] - drum_r_string, d_drum + 2 * t
    wz = Z0 + G[1] - 75
    pins += [((sx, -sd, Z0 + G[1]), (sx, -sd, wz), 0.8, "steel", 8), ((sx, -sd, wz), (sx, -sd, wz - 100), 50, "steel", 32)]
    place.escape = a_escape
    return place, pins


drum_r_string = 18.4


def helix(t=3, theta=90):
    """The program's own assembly: the screw axis rises at 45 degrees from
    s = 0 (inner face of the lower end plate, 70 mm up), the board stands at
    y 58 to 61 with the track in front of it, and the trough dowels hang
    under the front of the screw. theta is the crank angle, anticlockwise
    seen from the crank; the screw plates and crank turn with it and the
    marbles sit in the pockets where the flight has carried them."""
    plates, step, tip, core = 120, 30, 27.5, 12
    flight, crank_r = 2, 35
    rod_r, rods = 34, (0, 20, 45, 70)
    tilt, z0 = 45, 70
    ct, st = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    avec, dvec, vvec = (ct, 0, st), (st, 0, -ct), (-st, 0, ct)
    s_screw = 3.5
    s_top = s_screw + plates * t
    s_upper = s_top + t + 0.5
    s_exit = s_upper - 33
    board_y, track_y = 58, 34
    D = 16

    def ax(s):
        return (s * ct, 0.0, z0 + s * st)

    def pt(s, dn, y):
        a = ax(s)
        return (a[0] + dvec[0] * dn, y, a[2] + dvec[2] * dn)

    def add(p, q):
        return tuple(a + b for a, b in zip(p, q))

    def mm(A, B):
        return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

    def rz(r):
        c, s = math.cos(math.radians(r)), math.sin(math.radians(r))
        return [[c, -s, 0], [s, c, 0], [0, 0, 1]]

    def euler(m):
        return (math.degrees(math.atan2(m[2][1], m[2][2])), -math.degrees(math.asin(max(-1, min(1, m[2][0])))),
                math.degrees(math.atan2(m[1][0], m[0][0])))

    def at(p, rot=(0, 0, 0)):
        return T(*p) @ R("Z", rot[2]) @ R("Y", rot[1]) @ R("X", rot[0])

    up_axis = [[0, vvec[0], avec[0]], [1, 0, 0], [0, vvec[2], avec[2]]]
    down_axis = [[0, vvec[0], -avec[0]], [-1, 0, 0], [0, vvec[2], -avec[2]]]

    def turned_up(a):
        return euler(mm(up_axis, rz(-90 - a)))

    def turned_down(a):
        return euler(mm(down_axis, rz(a - 90)))

    kappa = math.radians(20)
    ramp_d = 29 / math.cos(kappa)
    ramp_e = (-math.sin(kappa) * st, math.cos(kappa), math.sin(kappa) * ct)
    ramp_n = (-math.cos(kappa) * st, -math.sin(kappa), math.cos(kappa) * ct)
    ramp_frame = [[avec[0], ramp_e[0], ramp_n[0]], [0, ramp_e[1], ramp_n[1]], [avec[2], ramp_e[2], ramp_n[2]]]
    ramp_at = add(pt(30, ramp_d + t * math.cos(kappa), 0), (0, t * math.sin(kappa), 0))

    beta = math.degrees(math.atan(0.1))
    cb, sb = math.cos(math.radians(beta)), math.sin(math.radians(beta))

    def ze(y):
        return 262 - 0.1 * (y + 15)

    def zi(y):
        return 120 + 0.1 * (y - 31)

    hole_x, hole_y = 271, 47.5
    slope = 0.085
    sigma = math.degrees(math.atan(slope))
    drop = t + D + 2
    l1 = ze(hole_y) - t / cb - D - 1

    def top1(x):
        return l1 + slope * (x - hole_x)

    def top2(x):
        return top1(40) - drop - slope * (x - 40)

    def top3(x):
        return top2(270) - drop + slope * (x - 270)

    tops = (top1, top2, top3)
    legs = ((40, 284, 1), (19, 268, -1), (89, 288, 1))

    def leg_theta(g):
        return -g[2] * sigma

    def leg_origin(i):
        g = legs[i]
        th = math.radians(leg_theta(g))
        return (g[0] - t * math.sin(th), track_y, tops[i](g[0]) - t * math.cos(th))

    crank_s = -3 * t - 0.5
    q = math.radians(theta)
    handle = (dvec[0] * crank_r * math.cos(q), -crank_r * math.sin(q), dvec[2] * crank_r * math.cos(q))
    sideways = (90, 0, 90)

    def place(p, parts):
        n, c = p["name"], p["copy"]
        if n == "Screw plate":
            j = c - 1
            return at(ax(s_screw + j * t), turned_up(theta - step * j))
        if n == "Journal":
            s = (0, -t, s_upper, s_upper + t)[c - 1]
            return at(ax(s), turned_down(theta) if c <= 2 else turned_up(theta))
        if n == "Collar":
            s = (0.5, -2 * t - 0.5, s_top, s_upper + 2 * t + 0.5)[c - 1]
            return at(ax(s), turned_down(theta) if c == 2 else turned_up(theta))
        if n == "Crank":
            return at(ax(crank_s - (c - 1) * t), turned_down(theta))
        if n == "Grip ring":
            return at(add(ax(crank_s - 2 * t - 0.8 - (c - 1) * t), handle), turned_down(theta))
        if n == "Board":
            return at((0, board_y + t, 0), (90, 0, 0))
        if n == "Base":
            return T()
        if n == "Lower end plate":
            return at(ax(-(c - 1) * t), euler(down_axis))
        if n == "Upper end plate":
            return at(ax(s_upper + (c - 1) * t), euler(up_axis))
        if n == "Exit rib":
            return at(ax(s_exit - t), euler(up_axis))
        if n.startswith("Track floor "):
            i = int(n.split()[-1]) - 1
            return at(leg_origin(i), (0, leg_theta(legs[i]), 0))
        if n.startswith("Track rail "):
            i = int(n.split()[-1]) - 1
            x0 = legs[i][0] + (t if i == 1 else 0)
            return at((x0, track_y + t, tops[i](x0)), (90, leg_theta(legs[i]), 0))
        if n.startswith("End wall "):
            return at(((281, 19, 285)[int(n.split()[-1]) - 1], 0, 0), sideways)
        if n == "Exit floor":
            return at((0, -18 - t * sb, ze(-18) - t * cb), (-beta, 0, 0))
        if n == "Exit wall":
            return at(((255, 284)[c - 1], 0, 0), sideways)
        if n == "Exit front wall":
            return at((0, -15, 0), (90, 0, 0))
        if n == "Intake floor":
            return at((0, 31 + t * sb, zi(31) - t * cb), (beta, 0, 0))
        if n == "Intake wall":
            return at((89 - t, 0, 0), sideways)
        if n == "Intake back wall":
            return at((63, 0, 0), sideways)
        if n == "Ramp":
            return at(ramp_at, euler(ramp_frame))
        return None

    def axial(s0, s1, d, kind, sides=32, off=(0, 0, 0)):
        return (add(ax(s0), off), add(ax(s1), off), d, kind, sides)

    pins = [axial(-17, s_upper + 3 * t + 2, 10, "steel", 4)]
    # Four 6 mm dowels; the two the marble rides on stop in the exit rib
    for a in rods:
        r = math.radians(a)
        off = (dvec[0] * rod_r * math.cos(r), -rod_r * math.sin(r), dvec[2] * rod_r * math.cos(r))
        pins.append(axial(-2 * t, s_exit if a < 30 else s_upper + 2 * t, 6, "dowel", 32, off))
    # The grip: M4 x 25 bolt, head against the crank's inner face, washer,
    # four rings on a 6 mm brass sleeve, washer and nyloc
    face = crank_s - 2 * t
    pins += [axial(crank_s + 2.8, face - 0.8 - 4 * t - 0.8 - 5.6, 4, "steel", 24, handle),
             axial(crank_s, crank_s + 2.8, 7, "steel", 6, handle),
             axial(face - 0.8, face, 9, "steel", 32, handle),
             axial(face - 0.8 - 4 * t, face - 0.8, 6, "brass", 32, handle),
             axial(face - 1.6 - 4 * t, face - 0.8 - 4 * t, 9, "steel", 32, handle),
             axial(face - 1.6 - 4 * t - 4.8, face - 1.6 - 4 * t, 7.9, "brass", 6, handle)]

    # Marbles: one in each pocket from the intake to the top. A pocket is a
    # stretch of the trough where a marble clears every plate's tooth; it
    # rests at the bottom of it, between the two trough dowels.
    g = flight * step
    nest_r, nest_a = 24.2, 10.0
    my, mz = nest_r * math.sin(math.radians(nest_a)), nest_r * math.cos(math.radians(nest_a))

    def tooth_gap(j, rho):
        """How far the marble's section (radius rho) is from plate j's tooth."""
        a0 = theta - step * j
        rel = (nest_a - a0 + 180) % 360 - 180
        if abs(rel) <= g / 2:
            return max(9 - nest_r, nest_r - tip) - rho
        best = 99
        for e in (a0 - g / 2, a0 + g / 2):
            ex, ey = math.cos(math.radians(e)), math.sin(math.radians(e))
            px, py = mz, my
            along = min(max(px * ex + py * ey, 9), tip)
            best = min(best, math.hypot(px - along * ex, py - along * ey))
        return best - rho

    def free(s):
        for j in range(int((s - 8 - s_screw) // t) - 1, int((s + 8 - s_screw) // t) + 2):
            if j < 0 or j >= plates:
                continue
            lo, hi = s_screw + j * t, s_screw + j * t + t
            dz = 0 if lo <= s <= hi else min(abs(s - lo), abs(s - hi))
            if dz >= 8:
                continue
            if tooth_gap(j, math.sqrt(64 - dz * dz)) < 0.05:
                return False
        return True

    balls = []
    # Start inside a tooth's reach, so the first marble sits at a pocket's bottom
    s, was = 40.0, True
    while s < s_exit:
        ok = free(s)
        if ok and not was:
            balls.append(pt(s, mz, -my) + (D,))
        was = ok
        s += 0.1
    # Three on the way back down, one on each leg
    for i, x in ((0, 150), (1, 205), (2, 160)):
        balls.append((x, 47.5, tops[i](x) + 8 / math.cos(math.radians(sigma)), D))
    # Marble centres down the return path, for helix_loop: along the exit
    # floor to its hole, along each leg and over its end, through the intake
    # and onto the ramp, 2.5 mm under the intake's edge
    k = 8 / math.cos(math.radians(sigma))
    land_y = 27
    ramp_c = add(ramp_at, tuple((t + 8) * v for v in ramp_n))
    land_e = (land_y - ramp_c[1]) / ramp_e[1]
    land_a = (76 - ramp_c[0] - land_e * ramp_e[0]) / avec[0]
    place.axis, place.nest = avec, lambda s: pt(s, mz, -my) + (D,)
    place.route = [(271, -4, ze(-4) + 8 / cb), (271, hole_y, ze(hole_y) + 8 / cb),
                   (271, hole_y, top1(271) + k), (40, hole_y, top1(40) + k), (32, hole_y, top1(40) + k - 1),
                   (30, hole_y, top2(30) + k), (268, hole_y, top2(268) + k), (276, hole_y, top2(268) + k - 1),
                   (276, hole_y, top3(276) + k), (89, hole_y, top3(89) + k),
                   (76, hole_y, top3(89) + k - 4), (76, hole_y, zi(hole_y) + 8 / cb), (76, 31, zi(31) + 8 / cb),
                   tuple(c + land_a * a + land_e * e for c, a, e in zip(ramp_c, avec, ramp_e))]
    return place, pins, balls


def helix_loop(t=3, theta=90):
    """helix() with twelve marbles going round for good. Pocket bottoms rise
    36 mm a turn. A marble lands on the ramp from the intake, rolls into the
    pocket under it and rides up to the top one, which helix() empties at
    298.5; then it rolls back down the chute, track and intake."""
    place, pins, _ = helix(t, theta)
    axis = place.axis

    def along(p):
        return sum(a * (b - c) for a, b, c in zip(axis, p, place.nest(0)))

    base = sorted(helix(t, 240)[2][:-3])[0]
    s_out = along(sorted(helix(t, 298)[2][:-3])[-1])
    # Join the pocket whose bottom is 10 mm under the landing, at the moment it is there
    s_in = along(place.route[-1]) - 10
    lag = ((s_in - along(base)) / 0.1) % 360
    s_in = along(base) + 0.1 * lag + 36 * math.floor((s_in - along(base) - 0.1 * lag) / 36 + 0.5)
    enter, stay, cycle = 240 + lag, (s_out - s_in) / 0.1, 12 * 360
    # Pushed on past the low dowels' ends, it rolls off the upper two and
    # drops clear of the exit rib onto the chute (a step-by-step fall)
    fall = [(259.1, -4.6, 292.1), (265.9, -5.8, 289.5), (275.4, -6.5, 278.9)]
    path = [place.nest(s_out)[:3]] + fall + place.route + [place.nest(s_in)[:3]]
    # Drops take less time than rolling the same distance
    legs = [math.dist(a, b) * (0.4 if abs(b[2] - a[2]) > math.dist(a[:2], b[:2]) else 1) for a, b in zip(path, path[1:])]
    balls = []
    for i in range(12):
        age = (theta - enter + 360 * i) % cycle
        if age < stay:
            balls.append(place.nest(s_in + 0.1 * age))
            continue
        d = (age - stay) / (cycle - stay) * sum(legs)
        j = 0
        while j < len(legs) - 1 and d > legs[j]:
            d -= legs[j]
            j += 1
        f = min(1, d / legs[j])
        balls.append(tuple(a + (b - a) * f for a, b in zip(path[j], path[j + 1])) + (16,))
    return place, pins, balls


_fracture_place, _fracture_pins = relief([polar(192, a) for a in (30, 150, 270)])
_morphogen_place, _morphogen_pins = relief([polar(172, a) for a in (20, 142, 268)])
_orbit_place, _orbit_pins = orbit()
_trace_place, _trace_pins, _trace_flats = trace()
_stride_place, _stride_pins = stride()
_tidal_place, _tidal_pins = tidal()
_ascent_place, _ascent_pins, _ascent_balls = ascent()
_expanse_place, _expanse_pins = expanse()
_celestial_place, _celestial_pins = celestial()
_flight_place, _flight_pins = flight()
_bloom_place, _bloom_pins = bloom()
_index_place, _index_pins = index_sequencer()
_vault_place, _vault_pins = vault()
_inversor_place, _inversor_pins, _inversor_flats = inversor()
_weave_place, _weave_pins, _weave_flats = weave()
_echo_place, _echo_pins, _echo_flats = echo()
_peck_place, _peck_pins = peck()
_dabble_place, _dabble_pins = dabble()
_lambda_place, _lambda_pins = lambda_()
_crawl_place, _crawl_pins = crawl()
_wellspring_place, _wellspring_pins = wellspring()
_cascade_place, _cascade_pins, _cascade_balls = cascade()
_tally_place, _tally_pins = tally()
_tempo_place, _tempo_pins = tempo()
_hours_place, _hours_pins = hours()
_helix_place, _helix_pins, _helix_balls = helix_loop()

ASSEMBLIES = {
    "fracture": {"place": _fracture_place, "pins": _fracture_pins(5), "view": {"azimuth": -20, "elevation": 40}},
    "morphogen": {"place": _morphogen_place, "pins": _morphogen_pins(4), "view": {"azimuth": -20, "elevation": 40}},
    # Four crank turns, one turn of the carrier
    "orbit": {"place": _orbit_place, "pins": _orbit_pins, "view": {"azimuth": -25, "elevation": 38},
              "motion": {"recipe": orbit, "pose": lambda u: {"theta": 1440 * u}, "frames": 288}},
    # Three turns, the whole drawing
    "trace": {"place": _trace_place, "pins": _trace_pins, "flats": _trace_flats, "view": {"azimuth": -25, "elevation": 38},
              "motion": {"recipe": trace, "pose": lambda u: {"theta": 1080 * u}, "frames": 288}},
    "stride": {"place": _stride_place, "pins": _stride_pins, "view": {"azimuth": -32, "elevation": 14},
               "motion": {"recipe": stride, "pose": lambda u: {"theta": 360 * u}, "frames": 96}},
    "tidal": {"place": _tidal_place, "pins": _tidal_pins, "view": {"azimuth": -38, "elevation": 22},
              "motion": {"recipe": tidal, "pose": lambda u: {"theta": 360 * u}, "frames": 96}},
    # One crank turn: each of the six pockets lets a marble roll down the chute
    "ascent": {"place": _ascent_place, "pins": _ascent_pins, "balls": _ascent_balls, "view": {"azimuth": 30, "elevation": 28},
               "motion": {"recipe": ascent, "frames": 144,
                          "pose": lambda u: {"theta": 360 * u, "ball_x": 75 + 170 * (6 * u % 1)}}},
    # The trays slide out and back
    "expanse": {"place": _expanse_place, "pins": _expanse_pins, "view": {"azimuth": -24, "elevation": 48},
                "motion": {"recipe": expanse, "pose": lambda u: {"theta": 74 - 59 * (1 - math.cos(2 * math.pi * u)) / 2}, "frames": 144}},
    # Two crank turns: the outer orbit goes round once
    "celestial": {"place": _celestial_place, "pins": _celestial_pins, "view": {"azimuth": -30, "elevation": 38},
                  "motion": {"recipe": celestial, "pose": lambda u: {"theta": 432 + 720 * u}, "frames": 240}},
    "flight": {"place": _flight_place, "pins": _flight_pins, "view": {"azimuth": -30, "elevation": 16},
               "motion": {"recipe": flight, "pose": lambda u: {"theta": 360 * u}, "frames": 72}},
    # The flower opens and closes
    "bloom": {"place": _bloom_place, "pins": _bloom_pins, "view": {"azimuth": -25, "elevation": 40},
              "motion": {"recipe": bloom, "pose": lambda u: {"ring": 55 - 40 * (1 - math.cos(2 * math.pi * u)) / 2}, "frames": 144}},
    # Four turns of the driver, one turn of the wheel
    "index-sequencer": {"place": _index_place, "pins": _index_pins, "view": {"azimuth": -25, "elevation": 38},
                        "motion": {"recipe": index_sequencer, "pose": lambda u: {"theta": -18 + 1440 * u}, "frames": 288}},
    # Dial the code, slide the fence, lift the lid out; then back again
    "vault": {"place": _vault_place, "pins": _vault_pins, "view": {"azimuth": -28, "elevation": 30},
              "motion": {"recipe": vault, "pose": vault_pose, "frames": 288}},
    "inversor": {"place": _inversor_place, "pins": _inversor_pins, "flats": _inversor_flats,
                 "view": {"azimuth": -18, "elevation": 52},
                 "motion": {"recipe": inversor, "pose": lambda u: {"swing": 44 * math.sin(2 * math.pi * u)}, "frames": 120}},
    # The whole drawing, 42 crank turns, in 30 seconds
    "weave": {"place": _weave_place, "pins": _weave_pins, "flats": _weave_flats, "view": {"azimuth": -22, "elevation": 50},
              "motion": {"recipe": weave, "pose": lambda u: {"theta": 340 + 42 * 360 * u}, "frames": 720}},
    # The stylus traces the original flower
    "echo": {"place": _echo_place, "pins": _echo_pins, "flats": _echo_flats, "view": {"azimuth": -28, "elevation": 52},
             "motion": {"recipe": echo, "frames": 192, "pose": lambda u: (lambda a: {
                 "sx": 0.5 + 0.3 * (1 + 0.25 * math.cos(5 * a)) * math.cos(a),
                 "sy": 0.5 + 0.3 * (1 + 0.25 * math.cos(5 * a)) * math.sin(a)})(math.pi / 2 + 2 * math.pi * u)}},
    "peck": {"place": _peck_place, "pins": _peck_pins, "view": {"azimuth": -30, "elevation": 19},
             "motion": {"recipe": peck, "pose": lambda u: {"swing": 165 + 360 * u}, "frames": 72}},
    "dabble": {"place": _dabble_place, "pins": _dabble_pins, "view": {"azimuth": -30, "elevation": 18},
               "motion": {"recipe": dabble, "pose": lambda u: {"theta": 95 + 360 * u}, "frames": 96}},
    "lambda": {"place": _lambda_place, "pins": _lambda_pins, "view": {"azimuth": 52, "elevation": 12},
               "motion": {"recipe": lambda_, "pose": lambda u: {"theta": 360 * u}, "frames": 96}},
    "crawl": {"place": _crawl_place, "pins": _crawl_pins, "view": {"azimuth": 32, "elevation": 20},
              "motion": {"recipe": crawl, "pose": lambda u: {"theta": 90 + 360 * u}, "frames": 96}},
    # One round of the ox turns the wheel three times
    "wellspring": {"place": _wellspring_place, "pins": _wellspring_pins, "view": {"azimuth": 55, "elevation": 30},
                   "motion": {"recipe": wellspring, "pose": lambda u: {"theta": 195 + 360 * u}, "frames": 288}},
    # Counting up from 0 to 31, half a second a number
    "cascade": {"place": _cascade_place, "pins": _cascade_pins, "balls": _cascade_balls,
                "view": {"azimuth": -20, "elevation": 22},
                "motion": {"recipe": cascade, "pose": lambda u: {"value": min(31, int(32 * u))}, "frames": 384}},
    # Thirty one-second swings, one turn of the escape wheel
    "tempo": {"place": _tempo_place, "pins": _tempo_pins, "view": {"azimuth": -18, "elevation": 12},
              "motion": {"recipe": tempo, "pose": lambda u: {"phase": 15 + 360 * 30 * u}, "frames": 720}},
    # Forty swings at the real beat, one turn of the escape wheel
    "hours": {"place": _hours_place, "pins": _hours_pins, "view": {"azimuth": -22, "elevation": 14},
              "motion": {"recipe": hours, "pose": hours_pose, "frames": 960, "fps": 16}},
    # Ten turns of the crank, 2020 to 2029, two seconds a turn
    "tally": {"place": _tally_place, "pins": _tally_pins, "view": {"azimuth": 30, "elevation": 46},
              "motion": {"recipe": tally, "frames": 480,
                         "pose": lambda u: {"count": 2020 + min(9, int(10 * u)), "crank": 360 * (10 * u - min(9, int(10 * u)))}}},
    # One turn of the crank: every marble climbs a pocket, one leaves at the top, one drops in at the bottom
    "helix": {"place": _helix_place, "pins": _helix_pins, "balls": _helix_balls,
              "view": {"azimuth": -36, "elevation": 22},
              "motion": {"recipe": helix_loop, "pose": lambda u: {"theta": 90 + 360 * u}, "frames": 96}},
    "box": {"place": box_parts(120, 80, 50, 3)},
    "phone-stand": {"place": phone_stand},
    "pocket-owl": {"place": placed, "view": {"azimuth": 50, "elevation": 16}},
    "pocket-dinosaur": {"place": placed, "view": {"azimuth": 40, "elevation": 20}},
    "pocket-dragonfly": {"place": placed, "view": {"azimuth": 45, "elevation": 30}},
    "solstice": {"place": solstice},
    "hadal": {"place": hadal, "view": {"azimuth": -50, "elevation": 24}},
    "xenospora": {"place": xenospora, "view": {"azimuth": -20, "elevation": 18}},
    "tilt-maze": {
        "place": stack(tilt_maze_order),
        "balls": [(14.25, 14.25, 3 + 3, 6)],
        "view": {"elevation": 48},
    },
    "topo-island": {"place": stack(topo_order), "view": {"azimuth": -25, "elevation": 38}},
    "drawer-organizer": {"place": drawer_organizer(), "view": {"elevation": 45}},
    "gears": {"place": gears, "view": {"elevation": 50}},
    "slot-desk-sign": {"place": slot_desk_sign(), "view": {"azimuth": -14, "elevation": 20}},
    "morph": {"place": morph(), "rods": morph_rods(), "view": {"azimuth": -30, "elevation": 22}},
    "wave-cathedral": {"place": wave_cathedral, "view": {"azimuth": -40, "elevation": 26}},
    # The picture shows what Umbra is for: the dragon's shadow on a wall
    # 900 mm away, from a point light at the pinhole. Only the parts go
    # into the GLB.
    "umbra": {
        "place": umbra,
        "wall": {"y": 900, "x": (-330, 230), "z": (-3, 520)},
        "point": (0, 1, 25, 18),
        "view": {"azimuth": -28, "elevation": 14, "lights": False, "world": 0.2, "fill": 0.92},
    },
}
