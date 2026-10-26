import { useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Box, Check, ChevronRight, CircleHelp, Compass,
  Footprints, Github, Hand, Layers3, Maximize2, Move3d, Pause, Play,
  RotateCcw, ScanEye, Sparkles,
} from 'lucide-react';
import RobotCanvas from './RobotCanvas.jsx';
import { MOTIONS, MOTION_BY_ID } from './motions.js';
import { HUMANOID_MOTIONS, HUMANOID_MOTION_BY_ID } from './humanoidMotions.js';
import { ROBOTS, ROBOT_BY_ID } from './robots.js';

const iconMap = { Activity, Footprints, Compass, Hand, ScanEye };
function timeLabel(t) {
  const seconds = Math.floor(Math.max(0, Number(t) || 0));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

export default function App() {
  const [robotId, setRobotId] = useState('magicdog');
  const [motionId, setMotionId] = useState('idle');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState(null);
  const [cameraReset, setCameraReset] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [load, setLoad] = useState({ phase: 'loading', percent: 0 });
  const viewer = useRef(null);
  const seq = useRef(0);
  const robot = ROBOT_BY_ID[robotId];
  const humanoid = robot.category === 'Humanoid';
  const motions = humanoid ? HUMANOID_MOTIONS : MOTIONS;
  const motion = (humanoid ? HUMANOID_MOTION_BY_ID : MOTION_BY_ID)[motionId];

  const chooseRobot = id => {
    if (id === robotId) return;
    setRobotId(id);
    setMotionId('idle');
    setTime(0);
    setSeek(null);
    setPlaying(true);
    setWireframe(false);
    setLoad({ phase: 'loading', percent: 0 });
  };
  const scrub = value => {
    setTime(value);
    setSeek({ value, seq: ++seq.current });
  };
  const chooseMotion = id => {
    if (id === motionId) {
      // Restart is a user-requested seek, so applying it immediately is OK.
      scrub(0);
    } else {
      // Do not call scrub() when selecting a new motion: a seek instructs
      // RobotCanvas to instant-apply the first pose, skipping joint blending.
      // Let the motion's effect reset the time and use the 650ms crossfade.
      setSeek(null);
      setTime(0);
      setMotionId(id);
    }
    setPlaying(true);
  };
  const changeSpeed = () => {
    const values = [.5, 1, 1.5, 2];
    setSpeed(v => values[(values.indexOf(v) + 1) % values.length]);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else viewer.current?.requestFullscreen?.();
  };

  return (
    <div className="shell">
      <header className="header">
        <a className="logo" href="#" aria-label="Robotists Motion Library">
          <span className="logo-shape"><i/><i/><i/><i/></span>
          <span className="logo-name">robotists<span>.</span></span>
          <span className="logo-separator" />
          <span className="logo-sub">MOTION LAB</span>
        </a>
        <nav className="nav" aria-label="Main">
          <span className="nav-active">Motion Library</span>
          <span className="nav-disabled">Simulations</span>
          <span className="nav-disabled">About</span>
        </nav>
        <div className="header-tools">
          <span className="version"><b/> INTERACTIVE STUDIO <em>V0.3.4</em></span>
          <a className="github" title="GitHub repository" href="https://github.com/Chris-airobot/robotists-robot-demos" target="_blank" rel="noreferrer"><Github size={19}/></a>
        </div>
      </header>

      <main className="main">
        <div className="intro">
          <div>
            <div className="eyebrow crumb">EXPLORE <ChevronRight size={13}/> MOTION LIBRARY <span className="crumb-dash"/> {robot.index} / {robot.name.toUpperCase()}</div>
            <h1>Robots, <em>in motion.</em></h1>
            <p>Explore robot geometry in an interactive 3D space. Select a motion, orbit the camera, and discover the mechanics.</p>
          </div>
          <div className="intro-right"><span className="live-dot"/> INTERACTIVE 3D ROBOT LIBRARY <span className="muted">{String(ROBOTS.length).padStart(2, '0')} / {String(ROBOTS.length).padStart(2, '0')}</span></div>
        </div>

        <div className="workspace">
          <aside className="sidebar library">
            <div className="pane-title"><div><span className="eyebrow">SELECT A ROBOT</span><h2>Robot collection</h2></div><span className="badge">{String(ROBOTS.length).padStart(2, '0')}</span></div>
            {ROBOTS.map(item => (
              <button key={item.id} type="button"
                className={'robot ' + (item.id === robotId ? 'active' : '')}
                aria-pressed={item.id === robotId}
                onClick={() => chooseRobot(item.id)}>
                <span className={'robot-icon ' + (item.id === robotId ? '' : 'grey')}><Box size={22} strokeWidth={1.5}/></span>
                <span className="robot-text"><strong>{item.name}</strong><small>{item.category} · {item.brand}</small></span>
                {item.id === robotId ? <Check size={16} className="accent"/> : <span className="soon">VIEW</span>}
              </button>
            ))}
            <div className="library-tip">Some official model meshes require a one-time local download. Select a robot to see its status.</div>

            <hr/>
            <div className="pane-title"><div><span className="eyebrow">PLAYBACK LIBRARY</span><h2>Explore motions</h2></div><span className="badge">0{motions.length}</span></div>
            {['BASIC MOTIONS', 'INTERACTIONS'].map(group => (
              <div className="motion-group" key={group}>
                <div className="category-header">{group}</div>
                {motions.filter(m => m.group === group).map(item => {
                  const Icon = iconMap[item.icon];
                  return (
                    <button key={item.id} type="button"
                      className={'motion-choice ' + (item.id === motionId ? 'chosen' : '')}
                      onClick={() => chooseMotion(item.id)}>
                      <Icon size={17} strokeWidth={1.8}/>
                      <span>{item.name}</span>
                      {item.id === motionId
                        ? <span className="sound-bars"><i/><i/><i/></span>
                        : <Play className="choice-play" size={12}/>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="note"><Sparkles size={16}/><span>Official catalogue models with robot-specific previews. More platforms coming soon.</span></div>
          </aside>

          <div className="center">
            <div className="stage-view" ref={viewer}>
              <RobotCanvas
                robotId={robotId}
                motionId={motionId}
                playing={playing}
                speed={speed}
                seek={seek}
                resetCamera={cameraReset}
                wireframe={wireframe}
                onProgress={setTime}
                onLoadState={setLoad}
              />
              <div className="stage-top">
                <span className="stage-tag"><span className={'live-dot ' + (load.phase === 'error' ? 'error' : '')}/>
                  {load.phase === 'ready' ? '3D VIEWER ACTIVE' : load.phase === 'error' ? 'MODEL ERROR' : 'LOADING MODEL'}
                </span>
                <span className="stage-tag muted-tag">KINEMATIC PREVIEW · {robot.index}/{String(ROBOTS.length).padStart(2, '0')}</span>
              </div>
              <div className="stage-name">
                <span className="eyebrow">{robot.brand.toUpperCase()} / {robot.category.toUpperCase()}</span>
                <strong>{robot.name}<small>_{robot.index}</small></strong>
              </div>
              <div className="stage-footer">
                <span className="stage-hint"><Move3d size={16}/> Drag to rotate <b>·</b> Scroll to zoom</span>
                <div className="stage-actions">
                  <button type="button" title="Toggle wireframe" className={wireframe ? 'selected-tool' : ''} onClick={() => setWireframe(v => !v)}><Layers3 size={18}/></button>
                  <button type="button" title="Reset camera" onClick={() => setCameraReset(v => v + 1)}><RotateCcw size={18}/></button>
                  <button type="button" title="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={18}/></button>
                </div>
              </div>
              {load.phase !== 'ready' && (
                <div className="overlay">
                  <div className="spinner"><i/><i/><i/><i/></div>
                  <strong>{load.phase === 'error' ? 'Model not ready' : 'Preparing your 3D experience'}</strong>
                  <p>{load.phase === 'error' ? load.message : 'Loading ' + robot.name + ' geometry and materials…'}</p>
                  {load.phase !== 'error' && <div className="loading-bar"><span style={{width: load.percent + '%'}}/></div>}
                </div>
              )}
            </div>

            <div className="player">
              <div className="player-top">
                <div className="now-playing">
                  <div className="playing-icon"><Activity size={18}/></div>
                  <div><span className="eyebrow">NOW PLAYING <span className="slash">/</span> LOOPING PREVIEW</span><strong>{motion.name}</strong></div>
                </div>
                <div className="player-buttons">
                  <button type="button" className="quiet-btn" title="Restart" onClick={() => scrub(0)}><RotateCcw size={19}/></button>
                  <button type="button" className="play-btn" title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(v => !v)}>
                    {playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}
                  </button>
                  <button type="button" className="speed-btn" title="Playback speed" onClick={changeSpeed}>{speed}×</button>
                </div>
              </div>
              <div className="timeline">
                <span>{timeLabel(time)}</span>
                <input aria-label="Scrub motion timeline" type="range" min="0" max={motion.duration} step=".01"
                  value={Math.min(time, motion.duration)} onChange={e => scrub(Number(e.target.value))}
                  style={{'--seek-progress': (100 * time / motion.duration) + '%'}}/>
                <span>{timeLabel(motion.duration)}</span>
              </div>
            </div>
          </div>

          <aside className="sidebar detail">
            <span className="eyebrow">ROBOT PROFILE</span>
            <h2 className="detail-heading">{robot.name} <small>{robot.index}</small></h2>
            <p className="detail-desc">{robot.description}</p>
            <div className="type-box"><span className="type-icon"><Box size={17}/></span><div><small>ROBOT CATEGORY</small><strong>{robot.category}</strong></div></div>
            <div className="details">
              <div className="category-header">TECHNICAL DETAILS</div>
              {[
                ['Manufacturer', robot.brand],
                ['Actuated joints', robot.dof],
                ['Model format', robot.format],
                ['Rendering', 'Three.js'],
                ['Preview mode', 'Kinematic'],
              ].map(([label, value]) => (
                <div className="detail-row" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <hr/>
            <div className="selected-motion">
              <div className="category-header">SELECTED MOTION</div>
              <h3><span><Activity size={18}/></span>{motion.name}</h3>
              <p>{motion.description}</p>
              <div className="tags"><span>LOOPING</span><span>{motion.duration}S</span><span>JOINT ANIMATION</span></div>
            </div>
            <div className="disclaimer"><CircleHelp size={17}/><span>Illustrative motion only. Not a validated physical capability or hardware trajectory.</span></div>
          </aside>
        </div>

        <footer className="footer">
          <span>© ROBOTISTS <b>/</b> INTERACTIVE ROBOT EXPLORATION</span>
          <span>BUILT FOR CURIOSITY <b>✳</b> POWERED BY THREE.JS</span>
        </footer>
      </main>
    </div>
  );
}
