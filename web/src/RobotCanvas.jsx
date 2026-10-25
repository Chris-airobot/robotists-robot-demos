import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import URDFLoader from 'urdf-loader';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MOTION_BY_ID, applyMotion } from './motions.js';
import { makeBenchmark, saveBenchmark } from './benchmark.js';

const MODEL_ROOT = import.meta.env.BASE_URL + 'magicdog/urdf/';
const ORIGINAL_URL = MODEL_ROOT + 'magicdog_repaint.urdf';
const FAST_OBJ_URL = MODEL_ROOT + 'magicdog_fast.urdf';
const EXPERIMENTAL_GLB_URL = MODEL_ROOT + 'magicdog_web.urdf';

async function findRobotUrl() {
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
  loader.parseVisual = true;
  loader.parseCollision = false;
  const meshCache = new Map();

  // Version 0.13.x callback: (path, manager, material, onComplete).
  // Load the MTL repaint colors and parse each OBJ only once.
  loader.loadMeshCb = (url, assetManager, material, onComplete) => {
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

export default function RobotCanvas({ motionId, playing, speed, seek, resetCamera, wireframe, onProgress, onLoadState }) {
  const containerRef = useRef(null);
  const robotRef = useRef(null);
  const stageRef = useRef(null);
  const controlsRef = useRef(null);
  const timeRef = useRef(0);
  const valuesRef = useRef({ motionId, playing, speed, onProgress, onLoadState });
  valuesRef.current = { motionId, playing, speed, onProgress, onLoadState };

  useEffect(() => {
    timeRef.current = 0;
    onProgress(0);
  }, [motionId]);

  useEffect(() => {
    if (seek && Number.isFinite(seek.value)) {
      timeRef.current = seek.value;
      applyMotion(robotRef.current, stageRef.current, valuesRef.current.motionId, timeRef.current);
    }
  }, [seek]);

  useEffect(() => { controlsRef.current?.reset(); }, [resetCamera]);

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
    scene.background = new THREE.Color('#f6f8fa');
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 50);
    camera.position.set(1.65, 1.15, 1.75);
    const renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: false, powerPreference: 'high-performance',
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

    scene.add(new THREE.HemisphereLight('#ffffff', '#c4cfd8', 2.4));
    const sun = new THREE.DirectionalLight('#ffffff', 3.2);
    sun.position.set(2.5, 5, 3);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -2;
    sun.shadow.camera.right = 2;
    sun.shadow.camera.top = 2;
    sun.shadow.camera.bottom = -2;
    sun.shadow.bias = -.0002;
    scene.add(sun);

    // A soft contact shadow needs no additional shadow-map render pass.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(44, 58, 72, 0.20)');
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
    controls.dampingFactor = .065;
    controls.minDistance = .75;
    controls.maxDistance = 5;
    controls.minPolarAngle = .12;
    controls.maxPolarAngle = Math.PI / 2.04;
    controls.target.set(0, .29, 0);
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
    findRobotUrl().then(url => {
      loadedModel = url;
      loader.load(url, robot => {
      if (stopped) return;
      robot.rotation.x = -Math.PI / 2; // URDF Z-up => Three.js Y-up
      stage.add(robot);
      robotRef.current = robot;
      applyMotion(robot, stage, valuesRef.current.motionId, timeRef.current);
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
        applyMotion(robotRef.current, stage, phase.motion, timeRef.current);
        if (phase.orbit) {
          // Synthetic camera orbit approximates sustained mouse dragging.
          const offset = camera.position.clone().sub(controls.target);
          const radius = Math.hypot(offset.x, offset.z);
          const a = Math.atan2(offset.z, offset.x) + dt * .85;
          camera.position.set(controls.target.x + radius * Math.cos(a), controls.target.y + offset.y, controls.target.z + radius * Math.sin(a));
        }
      } else if (!benchmark?.finished) {
        const duration = (MOTION_BY_ID[settings.motionId] || MOTION_BY_ID.idle).duration;
        if (settings.playing) timeRef.current = (timeRef.current + dt * settings.speed) % duration;
        applyMotion(robotRef.current, stage, settings.motionId, timeRef.current);
      }
      if (now - lastReport > 90) {
        settings.onProgress(timeRef.current);
        lastReport = now;
      }
      controls.update();
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
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
      if (fpsOverlay.parentElement === el) el.removeChild(fpsOverlay);
      robotRef.current = null;
      stageRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  return <div className="robot-canvas" ref={containerRef} aria-label="3D interactive robot viewer" />;
}
