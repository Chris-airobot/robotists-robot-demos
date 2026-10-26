# Robotists Motion Library V0.3

**Five official-source robot models:** MagicDog, Unitree Go2, Unitree A1,
LimX OLI and LimX LUNA. Viewer has robot-specific kinematic motion previews,
smooth camera controls, and lightweight studio lighting.

## Humanoid model visual fidelity and catalogue scope

The selectable five-model library contains MagicDog, Go2, A1, **LimX OLI**
and **LimX LUNA**. Unitree G1 was an incomplete legacy registry entry with
no installed asset workflow and is **not exposed in the Robotist product
selector**. Its old URDF is retained as a non-displayed repository asset,
so no original source files are silently deleted.

The official LimX STL files contain untextured visual geometry. Browser code
uses an **OLI/LUNA-only, per-part approximation** of the manufacturer's
silver/light body panels and black/charcoal joint and head finishes. This
is not a manufacturer-supplied texture pack: the STL files cannot reproduce
distinct visor glass, fabric finish or multi-material casing surfaces.
The original URDFs and official meshes remain unchanged, and MagicDog,
Go2 and A1 materials remain on their existing paths.

## Add Robotist catalogue humanoids

Robotist's public catalogue includes LimX OLI and LimX LUNA, as well as
Fourier GR-3/GRW and PND ADAM variants. A product listing does **not** establish
that Robotist owns a physical unit. Do not substitute unrelated humanoids.

OLI and LUNA come from LimX Dynamics' own publicly distributed Apache-2.0
robot description repositories, with pinned commits and blob checksums:

- OLI: `limxdynamics/humanoid-description`, HU_D04_01 (31 joints)
- LUNA: `limxdynamics/luna-description`, HU_L04_01 (27 joints)

From the repository root:

    git -c core.sshCommand="ssh -p 443 -o ConnectTimeout=15" pull --ff-only ssh://git@ssh.github.com/Chris-airobot/robotists-robot-demos.git master
    python3 tools/install_limx_models.py --all

The script downloads and verifies 61 **visual** STL meshes (~76 MB),
without re-adding binary assets to Git. It is safe to rerun if interrupted.
Then from `web`:

    npm run test:motions
    npm run dev -- --host 127.0.0.1 --port 5173

Open http://127.0.0.1:5173/. Select OLI or LUNA, then choose Standing,
March Preview, Body Turn, Wave Hello, or Look Around.

**Important:** these animations are browser-only demonstrations, not safe
motor commands, measured trajectories, or physically validated humanoid
locomotion. The manufacturer's URDF serializes some parallel linkage
mechanisms for visualization. Actual model appearance and per-robot FPS must
be verified interactively before publication. Original MagicDog and Go2
visualization data remain unchanged.

## Other robots

Unitree A1 and Go2 asset download (optional, for development comparison):

    python3 tools/install_unitree_models.py --all

---

Lightweight interactive 3D robot gallery built with React, Vite, Three.js and urdf-loader.

## Run on Ubuntu

From the repo root:

    git -c http.version=HTTP/1.1 pull --ff-only
    cd web
    npm install
    npm run dev

Open the URL Vite prints (normally http://localhost:5173).

## How model assets are served

`vite.config.js` uses `../models` as the Vite `publicDir`, so the local browser app loads the existing MagicDog URDF, OBJ, and MTL directly without duplicating the 73 MB model folder.

Vite production builds copy the models into the build output. **Do not publish the unoptimized bundle yet.** First convert relevant model assets to optimized glTF/GLB and verify manufacturer/model licenses.

## Controls

- Click a motion card to switch the joint animation.
- Drag to rotate; scroll to zoom; use the toolbar to reset view, toggle wireframe, or fullscreen.
- Use timeline and playback controls for play, pause, restart, scrub and speed changes.

These motions are **illustrative kinematic previews**, inspired by our Isaac Lab demos, not physically validated hardware motions or exported trajectories. The original simulation scripts live in `../simulation/magicdog/`.

## Future

- Optimize the robot's OBJ meshes into compressed glTF/GLB.
- Export joint trajectories from Isaac Lab, and replace hand-authored motion formulas.
- Add new robots via model/animation manifests and reusable viewer controls.

## Performance

The first prototype displayed full-resolution OBJ meshes with real-time shadows and
up to 2x device-pixel-ratio rendering. V1 performance improvements:

- WebGL renderer uses 1x pixel ratio and no dynamic shadow pass.
- Lightweight simulated contact shadow.
- FPS and rendered triangle-count indicator over the 3D viewport.
- An offline mesh optimizer generates simplified GLB files for each unique OBJ mesh.

Run from the repository root:

    python3 -m venv .venv-mesh
    .venv-mesh/bin/python -m pip install trimesh fast-simplification numpy
    .venv-mesh/bin/python tools/optimize_magicdog.py --keep-ratio 0.10

The GLB route is **experimental**: it did not preserve the original model appearance. The webpage **now defaults to the original OBJ + MTL**. It never auto-selects GLB. The original URDF, meshes and simulation code remain unchanged.

Inspect the FPS number above the viewer. For low FPS even after optimization,
check the browser's GPU/WebGL hardware acceleration in its diagnostics.

## Material-faithful performance comparison

The **reference model** is always loaded by the plain homepage URL and preserves
its original colors. To create an alternative lower-polygon **OBJ with the same
MTL material names and coordinate conventions**, run from the repo root:

    .venv-mesh/bin/python tools/optimize_magicdog_obj.py --keep-ratio 0.35

Compare:

- Reference: http://localhost:5173/
- Reduced-geometry model: http://localhost:5173/?model=fast
- Experimental GLB (not recommended): http://localhost:5173/?model=glb

Both normal and fast variants keep the same robot joint structure. These new
OBJ files are not applied to the physics simulator. Compare appearance **before**
committing any exported meshes.

The FPS overlay reports FPS, submitted triangles, and draw calls. If even the
low-face-count geometry is slow, check `about:support` (Firefox) for WebGL GPU
hardware acceleration, and test in a standalone browser rather than VS Code's
embedded webview.

## Automated in-browser performance benchmark

This is an opt-in development test. It runs **inside the desktop browser using
its real GPU/WebGL configuration**, not in a simulated/headless CI environment.

From the `web` directory:

    npm run benchmark

Vite opens `/?benchmark=1`. Keep that browser tab in the foreground and do
not resize or interact with it while testing.

When assets are ready, the page runs three phases automatically:
1. Idle with a stationary camera.
2. Walking animation with a stationary camera.
3. Walking animation plus an automated camera orbit.

Each lasts 4.5 seconds (first 0.75 seconds excluded as warmup). When complete,
the Vite terminal prints a concise FPS/p95 summary and the current WebGL GPU.
The complete JSON is saved locally to:

    web/benchmark-results/latest.json

The JSON includes mean rAF FPS, p50/p95/p99 frame intervals, proportion of frames
over 33.3 ms, GPU renderer name (if browser exposes it), total triangles and draw
calls. A report is **never uploaded automatically** and the folder is gitignored.

Interpretation:
- A 60 Hz display normally caps requestAnimationFrame FPS at ~60.
- Large p95/p99 frame times or many >33.3 ms frames imply visible stuttering.
- Firefox can hide GPU details for privacy; run `about:support` if needed.
- Headless automated browsers may select software rendering; this test uses your
  actual browser and avoids that source of misleading results.

## Motion previews (October 2026)

`src/motions.js` now uses foot-space trajectory generation instead of simply
adding joint-angle sine waves:

- **Walk:** diagonal-pair trot, with a separate stance segment and raised swing
  segment. Joint angles come from 2-link sagittal inverse kinematics using the
  20 cm MagicDog thigh and calf described in its URDF.
- **Turn:** gentle, reversible yaw with counter-stepping on the left and right.
- **Greet:** gradual right-front paw lift, hold, and return.
- **Inspect:** slow scanning torso pose with small leg adjustments.
- **All motions:** seamless cycle boundaries and ~360 ms quintic crossfades when
  choosing another motion. Timeline scrubbing remains exact and immediate.

These motions are **kinematic website illustrations only**. They are not
measured motor trajectories, foot-contact simulations, validated control
commands, or a physically stable locomotion policy. The robot URDF, visuals,
and simulation assets are unchanged.

Run motion regression checks:

    npm run test:motions

This validates URDF joint limits, smooth loop boundaries, diagonal coordination,
crossfading, and timeline scrubbing without needing a GPU.

### A1 appearance note

The A1 visual meshes are the public Unitree ROS simulator DAE parts, **not a
photorealistic reconstruction of the production robot**. They omit product
finishing and some visual details (such as electronics/cable assemblies).
For browser display, `RobotCanvas.jsx` strips Blender-exported cameras and
lights and applies *A1-only* charcoal/dark-leg material styling to better
match the production color scheme. Original mesh geometry, joint transforms
and source asset files are unchanged. Check appearance in the real browser
before making a public quality claim.
