import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import URDFLoader from 'urdf-loader';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { ROBOT_BY_ID } from './robots.js';
import { applyUnitreeMotion } from './unitreeMotions.js';
import { MOTION_BY_ID, applyMotion } from './motions.js';
import { makeBenchmark, saveBenchmark } from './benchmark.js';

const MODEL_ROOT = import.meta.env.BASE_URL + 'magicdog/urdf/';
const ORIGINAL_URL = MODEL_ROOT + 'magicdog_repaint.urdf';
const FAST_OBJ_URL = MODEL_ROOT + 'magicdog_fast.urdf';
const EXPERIMENTAL_GLB_URL = MODEL_ROOT + 'magicdog_web.urdf';

async function findRobotUrl(robotId) {
  if (robotId !== 'magicdog') {
    const model = ROBOT_BY_ID[robotId];
    if (!model) throw new Error('Unknown robot: ' + robotId);
    const readyUrl = import.meta.env.BASE_URL + model.ready;
    const ready = await fetch(readyUrl, { cache: 'no-store' });
    // Vite may return index.html for a missing file, so inspect the marker.
    if (!ready.ok || !(await ready.text()).startsWith('ready: ' + robotId)) {
      throw new Error('Missing official ' + model.name + ' mesh files. Run: python3 tools/install_unitree_models.py --robot ' + robotId);
    }
    return import.meta.env.BASE_URL + model.urdf;
  }
  // The original OBJ+MTL is the verified reference for color and assembly.
  // Never auto-select the experimental GLB (its appearance is not correct yet).
  // ?model=fast opts into the material-preserving reduced OBJ export.
  // ?model=glb is a diagnostic experiment ONLY.
  const requested = new URLSearchParams(window.location.search).get('model');
  const candidate = requested === 'fast' ? FAST_OBJ_URL :
    requested === 'glb' ? EXPERIMENTAL_GLB_URL : ORIGINAL_URL;
  if (candidate === ORIGINAL_URL) return ORIGINAL_URL;
  try {
    const response = await fetch(candidate, { cache: 'no-store' });
    // Vite's HTML fallback may return HTTP 200 for a missing URDF.
    if (response.ok && (await response.text()).includes('<robot')) return candidate;
  } catch (error) {
    console.warn('Could not load optional model version', error);
  }
  console.warn('Optional model unavailable; falling back to reference OBJ+MTL');
  return ORIGINAL_URL;
}


function createRobotLoader(manager) {
  const loader = new URDFLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const colladaLoader = new ColladaLoader(manager);
  loader.parseVisual = true;
  loader.parseCollision = false;
  const meshCache = new Map();

  // Version 0.13.x callback: (path, manager, material, onComplete).
  // Load the MTL repaint colors and parse each OBJ only once.
  loader.loadMeshCb = (url, assetManager, material, onComplete) => {
    if (/\.dae(?:\?.*)?$/i.test(url)) {
      if (!meshCache.has(url)) {
        meshCache.set(url, colladaLoader.loadAsync(url).then(data => data.scene));
      }
      meshCache.get(url).then(source => {
        // Share mesh geometry, but keep individual joint transform instances.
        const clone = source.clone(true);
        // Some original Unitree A1 Collada exports contain Blender's studio Camera
        // and Light nodes inside the mesh file. URDF visual geometry must
        // contain only the part geometry, never scene lighting/cameras.
        // Dropping these nodes prevents stray point lights while preserving
        // local mesh transforms from the manufacturer's DAE.
        const extras = [];
        clone.traverse(node => {
          if (node.isCamera || node.isLight) {
            extras.push(node);
            return;
          }
          if (!node.isMesh) return;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          node.material = mats.map(m => {
            const copy = m.clone();
            copy.side = THREE.DoubleSide;
            return copy;
          });
          if (node.material.length === 1) node.material = node.material[0];
        });
        for (const extra of extras) extra.removeFromParent();
        onComplete(clone);
      }).catch(error => onComplete(null, error));
      return;
    }
    if (/\.glb(?:\?.*)?$/i.test(url)) {
      if (!meshCache.has(url)) {
        meshCache.set(url, gltfLoader.loadAsync(url).then(gltf => gltf.scene));
      }
      meshCache.get(url).then(scene => onComplete(scene.clone(true))).catch(error => onComplete(null, error));
      return;
    }
    if (!/\.obj(?:\?.*)?$/i.test(url)) {
      onComplete(null, new Error('Unsupported model format: ' + url));
      return;
    }
    if (!meshCache.has(url)) {
      const task = (async () => {
        const obj = new OBJLoader(assetManager);
        try {
          const mtlUrl = url.replace(/\.obj(?=\?|$)/i, '.mtl');
          const colors = await new MTLLoader(assetManager).loadAsync(mtlUrl);
          colors.preload();
          obj.setMaterials(colors);
        } catch (err) {
          console.warn('Missing optional MTL; using OBJ default materials', url, err);
        }
        return obj.loadAsync(url);
      })();
      meshCache.set(url, task);
    }
    meshCache.get(url).then(source => {
      const clone = source.clone(true);
      clone.traverse(item => {
        if (!item.isMesh) return;
        item.castShadow = true;
        item.receiveShadow = true;
        const originals = Array.isArray(item.material) ? item.material : [item.material];
        const mats = originals.map(m => {
          const copy = m.clone();
          copy.side = THREE.DoubleSide; // mirrored URDF links have negative mesh scale
          return copy;
        });
        item.material = mats.length === 1 ? mats[0] : mats;
      });
      onComplete(clone);
    }).catch(error => {
      console.error('Mesh load failed', url, error);
      onComplete(null, error);
    });
  };
  return loader;
}

export default function RobotCanvas({ robotId = 'magicdog', motionId, playing, speed, seek, resetCamera, wireframe, onProgress, onLoadState }) {
  const containerRef = useRef(null);
  const robotRef = useRef(null);
  const stageRef = useRef(null);
  const controlsRef = useRef(null);
  const timeRef = useRef(0);
  const cameraResetRef = useRef(null);
  const valuesRef = useRef({ motionId, playing, speed, onProgress, onLoadState });
  valuesRef.current = { motionId, playing, speed, onProgress, onLoadState };

  useEffect(() => {
    timeRef.current = 0;
    onProgress(0);
  }, [motionId, robotId]);

  useEffect(() => {
    if (seek && Number.isFinite(seek.value)) {
      timeRef.current = seek.value;
      if (robotId === 'magicdog') {
        applyMotion(robotRef.current, stageRef.current, valuesRef.current.motionId, timeRef.current, { instant: true });
      } else {
        applyUnitreeMotion(robotRef.current, stageRef.current, robotId, valuesRef.current.motionId, timeRef.current, { instant: true });
      }
    }
  }, [seek]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !resetCamera) return;
    cameraResetRef.current = {
      started: performance.now(),
      fromPosition: controls.object.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: controls.position0.clone(),
      toTarget: controls.target0.clone(),
    };
  }, [resetCamera]);

  useEffect(() => {
    robotRef.current?.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(m => { m.wireframe = wireframe; });
    });
  }, [wireframe]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let stopped = false;
    let animationFrame = 0;
    let lastTime = performance.now();
    let lastReport = 0;
    let lastFpsTick = lastTime;
    let frameCount = 0;
    const benchmarkMode = new URLSearchParams(window.location.search).get('benchmark') === '1';
    let assetsReady = false;
    let loadedModel = 'unknown';
    let benchmarkStatus = '';
    const fpsOverlay = document.createElement('div');
    fpsOverlay.className = 'fps-meter';
    fpsOverlay.textContent = 'Measuring FPS…';
    el.appendChild(fpsOverlay);

    const scene = new THREE.Scene();
    // Keep the original model colors; let the CSS studio gradient show through.
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 50);
    camera.position.set(1.65, 1.15, 1.75);
    const renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1); // 1x pixels instead of 2x (up to 75% fewer fragments)
    renderer.shadowMap.enabled = false; // high-polygon geometry + dynamic shadows is too costly
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);
    const benchmark = benchmarkMode ? makeBenchmark({
      renderer,
      onStatus: status => { benchmarkStatus = status; },
      onFinished: report => { void saveBenchmark(report); },
    }) : null;
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      console.info('Robotists 3D GPU:', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    } else {
      console.info('Robotists: WebGL GPU renderer information unavailable in this browser');
    }

    // Balanced three-point lighting: no costly real-time shadow map.
    scene.add(new THREE.HemisphereLight('#ffffff', '#bac9d7', 1.9));
    const sun = new THREE.DirectionalLight('#fff7f0', 2.35);
    sun.position.set(3.6, 5, 4.2);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -2;
    sun.shadow.camera.right = 2;
    sun.shadow.camera.top = 2;
    sun.shadow.camera.bottom = -2;
    sun.shadow.bias = -.0002;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#dbe9ff', .80);
    fill.position.set(-3, 2.8, -3);
    scene.add(fill);

    // A soft contact shadow needs no additional shadow-map render pass.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(38, 50, 63, 0.25)');
    gradient.addColorStop(.50, 'rgba(43, 59, 76, 0.095)');
    gradient.addColorStop(1, 'rgba(44, 58, 72, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(.95, .72),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true, depthWrite: false,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = .001;
    scene.add(shadow);

    // Four approximate contact accents follow the animated URDF feet.
    // This is only visual grounding; no physics or shadow-render pass.
    const contactShadows = [];
    const softContact = new THREE.CanvasTexture(shadowCanvas);
    const contactGeometry = new THREE.PlaneGeometry(.18, .14);
    for (const leg of ['FL','FR','RL','RR']) {
      const decal = new THREE.Mesh(contactGeometry, new THREE.MeshBasicMaterial({
        map: softContact, transparent: true, depthWrite: false, opacity: .78,
      }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = .008;
      scene.add(decal);
      contactShadows.push({ leg, decal });
    }
    const tempFootPosition = new THREE.Vector3();

    const grid = new THREE.GridHelper(8, 40, '#d8dfe7', '#e7ebf0');
    grid.position.y = -.009;
    grid.material.transparent = true;
    grid.material.opacity = .50;
    scene.add(grid);

    const stage = new THREE.Group();
    scene.add(stage);
    stageRef.current = stage;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .085;
    controls.rotateSpeed = .72;
    controls.zoomSpeed = .77;
    controls.minDistance = .75;
    controls.maxDistance = 5;
    controls.minPolarAngle = .12;
    controls.maxPolarAngle = Math.PI / 2.04;
    controls.target.set(0, ROBOT_BY_ID[robotId]?.groundHeight ?? .29, 0);
    controls.update();
    controls.saveState();
    controlsRef.current = controls;

    const resize = () => {
      const bounds = el.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      renderer.setSize(bounds.width, bounds.height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, count, total) => {
      if (!stopped) valuesRef.current.onLoadState({ phase: 'loading', percent: Math.min(95, Math.round(92 * count / total)) });
    };
    manager.onLoad = () => {
      assetsReady = true;
      if (!stopped) valuesRef.current.onLoadState({ phase: 'ready', percent: 100 });
    };
    manager.onError = url => console.error('Asset error:', url);

    const loader = createRobotLoader(manager);
    valuesRef.current.onLoadState({ phase: 'loading', percent: 0 });
    findRobotUrl(robotId).then(url => {
      loadedModel = url;
      loader.load(url, robot => {
      if (stopped) return;
      robot.rotation.x = -Math.PI / 2; // URDF Z-up => Three.js Y-up
      stage.add(robot);
      robotRef.current = robot;
      if (robotId === 'magicdog') {
        applyMotion(robot, stage, valuesRef.current.motionId, timeRef.current, { instant: true });
      } else {
        applyUnitreeMotion(robot, stage, robotId, valuesRef.current.motionId, timeRef.current, { instant: true });
      }
    }, undefined, err => {
      if (!stopped) valuesRef.current.onLoadState({ phase: 'error', percent: 0, message: String(err?.message || err) });
      });
    }).catch(err => {
      if (!stopped) valuesRef.current.onLoadState({ phase: 'error', percent: 0, message: String(err) });
    });

    const draw = now => {
      if (stopped) return;
      animationFrame = requestAnimationFrame(draw);
      const dt = Math.min((now - lastTime) / 1000, .05);
      lastTime = now;
      const settings = valuesRef.current;
      if (benchmark && !benchmark.active && !benchmark.finished && assetsReady && robotRef.current) {
        let meshCount = 0;
        robotRef.current.traverse(node => { if (node.isMesh) meshCount += 1; });
        // Wait for the model to actually be present, not just the URDF XML.
        if (meshCount > 0) benchmark.begin(now, loadedModel);
      }
      const phase = benchmark?.active ? benchmark.phase : null;
      if (phase) {
        timeRef.current += dt;
        if (robotId === 'magicdog') {
          applyMotion(robotRef.current, stage, phase.motion, timeRef.current, { deltaTime: dt });
        } else {
          applyUnitreeMotion(robotRef.current, stage, robotId, phase.motion, timeRef.current, { deltaTime: dt });
        }
        if (phase.orbit) {
          // Synthetic camera orbit approximates sustained mouse dragging.
          const offset = camera.position.clone().sub(controls.target);
          const radius = Math.hypot(offset.x, offset.z);
          const a = Math.atan2(offset.z, offset.x) + dt * .85;
          camera.position.set(controls.target.x + radius * Math.cos(a), controls.target.y + offset.y, controls.target.z + radius * Math.sin(a));
        }
      } else {
        // Resume normal motions after the one-time benchmark has finished.
        const duration = (MOTION_BY_ID[settings.motionId] || MOTION_BY_ID.idle).duration;
        if (settings.playing) timeRef.current = (timeRef.current + dt * settings.speed) % duration;
        if (robotId === 'magicdog') {
          applyMotion(robotRef.current, stage, settings.motionId, timeRef.current, { deltaTime: dt });
        } else {
          applyUnitreeMotion(robotRef.current, stage, robotId, settings.motionId, timeRef.current, { deltaTime: dt });
        }
      }
      if (now - lastReport > 90) {
        settings.onProgress(timeRef.current);
        lastReport = now;
      }
      // Ease the Reset Camera action instead of snapping the camera.
      const tween = cameraResetRef.current;
      if (tween) {
        const p = Math.min(1, (now - tween.started) / 460);
        const easing = 1 - Math.pow(1 - p, 3);
        camera.position.lerpVectors(tween.fromPosition, tween.toPosition, easing);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, easing);
        if (p === 1) cameraResetRef.current = null;
      }
      controls.update();
      if (robotRef.current?.links) {
        robotRef.current.updateMatrixWorld(true);
        for (const { leg, decal } of contactShadows) {
          const foot = robotRef.current.links[leg + '_foot'] || robotRef.current.links[leg + '_foot_link'];
          if (!foot) { decal.visible = false; continue; }
          foot.getWorldPosition(tempFootPosition);
          decal.visible = true;
          decal.position.x = tempFootPosition.x;
          decal.position.z = tempFootPosition.z;
          decal.material.opacity = Math.max(.18, .78 - Math.max(0, tempFootPosition.y) * 5);
        }
      }
      renderer.render(scene, camera);
      benchmark?.sample(now, renderer.info.render);
      frameCount += 1;
      if (now - lastFpsTick >= 1000) {
        const fps = Math.round(frameCount * 1000 / (now - lastFpsTick));
        const triangles = renderer.info.render.triangles;
        const drawCalls = renderer.info.render.calls;
        fpsOverlay.textContent = (benchmarkMode ? benchmarkStatus + ' | ' : '') +
          fps + ' FPS · ' + (triangles / 1000).toFixed(0) + 'k tris · ' + drawCalls + ' draws';
        fpsOverlay.classList.toggle('fps-low', fps < 40);
        lastFpsTick = now;
        frameCount = 0;
      }
    };
    animationFrame = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      benchmark?.dispose();
      controls.dispose();
      renderer.dispose();
      softContact.dispose();
      contactGeometry.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
      if (fpsOverlay.parentElement === el) el.removeChild(fpsOverlay);
      robotRef.current = null;
      stageRef.current = null;
      controlsRef.current = null;
    };
  }, [robotId]);

  return <div className="robot-canvas" ref={containerRef} aria-label="3D interactive robot viewer" />;
}
