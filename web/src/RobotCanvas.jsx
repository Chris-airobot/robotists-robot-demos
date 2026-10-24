import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import URDFLoader from 'urdf-loader';
import { MOTION_BY_ID, applyMotion } from './motions.js';

const ROBOT_URL = import.meta.env.BASE_URL + 'magicdog/urdf/magicdog_repaint.urdf';

function createRobotLoader(manager) {
  const loader = new URDFLoader(manager);
  loader.parseVisual = true;
  loader.parseCollision = false;
  const meshCache = new Map();

  // Version 0.13.x callback: (path, manager, material, onComplete).
  // Load the MTL repaint colors and parse each OBJ only once.
  loader.loadMeshCb = (url, assetManager, material, onComplete) => {
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f6f8fa');
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 50);
    camera.position.set(1.65, 1.15, 1.75);
    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#ffffff', '#c4cfd8', 2.4));
    const sun = new THREE.DirectionalLight('#ffffff', 3.2);
    sun.position.set(2.5, 5, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -2;
    sun.shadow.camera.right = 2;
    sun.shadow.camera.top = 2;
    sun.shadow.camera.bottom = -2;
    sun.shadow.bias = -.0002;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: '#6e7b8b', opacity: .19 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.012;
    ground.receiveShadow = true;
    scene.add(ground);

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
      if (!stopped) valuesRef.current.onLoadState({ phase: 'ready', percent: 100 });
    };
    manager.onError = url => console.error('Asset error:', url);

    const loader = createRobotLoader(manager);
    valuesRef.current.onLoadState({ phase: 'loading', percent: 0 });
    loader.load(ROBOT_URL, robot => {
      if (stopped) return;
      robot.rotation.x = -Math.PI / 2; // URDF Z-up => Three.js Y-up
      stage.add(robot);
      robotRef.current = robot;
      applyMotion(robot, stage, valuesRef.current.motionId, timeRef.current);
    }, undefined, err => {
      if (!stopped) valuesRef.current.onLoadState({ phase: 'error', percent: 0, message: String(err?.message || err) });
    });

    const draw = now => {
      if (stopped) return;
      animationFrame = requestAnimationFrame(draw);
      const dt = Math.min((now - lastTime) / 1000, .05);
      lastTime = now;
      const settings = valuesRef.current;
      const duration = (MOTION_BY_ID[settings.motionId] || MOTION_BY_ID.idle).duration;
      if (settings.playing) timeRef.current = (timeRef.current + dt * settings.speed) % duration;
      applyMotion(robotRef.current, stage, settings.motionId, timeRef.current);
      if (now - lastReport > 90) {
        settings.onProgress(timeRef.current);
        lastReport = now;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animationFrame = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
      robotRef.current = null;
      stageRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  return <div className="robot-canvas" ref={containerRef} aria-label="3D interactive robot viewer" />;
}
