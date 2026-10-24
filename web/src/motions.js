export const MOTIONS = [
  { id: 'idle', name: 'Idle / Stand', group: 'BASIC MOTIONS', duration: 8, description: 'A neutral standing pose with subtle looping body motion.', icon: 'Activity' },
  { id: 'walk', name: 'Walking', group: 'BASIC MOTIONS', duration: 6, description: 'An in-place trot inspired by the diagonal leg phasing in our Isaac Lab kinematic demo.', icon: 'Footprints' },
  { id: 'turn', name: 'Turning', group: 'BASIC MOTIONS', duration: 6, description: 'A simple turning preview with coordinated alternating leg motions.', icon: 'Compass' },
  { id: 'greet', name: 'Greeting', group: 'INTERACTIONS', duration: 5, description: 'An illustrative front-leg greeting gesture for exhibition concepts.', icon: 'Hand' },
  { id: 'inspect', name: 'Inspection', group: 'INTERACTIONS', duration: 6, description: 'A gentle surveying motion inspired by our inspection demo.', icon: 'ScanEye' },
];
export const MOTION_BY_ID = Object.fromEntries(MOTIONS.map(m => [m.id, m]));

// The standing pose is an illustrative first pass, NOT a robot-safe controller target.
// The original URDF has geometry and joint limits, not a prescribed standing pose.
const STAND = {
  FL: [0, 0.78, -1.48], FR: [0, 0.78, -1.48],
  RL: [0, 0.82, -1.48], RR: [0, 0.82, -1.48],
};
const TAU = Math.PI * 2;

export function applyMotion(robot, stage, id, time) {
  if (!robot || !stage) return;
  const duration = MOTION_BY_ID[id]?.duration || 8;
  const progress = (time % duration) / duration;
  const wave = TAU * progress;
  let amplitude = 0, frequency = 1.8, yaw = 0, height = 0;

  if (id === 'walk') {
    amplitude = 1;
    height = .008 * Math.sin(2 * TAU * frequency * time);
  } else if (id === 'turn') {
    amplitude = .55;
    frequency = 1.4;
    yaw = .70 * Math.sin(wave);
    height = .004 * Math.sin(2 * TAU * frequency * time);
  } else if (id === 'inspect') {
    yaw = .18 * Math.sin(wave);
    height = .005 * Math.sin(wave);
  } else if (id === 'greet') {
    height = -.008 * Math.max(0, Math.sin(wave));
  } else {
    height = .003 * Math.sin(wave);
  }

  stage.position.y = .325 + height;
  stage.rotation.y = yaw;
  const phases = { FL: 0, RR: 0, FR: Math.PI, RL: Math.PI };

  for (const leg of ['FL', 'FR', 'RL', 'RR']) {
    const [baseHip, baseThigh, baseCalf] = STAND[leg];
    const s = Math.sin(TAU * frequency * time + phases[leg]);
    let hip = baseHip + amplitude * .035 * s;
    let thigh = baseThigh + amplitude * .30 * s;
    let calf = baseCalf - amplitude * .35 * Math.max(0, s) + amplitude * .08 * Math.min(0, s);

    if (id === 'greet' && leg === 'FR') {
      const raise = Math.pow(Math.max(0, Math.sin(Math.PI * progress)), 1.5);
      hip -= .10 * raise;
      thigh += .30 * raise;
      calf -= .42 * raise;
    }
    if (id === 'inspect') thigh += .045 * Math.sin(wave + phases[leg]);

    robot.setJointValue(leg + '_hip_joint', hip);
    robot.setJointValue(leg + '_thigh_joint', thigh);
    robot.setJointValue(leg + '_calf_joint', calf);
  }
}
