# Robotists Motion Library V1

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
