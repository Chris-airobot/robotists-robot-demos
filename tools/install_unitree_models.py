#!/usr/bin/env python3
"""Download official BSD-3-Clause Unitree Go2 / A1 DAE meshes (stdlib only).

Usage:
    python3 tools/install_unitree_models.py --all
    python3 tools/install_unitree_models.py --robot go2
    python3 tools/install_unitree_models.py --robot a1

The URDF files + pinned checksums are versioned in Git; large manufacturer
meshes are downloaded locally, not checked into Robotists by default.
"""

import argparse
import hashlib
import json
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "models/unitree_assets.json").read_text(encoding="utf-8"))
MODEL_REPO = MANIFEST["sourceRepo"]
COMMIT = MANIFEST["sourceCommit"]


def git_blob_hash(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def download_one(robot: str, spec: dict) -> str:
    target = ROOT / "models" / robot / "meshes" / spec["name"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and git_blob_hash(target.read_bytes()) == spec["gitBlobSha"]:
        return f"{robot}/{spec['name']}: already verified ({spec['bytes'] / 1048576:.1f} MiB)"

    urls = [
        f"https://raw.githubusercontent.com/{MODEL_REPO}/{COMMIT}/{spec['remote']}",
        f"https://cdn.jsdelivr.net/gh/{MODEL_REPO}@{COMMIT}/{spec['remote']}",
    ]
    last_error = None
    for url in urls:
        for attempt in range(1, 3):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Robotists-Motion-Library/0.2",
                })
                with urllib.request.urlopen(req, timeout=55) as response:
                    data = response.read()
                if len(data) != spec["bytes"]:
                    raise ValueError(f"wrong file size {len(data)} != {spec['bytes']}")
                if git_blob_hash(data) != spec["gitBlobSha"]:
                    raise ValueError("GitHub blob checksum mismatch")
                target.with_suffix(target.suffix + ".part").write_bytes(data)
                target.with_suffix(target.suffix + ".part").replace(target)
                return f"{robot}/{spec['name']}: downloaded + verified ({len(data) / 1048576:.1f} MiB)"
            except (OSError, urllib.error.URLError, ValueError) as exc:
                last_error = str(exc)
                time.sleep(attempt)
    raise RuntimeError(
        f"{robot}/{spec['name']} failed from source + CDN: {last_error}. "
        "Check network access to raw.githubusercontent.com."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--robot", choices=sorted(MANIFEST["robots"]))
    args = parser.parse_args()

    robots = list(MANIFEST["robots"]) if args.all else [args.robot]
    jobs = [(robot, spec) for robot in robots for spec in MANIFEST["robots"][robot]]
    print(
        f"Unitree source: {MODEL_REPO}@{COMMIT[:12]} "
        f"[{MANIFEST['license']}]\nFetching {len(jobs)} manufacturer mesh files...",
        flush=True,
    )
    failures = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(download_one, robot, spec): (robot, spec["name"])
                   for robot, spec in jobs}
        for task in as_completed(futures):
            try:
                print("✓", task.result(), flush=True)
            except Exception as exc:
                failures.append(str(exc))
                print("✗", exc, flush=True)

    if failures:
        raise SystemExit(
            f"\n{len(failures)} download(s) failed. Already downloaded files "
            "are safe and verified; rerun the same command to resume."
        )
    print("\nAll assets ready. Run the Vite web viewer and select Go2 or A1.", flush=True)


if __name__ == "__main__":
    main()
