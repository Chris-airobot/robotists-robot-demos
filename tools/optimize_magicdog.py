#!/usr/bin/env python3
"""Create browser-optimized GLB meshes without changing original robot assets.

Usage:
  python tools/optimize_magicdog.py --keep-ratio 0.10

Dependencies:
  python -m pip install trimesh fast-simplification

The repository's web viewer automatically prefers magicdog_web.urdf
when it exists, otherwise it loads the original magicdog_repaint.urdf.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import copy
import re
import sys
import time
import xml.etree.ElementTree as ET

try:
    import numpy as np
    import trimesh
    import fast_simplification  # noqa: F401  # required by trimesh simplify
except ImportError as exc:
    sys.exit(
        f"Missing dependency: {exc}\n"
        "Run: python -m pip install trimesh fast-simplification numpy"
    )

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "magicdog"
ORIGINAL_URDF = MODEL_DIR / "urdf" / "magicdog_repaint.urdf"
OPTIMIZED_URDF = MODEL_DIR / "urdf" / "magicdog_web.urdf"
MESH_DIR = MODEL_DIR / "meshes"
OUTPUT_DIR = MODEL_DIR / "web_meshes"


def colored_visual(original: trimesh.Trimesh, simplified: trimesh.Trimesh) -> None:
    """Preserve a material's flat color after decimation.

    The MagicDog Blender OBJ exports use distinct named, flat-color MTL
    materials rather than UV-mapped textures.
    """
    visual = original.visual
    if isinstance(visual, trimesh.visual.TextureVisuals):
        # Old UV indexing may no longer match simplified vertices.
        # MTL color remains attached to each separate submesh.
        simplified.visual = trimesh.visual.TextureVisuals(
            material=copy.deepcopy(visual.material)
        )
        return

    if isinstance(visual, trimesh.visual.ColorVisuals):
        if visual.kind == "face" and len(visual.face_colors):
            avg = np.mean(visual.face_colors, axis=0).astype(np.uint8)
        elif visual.kind == "vertex" and len(visual.vertex_colors):
            avg = np.mean(visual.vertex_colors, axis=0).astype(np.uint8)
        else:
            return
        simplified.visual = trimesh.visual.ColorVisuals(
            mesh=simplified, face_colors=np.broadcast_to(avg, (len(simplified.faces), 4)).copy()
        )


def optimize_one(name: str, keep_ratio: float, min_faces: int) -> tuple[int, int, int]:
    src = MESH_DIR / (name + ".obj")
    dst = OUTPUT_DIR / (name + ".glb")
    started = time.perf_counter()
    print(f"\n[{name}] reading {src.stat().st_size / 1024**2:.1f} MiB OBJ", flush=True)

    source_scene = trimesh.load(src, force="scene", process=False)
    result = trimesh.Scene()

    total_before, total_after = 0, 0
    converted = {}
    for key, mesh in source_scene.geometry.items():
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
            continue
        before = len(mesh.faces)
        total_before += before

        if before >= min_faces:
            target = max(min_faces, int(before * keep_ratio))
            target = min(target, before)
            reduced = mesh.simplify_quadric_decimation(face_count=target, aggression=7) if target < before else mesh.copy()
        else:
            reduced = mesh.copy()

        colored_visual(mesh, reduced)
        total_after += len(reduced.faces)
        converted[key] = reduced

    # Preserve scene graph transforms, including disconnected OBJ objects.
    for node in source_scene.graph.nodes_geometry:
        transform, key = source_scene.graph[node]
        if key not in converted:
            continue
        result.add_geometry(
            converted[key], geom_name=key, node_name=node, transform=transform
        )

    if not result.geometry:
        raise RuntimeError(f"No valid mesh geometry in {src}")

    output = result.export(file_type="glb")
    dst.write_bytes(output)
    print(
        f"[{name}] {total_before:,} -> {total_after:,} triangles "
        f"({100 * total_after / max(1, total_before):.1f}% retained) "
        f"| GLB {len(output) / 1024**2:.2f} MiB "
        f"| {time.perf_counter() - started:.1f}s",
        flush=True,
    )
    return total_before, total_after, len(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keep-ratio", type=float, default=0.10,
        help="Target fraction of triangles retained in complex meshes (default 0.10)",
    )
    parser.add_argument(
        "--min-faces", type=int, default=700,
        help="Avoid decimating small parts below this many triangles",
    )
    args = parser.parse_args()
    if not (0.01 <= args.keep_ratio <= 1.0):
        parser.error("--keep-ratio must be in [0.01, 1.0]")
    if not ORIGINAL_URDF.is_file():
        sys.exit(f"Missing URDF: {ORIGINAL_URDF}")
    OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

    tree = ET.parse(ORIGINAL_URDF)
    filenames = sorted({
        Path(mesh.attrib["filename"]).stem
        for mesh in tree.findall(".//mesh")
        if mesh.attrib.get("filename", "").lower().endswith(".obj")
    })
    if not filenames:
        sys.exit("No OBJ mesh references in the source URDF")

    stats = []
    for name in filenames:
        stats.append(optimize_one(name, args.keep_ratio, args.min_faces))

    # Write only after *all* GLBs are successfully generated to avoid
    # making the viewer prefer a half-finished optimized model.
    urdf = ORIGINAL_URDF.read_text(encoding="utf-8")
    for name in filenames:
        orig = "../meshes/" + name + ".obj"
        web = "../web_meshes/" + name + ".glb"
        if orig not in urdf:
            raise RuntimeError(f"URDF missing expected mesh reference {orig}")
        urdf = urdf.replace(orig, web)

    OPTIMIZED_URDF.write_text(urdf, encoding="utf-8")
    print(
        "\nDone: generated", OPTIMIZED_URDF,
        f"\nTotal triangles: {sum(a for a,b,c in stats):,} -> {sum(b for a,b,c in stats):,}",
        f"\nTotal GLB size: {sum(c for a,b,c in stats) / 1024**2:.2f} MiB",
        "\nRefresh http://localhost:5173 to use the faster GLB robot.",
        sep="",
    )


if __name__ == "__main__":
    main()
