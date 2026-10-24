#!/usr/bin/env python3
"""Create a material-preserving, reduced-face OBJ set for MagicDog.

Unlike the experimental GLB converter, this retains the original coordinate
conventions, Wavefront OBJ materials (usemtl) and exact MTL color definitions.

Run from the repository root:
    .venv-mesh/bin/python tools/optimize_magicdog_obj.py --keep-ratio 0.35

Compare in the browser:
    http://localhost:5173/                reference original OBJ+MTL
    http://localhost:5173/?model=fast     simplified OBJ+MTL

This never touches the original Isaac Sim URDF / meshes.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

try:
    import numpy as np
    import trimesh
    import fast_simplification  # noqa: F401
except ImportError as error:
    sys.exit(
        f"Missing required Python package: {error}\n"
        "Install into .venv-mesh: pip install numpy trimesh fast-simplification"
    )

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "models/magicdog"
SOURCE_DIR = MODEL / "meshes"
OUTPUT_DIR = MODEL / "web_obj"
ORIGINAL_URDF = MODEL / "urdf/magicdog_repaint.urdf"
OUTPUT_URDF = MODEL / "urdf/magicdog_fast.urdf"


def fmt_vec(row):
    return " ".join(f"{float(v):.8g}" for v in row)


def mtl_names(path):
    return {
        line.split(maxsplit=1)[1].strip()
        for line in path.read_text().splitlines()
        if line.strip().startswith("newmtl ")
    }


def segments_from_node(mesh, ratio, threshold):
    # Important: mesh materials often contain many disconnected pieces.
    # Preserve small disconnected pieces; do not decimate a robot's screws
    # away just because they share a material with the huge body shell.
    if len(mesh.faces) > threshold:
        return mesh.split(only_watertight=False, repair=False)
    return [mesh]


def convert_mesh(name: str, ratio: float, threshold: int):
    source = SOURCE_DIR / (name + ".obj")
    source_mtl = SOURCE_DIR / (name + ".mtl")
    target = OUTPUT_DIR / (name + ".obj")
    if not source.is_file() or not source_mtl.is_file():
        raise FileNotFoundError(source if not source.is_file() else source_mtl)
    valid_materials = mtl_names(source_mtl)

    scene = trimesh.load(source, force="scene", process=False)
    before = 0
    after = 0
    by_material = set()
    # Write with the same per-object coordinate system and named materials.
    # OBJLoader and MTLLoader now see exactly the same material identifiers.
    with target.open("w", encoding="utf-8") as dest:
        dest.write("# Web-optimized geometry with original MTL palette\n")
        dest.write("mtllib " + name + ".mtl\n")
        index = 1
        normal_index = 1

        for node in scene.graph.nodes_geometry:
            transform, geom_name = scene.graph[node]
            original = scene.geometry[geom_name]
            if not isinstance(original, trimesh.Trimesh) or len(original.faces) == 0:
                continue

            mat = getattr(getattr(original.visual, "material", None), "name", None)
            if mat not in valid_materials:
                # Fail explicitly rather than silently destroying material colors.
                raise ValueError(
                    f"{name}: geometry '{geom_name}' has material '{mat}', "
                    f"not in {sorted(valid_materials)}"
                )
            by_material.add(mat)

            # Material is constant per original trimesh geometry.
            parts = segments_from_node(original, ratio, threshold)
            for part_idx, part in enumerate(parts):
                if len(part.faces) == 0:
                    continue
                before += len(part.faces)
                reduced = part.copy()
                if len(part.faces) > threshold and ratio < 1:
                    target_count = max(threshold, round(len(part.faces) * ratio))
                    target_count = min(target_count, len(part.faces))
                    if target_count < len(part.faces):
                        try:
                            reduced = part.simplify_quadric_decimation(
                                face_count=target_count, aggression=5
                            )
                        except (ValueError, RuntimeError) as exc:
                            print(f"  Warning: skipping decimation of {name}/{mat}: {exc}")

                reduced.apply_transform(transform)
                after += len(reduced.faces)

                dest.write(f"o {name}_{node}_{part_idx}\n")
                dest.write(f"usemtl {mat}\n")
                dest.write("s 1\n")
                for vertex in reduced.vertices:
                    dest.write("v " + fmt_vec(vertex) + "\n")
                for normal in reduced.vertex_normals:
                    dest.write("vn " + fmt_vec(normal) + "\n")
                for face in reduced.faces:
                    v = [index + int(i) for i in face]
                    n = [normal_index + int(i) for i in face]
                    dest.write(
                        f"f {v[0]}//{n[0]} {v[1]}//{n[1]} {v[2]}//{n[2]}\n"
                    )
                index += len(reduced.vertices)
                normal_index += len(reduced.vertices)

    shutil.copy2(source_mtl, OUTPUT_DIR / (name + ".mtl"))
    print(
        f"{name:>6}: {before:,} -> {after:,} triangles "
        f"({100 * after / max(before, 1):.1f}%), "
        f"{target.stat().st_size / 1024**2:.1f} MiB, "
        f"MTL: {', '.join(sorted(by_material))}",
        flush=True,
    )
    return before, after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-ratio", type=float, default=.35)
    parser.add_argument("--min-faces", type=int, default=2000)
    args = parser.parse_args()
    if not (.1 <= args.keep_ratio <= 1):
        parser.error("keep ratio must be between 0.1 and 1")
    if args.min_faces < 200:
        parser.error("--min-faces must be >= 200")
    if not ORIGINAL_URDF.is_file():
        raise FileNotFoundError(ORIGINAL_URDF)

    tree = ET.parse(ORIGINAL_URDF)
    names = sorted({
        Path(mesh.get("filename")).stem
        for mesh in tree.findall(".//mesh")
        if mesh.get("filename", "").lower().endswith(".obj")
    })
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = [convert_mesh(name, args.keep_ratio, args.min_faces) for name in names]

    # Make the new URDF available only after *all* meshes are generated.
    urdf = ORIGINAL_URDF.read_text(encoding="utf-8")
    for name in names:
        original = "../meshes/" + name + ".obj"
        replacement = "../web_obj/" + name + ".obj"
        if original not in urdf:
            raise ValueError(f"Original URDF has no reference to {original}")
        urdf = urdf.replace(original, replacement)
    OUTPUT_URDF.write_text(urdf, encoding="utf-8")
    print(f"\nCreated: {OUTPUT_URDF}", flush=True)
    print(
        f"Triangles in four unique meshes: "
        f"{sum(a for a, _ in results):,} -> {sum(b for _, b in results):,}"
    )
    print("Test: http://localhost:5173/?model=fast")
    print("Reference: http://localhost:5173/")


if __name__ == "__main__":
    main()
