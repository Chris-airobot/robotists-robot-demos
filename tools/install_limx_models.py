#!/usr/bin/env python3
"""Install officially published LimX OLI / LUNA visual STLs, with SHA checks.

One-time use from the Robotists repo root:
    python3 tools/install_limx_models.py --all
    python3 tools/install_limx_models.py --robot oli

Meshes stay gitignored; URDFs and pinned per-file metadata remain in Git.
"""
import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'models/limx_assets.json').read_text(encoding='utf-8'))


def sha_git_blob(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()


def fetch_one(robot_id, config, entry):
    dst = ROOT / 'models' / robot_id / 'meshes' / entry['name']
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_file() and sha_git_blob(dst.read_bytes()) == entry['gitBlobSha']:
        return f'{robot_id}/{entry["name"]}: already verified'

    repo, commit, remote = config['repo'], config['commit'], entry['remote']
    urls = [
        f'https://raw.githubusercontent.com/{repo}/{commit}/{remote}',
        f'https://cdn.jsdelivr.net/gh/{repo}@{commit}/{remote}',
    ]
    last_error = ''
    for url in urls:
        for attempt in (1, 2):
            try:
                request = urllib.request.Request(
                    url, headers={'User-Agent': 'Robotists-Motion-Studio/0.3'}
                )
                with urllib.request.urlopen(request, timeout=70) as response:
                    data = response.read()
                if len(data) != entry['bytes']:
                    raise ValueError('Incorrect download size')
                if sha_git_blob(data) != entry['gitBlobSha']:
                    raise ValueError('Source blob checksum does not match')
                tmp = dst.with_suffix(dst.suffix + '.part')
                tmp.write_bytes(data)
                tmp.replace(dst)
                return f'{robot_id}/{entry["name"]}: downloaded + verified'
            except (OSError, urllib.error.URLError, ValueError) as exc:
                last_error = str(exc)
                time.sleep(attempt)
    raise RuntimeError(f'{robot_id}/{entry["name"]} failed: {last_error}')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--all', action='store_true')
    group.add_argument('--robot', choices=sorted(MANIFEST['robots']))
    args = p.parse_args()
    selected = list(MANIFEST['robots']) if args.all else [args.robot]
    jobs = [(key, MANIFEST['robots'][key], item)
            for key in selected for item in MANIFEST['robots'][key]['files']]
    print(f'Installing official LimX Apache-2.0 humanoid assets: {len(jobs)} files', flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(fetch_one, *job) for job in jobs]
        for fut in as_completed(futures):
            try:
                print('✓', fut.result(), flush=True)
            except Exception as err:
                failures.append(str(err))
                print('✗', err, flush=True)
    if failures:
        raise SystemExit(
            f'{len(failures)} file(s) failed. Rerun to retry without downloading verified files again.'
        )
    for key in selected:
        marker = ROOT / 'models' / key / 'meshes' / 'asset-ready.txt'
        marker.write_text(
            f'ready: {key} from {MANIFEST["robots"][key]["repo"]}@'
            f'{MANIFEST["robots"][key]["commit"]}\n', encoding='utf-8'
        )
    print('\nOLI / LUNA installed. Open the Robotists Motion Library.', flush=True)


if __name__ == '__main__':
    main()
