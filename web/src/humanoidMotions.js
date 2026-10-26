/**
 * Non-physical browser poses for official LimX OLI (HU_D04) and LUNA (HU_L04).
 *
 * The actual robots have parallel ankle/waist linkages, which URDF represents
 * as a serial visual approximation. These are NOT executable whole-body
 * trajectories, tested walking policies or stability-certified joint targets.
 * They only give a gentle preview of the manufacturer-authored geometry.
 */
export const HUMANOID_MOTIONS = [
  { id: 'idle', name: 'Standing', group: 'BASIC MOTIONS', duration: 8,
    description: 'A relaxed upright pose with subtle weight transfer.', icon: 'Activity' },
  { id: 'walk', name: 'March Preview', group: 'BASIC MOTIONS', duration: 6,
    description: 'Illustrative alternating leg and arm motion; not a validated walking policy.', icon: 'Footprints' },
  { id: 'turn', name: 'Body Turn', group: 'BASIC MOTIONS', duration: 6,
    description: 'A reversible turn preview with gentle foot and waist coordination.', icon: 'Compass' },
  { id: 'greet', name: 'Wave Hello', group: 'INTERACTIONS', duration: 5,
    description: 'A smooth arm raise, wrist wave and return.', icon: 'Hand' },
  { id: 'inspect', name: 'Look Around', group: 'INTERACTIONS', duration: 6,
    description: 'The head and waist slowly scan the surrounding studio.', icon: 'ScanEye' },
];
export const HUMANOID_MOTION_BY_ID = Object.fromEntries(HUMANOID_MOTIONS.map(x => [x.id, x]));

const PI = Math.PI;
const TAU = PI * 2;
const SIDE = ['left', 'right'];
const PROFILES = {
  oli: { height: .89, offset: 0, headPitchMax: .785, shoulderRoll: [-.087, 3.229], shoulderRollR: [-3.229, .087] },
  luna: { height: .88, offset: 0, headPitchMax: .5236, shoulderRoll: [-.087266, 1.9199], shoulderRollR: [-1.9199, .087266] },
};
const LIMITS = {
  oli: {
    hip_pitch: [-2.618, 2.618], hip_roll: [-.8727, .8727], hip_yaw: [-2.618, 2.618],
    knee: [-.087, 2.583], ankle_pitch: [-1.012, .611], ankle_roll: [-.436, .436],
    shoulder_pitch: [-2.792, 2.792], elbow: [-2.443, 1.571],
    shoulder_yaw: [-1.571, 1.571], wrist_yaw: [-.785, .785],
    head_yaw: [-.785, .785], head_pitch: [-.524, .785],
    waist_yaw: [-2.618, 2.618], waist_roll: [-.524, .524], waist_pitch: [-.524, .785],
  },
  luna: {
    hip_pitch: [-3.0543, 1.5708], hip_roll: [-1.0472, 1.0472], hip_yaw: [-1.5708, 1.5708],
    knee: [-.087266, 2.4435], ankle_pitch: [-1.0123, .61086], ankle_roll: [-.43633, .43633],
    shoulder_pitch: [-3.0543, 1.0472], elbow: [-2.3911, .5236],
    shoulder_yaw: [-1.5708, 1.5708], wrist_yaw: [-1.5708, 1.5708],
    head_yaw: [-.7854, .7854], head_pitch: [-.5236, .5236],
    waist_yaw: [-1.5708, 1.5708], waist_roll: [-.5236, .5236], waist_pitch: [-.5236, .7854],
  },
};
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = u => { const t = clamp(u, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const robotStates = new WeakMap();

function neutral(robotId) {
  const p = PROFILES[robotId];
  const joints = {
    waist_yaw_joint: 0, waist_roll_joint: 0, waist_pitch_joint: 0,
    head_yaw_joint: 0, head_pitch_joint: 0,
  };
  for (const side of SIDE) {
    joints[side + '_hip_pitch_joint'] = -.12;
    joints[side + '_hip_roll_joint'] = 0;
    joints[side + '_hip_yaw_joint'] = 0;
    joints[side + '_knee_joint'] = .25;
    joints[side + '_ankle_pitch_joint'] = -.13;
    joints[side + '_ankle_roll_joint'] = 0;
    joints[side + '_shoulder_pitch_joint'] = .02;
    joints[side + '_shoulder_roll_joint'] = side === 'left' ? .14 : -.14;
    joints[side + '_shoulder_yaw_joint'] = 0;
    joints[side + '_elbow_joint'] = -.26;
    joints[side + '_wrist_yaw_joint'] = 0;
  }
  if (robotId === 'oli') {
    for (const side of SIDE) {
      joints[side + '_wrist_pitch_joint'] = 0;
      joints[side + '_wrist_roll_joint'] = 0;
    }
  }
  return {
    body: { height: p.height, yaw: 0, pitch: 0, roll: 0 },
    joints,
  };
}

function constrained(pose, robotId) {
  const limits = LIMITS[robotId];
  const profile = PROFILES[robotId];
  for (const [joint, angle] of Object.entries(pose.joints)) {
    if (!Number.isFinite(angle)) throw Error('Nonfinite humanoid joint angle: ' + joint);
    if (joint.includes('shoulder_roll')) {
      pose.joints[joint] = clamp(angle, ...(joint.startsWith('left') ? profile.shoulderRoll : profile.shoulderRollR));
      continue;
    }
    let type = joint.replace(/^(left|right)_/, '').replace(/_joint$/, '');
    if (type === 'wrist_pitch' || type === 'wrist_roll') continue;
    if (type === 'hip_roll') {
      const range = robotId === 'oli'
        ? (joint.startsWith('left') ? [-.8727, 2.094] : [-2.094, .8727])
        : (joint.startsWith('left') ? [-1.0472, 1.5708] : [-1.5708, 1.0472]);
      pose.joints[joint] = clamp(angle, ...range);
      continue;
    }
    const range = limits[type];
    if (range) pose.joints[joint] = clamp(angle, ...range);
  }
  return pose;
}

export function sampleHumanoidMotion(robotId, motionId, seconds) {
  const kind = PROFILES[robotId] ? robotId : 'oli';
  const id = HUMANOID_MOTION_BY_ID[motionId] ? motionId : 'idle';
  const duration = HUMANOID_MOTION_BY_ID[id].duration;
  const time = ((Number.isFinite(seconds) ? seconds : 0) % duration + duration) % duration;
  const p = time / duration;
  const theta = TAU * p;
  const pose = neutral(kind);
  const j = pose.joints;

  if (id === 'idle') {
    pose.body.height += .0017 * Math.sin(TAU * time / 4);
    pose.body.roll = .003 * Math.sin(theta);
    j.waist_roll_joint = .01 * Math.sin(theta);
  } else if (id === 'walk') {
    // A recognizable stepping silhouette, NOT planted-foot IK or stable walking.
    const cycle = TAU * 1.5 * time; // exactly 9 steps/cycles per 6 seconds
    pose.body.height += .005 * Math.cos(2 * cycle);
    pose.body.roll = .013 * Math.sin(cycle);
    pose.body.pitch = .012 * Math.sin(cycle);
    j.waist_yaw_joint = .035 * Math.sin(cycle);
    for (const side of SIDE) {
      const sign = side === 'left' ? 1 : -1;
      const wave = Math.sin(cycle + (sign === 1 ? 0 : PI));
      const lift = Math.pow(Math.max(0, wave), 2);
      j[side + '_hip_pitch_joint'] += .19 * wave;
      j[side + '_knee_joint'] += .24 * lift;
      j[side + '_ankle_pitch_joint'] -= .10 * wave + .055 * lift;
      j[side + '_shoulder_pitch_joint'] = -.15 * wave;
      j[side + '_elbow_joint'] = -.26 - .10 * Math.max(0, -wave);
    }
  } else if (id === 'turn') {
    pose.body.yaw = .32 * Math.sin(theta);
    j.waist_yaw_joint = .10 * Math.sin(theta);
    pose.body.roll = .009 * Math.sin(theta);
    for (const side of SIDE) {
      const sign = side === 'left' ? 1 : -1;
      const phase = TAU * 1.5 * time + (sign === 1 ? 0 : PI);
      j[side + '_hip_yaw_joint'] = sign * .10 * Math.sin(theta);
      j[side + '_hip_pitch_joint'] += .09 * Math.sin(phase);
      j[side + '_knee_joint'] += .10 * Math.max(0, Math.sin(phase)) ** 2;
    }
  } else if (id === 'greet') {
    const lift = ease((time - .55) / .85) * (1 - ease((time - 3.65) / .85));
    j.right_shoulder_roll_joint = -.14 - 1.10 * lift;
    j.right_shoulder_pitch_joint = -.36 * lift;
    j.right_elbow_joint = -.26 - .77 * lift;
    j.right_wrist_yaw_joint = .36 * lift * Math.sin(TAU * 1.6 * (time - .55));
    j.head_yaw_joint = -.15 * lift;
  } else if (id === 'inspect') {
    j.head_yaw_joint = .32 * Math.sin(theta);
    j.head_pitch_joint = -.10 * Math.sin(theta);
    j.waist_yaw_joint = .10 * Math.sin(theta);
    j.waist_roll_joint = .025 * Math.sin(theta);
    pose.body.yaw = .06 * Math.sin(theta);
  }
  return constrained(pose, kind);
}

function blendPose(a, b, t) {
  const joints = {};
  for (const k of Object.keys(b.joints)) joints[k] = lerp(a.joints[k] ?? 0, b.joints[k], t);
  return {
    body: Object.fromEntries(Object.keys(b.body).map(k => [k, lerp(a.body[k], b.body[k], t)])),
    joints,
  };
}

export function applyHumanoidMotion(robot, stage, robotId, id, seconds, options = {}) {
  if (!robot || !stage) return;
  const target = sampleHumanoidMotion(robotId, id, seconds);
  const previous = robotStates.get(robot);
  let transition = previous?.transition ?? null;
  if (!previous || options.instant) transition = null;
  else if (previous.id !== id) transition = { start: previous.pose, elapsed: 0 };
  let pose = target;
  if (transition) {
    transition.elapsed = Math.min(.4, transition.elapsed + clamp(options.deltaTime ?? (1 / 60), 0, .05));
    pose = blendPose(transition.start, target, ease(transition.elapsed / .4));
    if (transition.elapsed >= .4) transition = null;
  }
  stage.position.y = pose.body.height;
  stage.rotation.set(pose.body.roll, pose.body.yaw, pose.body.pitch, 'YXZ');
  for (const [joint, value] of Object.entries(pose.joints)) {
    if (robot.joints?.[joint]) robot.setJointValue(joint, value);
  }
  robotStates.set(robot, { id, pose, transition });
}
