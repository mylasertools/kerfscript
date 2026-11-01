"""Makes a finger-jointed box for every size in SIZES, from Python.

KerfScript runs as a WebAssembly module, so no Node.js is needed:

    pip install wasmtime
    python generate.py path/to/kerfscript.wasm [out-folder]

Download kerfscript-<version>.wasm from the KerfScript releases, or build it
with `npm run wasm`. Each box is written as SVG and DXF files, one per sheet.
"""

import json
import os
import sys
import tempfile

from wasmtime import Engine, Linker, Module, Store, WasiConfig

DESIGN = """
use <kerf/box>
width = 120;
depth = 80;
height = 50;
$thickness = 3;
$kerf = 0.15;
box([width, depth, height], lid = true);
"""

# width, depth, height in millimetres
SIZES = [(80, 60, 40), (120, 80, 50), (200, 150, 60)]


class KerfScript:
    """Compiles the module once; each request runs in a fresh instance."""

    def __init__(self, wasm_path):
        self.engine = Engine()
        self.module = Module.from_file(self.engine, wasm_path)
        self.linker = Linker(self.engine)
        self.linker.define_wasi()

    def run(self, request):
        with tempfile.TemporaryDirectory() as d:
            inp, out = os.path.join(d, "in.json"), os.path.join(d, "out.json")
            with open(inp, "w", encoding="utf-8") as f:
                json.dump(request, f)
            wasi = WasiConfig()
            wasi.stdin_file = inp
            wasi.stdout_file = out
            store = Store(self.engine)
            store.set_wasi(wasi)
            self.linker.instantiate(store, self.module).exports(store)["_start"](store)
            with open(out, encoding="utf-8") as f:
                return json.load(f)


def main():
    wasm = sys.argv[1] if len(sys.argv) > 1 else "kerfscript.wasm"
    out = sys.argv[2] if len(sys.argv) > 2 else "out"
    os.makedirs(out, exist_ok=True)
    kerf = KerfScript(wasm)
    for width, depth, height in SIZES:
        result = kerf.run(
            {
                "source": DESIGN,
                "params": {"width": width, "depth": depth, "height": height},
                "sheet": [400, 300],
            }
        )
        if not result["ok"]:
            sys.exit(f"{width}x{depth}x{height}: {result['error']}")
        name = f"box-{width}x{depth}x{height}"
        for i, sheet in enumerate(result["sheets"], start=1):
            for ext in ("svg", "dxf"):
                with open(os.path.join(out, f"{name}-{i}.{ext}"), "w", encoding="utf-8", newline="") as f:
                    f.write(sheet[ext])
        cut = sum(p["cutLength"] * p["qty"] for p in result["parts"])
        print(f"{name}: {len(result['parts'])} panels on {len(result['sheets'])} sheet(s), {cut:.0f} mm of cutting")
        for warning in result["warnings"]:
            print(f"  {warning}")


if __name__ == "__main__":
    main()
