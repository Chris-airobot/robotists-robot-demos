/**
 * LimX OLI / LUNA browser-only, non-physical humanoid demonstrations.
 *
 * Walking uses a cautious in-place alternating foot trajectory with separate
 * ground-level stance and elevated swing phases, solved with an approximate
 * two-link sagittal inverse kinematics model calibrated to each LimX URDF.
 * A demonstration only: it is NOT physical whole-body locomotion. Torso and
 * gesture motions keep the pelvis and legs stationary to avoid foot skating.
 * This model retains the original squat as a separate interaction.
 *
 * No assertion of dynamic stability, whole-body control, parallel linkage
 * actuation, genuine contact-force balance or hardware deployment.
 */

export const HUMANOID_MOTIONS = [
  {
    id: 'idle', name: 'Ready Stance', group: 'BASIC MOTIONS', duration: 8,
    description: 'Quiet standing posture with subtle upper-body breathing. Both feet stay planted.',
    icon: 'Activity',
  },
  {
    id: 'walk', name: 'Walking Preview', group: 'BASIC MOTIONS', duration: 6,
    description: 'In-place, alternating-foot walking preview with ground-level stance and lifted swing. Not a real control policy.',
    icon: 'Footprints',
  },
  {
    id: 'squat', name: 'Controlled Squat', group: 'BASIC MOTIONS', duration: 6,
    description: 'Synchronized hip, knee, ankle and pelvis-height motion with feet kept approximately level.',
    icon: 'Activity',
  },
  {
    id: 'turn', name: 'Torso Turn', group: 'BASIC MOTIONS', duration: 6,
    description: 'Turn the waist and head while the pelvis and feet remain stationary.',
    icon: 'Compass',
  },
  {
    id: 'greet', name: 'Wave Hello', group: 'INTERACTIONS', duration: 6,
    description: 'Shift attention, smoothly lift the right arm, wave and lower it.',
    icon: 'Hand',
  },
  {
    id: 'inspect', name: 'Look Around', group: 'INTERACTIONS', duration: 8,
    description: 'Pause and deliberately inspect left, center and right with head and torso.',
    icon: 'ScanEye',
  },
  {
    id: 'reach', name: 'Reach Forward', group: 'INTERACTIONS', duration: 6,
    description: 'Extend the left arm forward, hold a target pose and return smoothly.',
    icon: 'Hand',
  },
];
export const HUMANOID_MOTION_BY_ID = Object.fromEntries(HUMANOID_MOTIONS.map(x => [x.id, x]));

const TAU = Math.PI * 2;
const SIDES = ['left', 'right'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => {
  const u = clamp(t, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/** A smooth on / hold / smooth off animation envelope in seconds. */
function envelope(time, riseStart, riseEnd, fallStart, fallEnd) {
  return smoothstep((time - riseStart) / (riseEnd - riseStart))
       * (1 - smoothstep((time - fallStart) / (fallEnd - fallStart)));
}

/**
 * Smoothly interpolates authored key points (C2 at each key), avoiding
 * the bounce and flicker of independently oscillating joints.
 */
function keyframe(time, points) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (time <= b[0]) {
      const u = smoothstep((time - a[0]) / (b[0] - a[0]));
      return lerp(a[1], b[1], u);
    }
  }
  return points[points.length - 1][1];
}

const PROFILES = {
  // Upper/lower effective sagittal lengths are approximate; OLI's unusual
  // oblique hip-pitch axis and parallel ankle geometry require full FK / WBC
  // for millimetre-level contacts. Squat is a qualitative visual preview.
  oli: {
    height: .89, upper: .385, lower: .385,
    kneeRange: [-.087, 2.583],
    // Hip-pitch origin to knee includes roll/yaw link offsets in the URDF.
    gaitUpper: .467, gaitLower: .385,
    wavePose: {
      // FK-calibrated right arm: wrist beside head, forearm angled upward.
      shoulderPitch: -.22, shoulderRoll: -1.89,
      shoulderYaw: -.79, elbow: -1.90,
      wristYaw: .35, wristPitch: -.10, wristRoll: .08,
    },
    shoulderRollL: [-.087, 3.229],
    shoulderRollR: [-3.229, .087],
  },
  luna: {
    height: .88, upper: .365, lower: .417,
    kneeRange: [-.087266, 2.4435],
    gaitUpper: .3608, gaitLower: .417,
    wavePose: {
      // LUNA's longer forearm needs elbow flexion to lift the hand, NOT
      // near-horizontal shoulder abduction (the old visual failure).
      shoulderPitch: -1.02, shoulderRoll: -.78,
      shoulderYaw: -.33, elbow: -1.99,
      wristYaw: .35,
    },
    shoulderRollL: [-.087266, 1.9199],
    shoulderRollR: [-1.9199, .087266],
  },
};

const LIMITS = {
  oli: {
    hip_pitch: [-2.618, 2.618], hip_yaw: [-2.618, 2.618],
    knee: [-.087, 2.583], ankle_pitch: [-1.012, .611], ankle_roll: [-.436, .436],
    shoulder_pitch: [-2.792, 2.792], elbow: [-2.443, 1.571],
    head_yaw: [-.785, .785], head_pitch: [-.524, .785],
    waist_yaw: [-2.618, 2.618], waist_roll: [-.524, .524], waist_pitch: [-.524, .785],
    wrist_pitch: [-1.571, 1.571], wrist_roll: [-1.571, 1.571],
  },
  luna: {
    hip_pitch: [-3.0543, 1.5708], hip_yaw: [-1.5708, 1.5708],
    knee: [-.087266, 2.4435], ankle_pitch: [-1.0123, .61086], ankle_roll: [-.43633, .43633],
    shoulder_pitch: [-3.0543, 1.0472], elbow: [-2.3911, .5236],
    head_yaw: [-.7854, .7854], head_pitch: [-.5236, .5236],
    waist_yaw: [-1.5708, 1.5708], waist_roll: [-.5236, .5236], waist_pitch: [-.5236, .7854],
  },
};

function makePose(robotId) {
  const cfg = PROFILES[robotId];
  const joints = {
    waist_yaw_joint: 0,
    waist_roll_joint: 0,
    waist_pitch_joint: 0,
    head_yaw_joint: 0,
    head_pitch_joint: 0,
  };
  for (const side of SIDES) {
    joints[side + '_hip_pitch_joint'] = -.12;
    joints[side + '_hip_roll_joint'] = 0;
    joints[side + '_hip_yaw_joint'] = 0;
    joints[side + '_knee_joint'] = .24;
    joints[side + '_ankle_pitch_joint'] = -.12;
    joints[side + '_ankle_roll_joint'] = 0;
    joints[side + '_shoulder_pitch_joint'] = .01;
    joints[side + '_shoulder_roll_joint'] = side === 'left' ? .14 : -.14;
    joints[side + '_shoulder_yaw_joint'] = 0;
    joints[side + '_elbow_joint'] = -.26;
    joints[side + '_wrist_yaw_joint'] = 0;
    if (robotId === 'oli') {
      joints[side + '_wrist_pitch_joint'] = 0;
      joints[side + '_wrist_roll_joint'] = 0;
    }
  }
  return { body: { height: cfg.height, yaw: 0, roll: 0, pitch: 0 }, joints };
}

function constrain(pose, robotId) {
  for (const [name, value] of Object.entries(pose.joints)) {
    if (!Number.isFinite(value)) throw new Error('Invalid joint value for ' + name);
    const side = name.startsWith('left_') ? 'left' : name.startsWith('right_') ? 'right' : null;
    const key = name.replace(/^(left|right)_/, '').replace(/_joint$/, '');
    let limits = LIMITS[robotId][key];
    if (key === 'shoulder_roll') {
      limits = side === 'left' ? PROFILES[robotId].shoulderRollL : PROFILES[robotId].shoulderRollR;
    } else if (key === 'hip_roll') {
      limits = robotId === 'oli'
        ? (side === 'left' ? [-.8727, 2.094] : [-2.094, .8727])
        : (side === 'left' ? [-1.0472, 1.5708] : [-1.5708, 1.0472]);
    } else if (key === 'shoulder_yaw') {
      limits = robotId === 'oli'
        ? (side === 'left' ? [-3.403, 1.571] : [-1.571, 3.403])
        : (side === 'left' ? [-2.5307, 1.5708] : [-1.5708, 2.5307]);
    } else if (key === 'wrist_yaw') {
      limits = robotId === 'oli'
        ? (side === 'left' ? [-2.356, .785] : [-.785, 2.356])
        : [-1.5708, 1.5708];
    }
    if (limits) pose.joints[name] = clamp(value, ...limits);
  }
  if (!Object.values(pose.body).every(Number.isFinite)) {
    throw new Error('Invalid root transform');
  }
  return pose;
}

/**
 * Approximate vertical reach of a folded 2-link sagittal leg.
 * Used to lower the pelvis as the knees fold, instead of bending knees
 * while leaving the pelvis floating at its original height.
 */
function reachHeight(cfg, knee) {
  const hip = -knee * (cfg.lower / (cfg.upper + cfg.lower));
  return cfg.upper * Math.cos(hip) + cfg.lower * Math.cos(hip + knee);
}

/** Approximate sagittal FK foot location relative to the hip-pitch axis. */
function gaitFootHome(cfg) {
  const q0 = -.12;
  const knee0 = .24;
  return {
    x: -cfg.gaitUpper * Math.sin(q0) - cfg.gaitLower * Math.sin(q0 + knee0),
    z: -cfg.gaitUpper * Math.cos(q0) - cfg.gaitLower * Math.cos(q0 + knee0),
  };
}

/** 2-link IK in the model's hip/knee pitch convention: positive bent knee. */
function solveFoot(x, z, cfg) {
  const u = cfg.gaitUpper;
  const l = cfg.gaitLower;
  const radiusSq = Math.min(x * x + z * z, (u + l - .0002) ** 2);
  const cosine = clamp((radiusSq - u * u - l * l) / (2 * u * l), -1, 1);
  const knee = Math.acos(cosine);
  const hip = Math.atan2(-x, -z) - Math.atan2(l * Math.sin(knee), u + l * Math.cos(knee));
  return { hip, knee, ankle: -(hip + knee) };
}

/**
 * In-place step with 62% stance duty and a continuous elevated swing arc.
 * Both sides of the loop meet without joint or foot-position discontinuity.
 */
function footStep(phase) {
  const p = ((phase % 1) + 1) % 1;
  const stance = .62;
  if (p < stance) {
    return { forward: .5 - smoothstep(p / stance), lift: 0, support: true };
  }
  const u = (p - stance) / (1 - stance);
  return {
    forward: smoothstep(u) - .5,
    lift: Math.sin(Math.PI * u) ** 2,
    support: false,
  };
}

export function sampleHumanoidMotion(robotId, motionId, seconds) {
  const id = HUMANOID_MOTION_BY_ID[motionId] ? motionId : 'idle';
  const kind = PROFILES[robotId] ? robotId : 'oli';
  const cfg = PROFILES[kind];
  const duration = HUMANOID_MOTION_BY_ID[id].duration;
  const t = ((Number.isFinite(seconds) ? seconds : 0) % duration + duration) % duration;
  const pose = makePose(kind);
  const j = pose.joints;

  if (id === 'idle') {
    // Keep the pelvis and feet fixed. Only the waist and head move slightly.
    j.waist_pitch_joint = .009 * Math.sin(TAU * t / 8);
    j.head_pitch_joint = -.004 * Math.sin(TAU * t / 8);
  } else if (id === 'walk') {
    // Unlike the old joint-angle sine-wave march, the feet have an explicit
    // stationary-height stance and elevated swing path. The scene is a
    // treadmill-style preview with the torso staying near a fixed location,
    // not world-space walking or a validated contact-force controller.
    const home = gaitFootHome(cfg);
    const progress = t * (5 / duration); // exactly five left/right cycles / loop
    for (const side of SIDES) {
      const phase = progress + (side === 'right' ? .5 : 0);
      const step = footStep(phase);
      const stride = .082;  // 8.2 cm treadmill step travel
      const lift = .038;    // 3.8 cm foot clearance
      const q = solveFoot(home.x + stride * step.forward, home.z + lift * step.lift, cfg);
      j[side + '_hip_pitch_joint'] = q.hip;
      j[side + '_knee_joint'] = q.knee;
      j[side + '_ankle_pitch_joint'] = q.ankle;
      // Opposite arm follows the moving leg; limit upper body movement.
      j[side + '_shoulder_pitch_joint'] = -.15 * Math.sin(TAU * (phase + .5));
      j[side + '_elbow_joint'] = -.28;
    }
    const sway = Math.sin(TAU * progress);
    j.waist_yaw_joint = .018 * sway;
    j.head_yaw_joint = -.012 * sway;
    // Keep pelvis world rotation/height fixed in this approximate IK preview:
    // yaw/roll/bobbing here would drag nominally planted feet.
  } else if (id === 'squat') {
    // A deliberate in-place squat, separate from Walking Preview.
    // A single down-and-up repetition, with long holds and zero derivatives
    // at the endpoints and direction change.
    const depth = keyframe(t, [
      [0, 0], [.55, 0], [2.0, 1], [2.65, 1],
      [4.15, 0], [6, 0],
    ]);
    const knee = .24 + .56 * depth;
    const hip = -knee * (cfg.lower / (cfg.upper + cfg.lower));
    const ankle = -(hip + knee);
    for (const side of SIDES) {
      j[side + '_hip_pitch_joint'] = hip;
      j[side + '_knee_joint'] = knee;
      j[side + '_ankle_pitch_joint'] = ankle;
      j[side + '_shoulder_pitch_joint'] = -.12 * depth;
      j[side + '_elbow_joint'] = -.26 - .11 * depth;
    }
    const baseReach = reachHeight(cfg, .24);
    pose.body.height = cfg.height - (baseReach - reachHeight(cfg, knee));
    // Feet face forward in this sagittal approximation (hip+knee+ankle≈0).
  } else if (id === 'turn') {
    // Only waist + head turn, not the whole world-space pelvis and feet.
    const turn = keyframe(t, [
      [0, 0], [.55, 0], [1.6, -.55], [2.25, -.55],
      [3.45, .40], [4.25, .40], [5.35, 0], [6, 0],
    ]);
    j.waist_yaw_joint = turn * .45;
    j.head_yaw_joint = turn * .70;
    j.waist_roll_joint = -.015 * turn;
    j.waist_pitch_joint = .012 * Math.abs(turn);
  } else if (id === 'greet') {
    const lift = envelope(t, .45, 1.60, 4.45, 5.70);
    const wave = envelope(t, 1.85, 2.15, 4.05, 4.38);
    // The previous "wave" had the entire right arm extended almost
    // horizontally at shoulder height. A wrist-above-shoulder assertion
    // cannot detect this. The targets below are calibrated using the actual
    // URDF FK of right_elbow_link / right_hand_contact / head_pitch_link.
    // In both models, the ELBOW bends so the FOREARM points up; the wrist
    // finishes close to the right side of the head rather than far away.
    const target = cfg.wavePose;
    const wag = Math.sin(TAU * 1.05 * (t - 2.15));
    j.right_shoulder_pitch_joint = lerp(.01, target.shoulderPitch, lift);
    j.right_shoulder_roll_joint = lerp(-.14, target.shoulderRoll, lift);
    j.right_shoulder_yaw_joint = target.shoulderYaw * lift + .055 * wave * wag;
    j.right_elbow_joint = lerp(-.26, target.elbow, lift) + .075 * wave * wag;
    // LUNA has only one actuated wrist axis. Use gentle wrist yaw + elbow
    // motion; OLI can also add wrist roll for the visible greeting gesture.
    j.right_wrist_yaw_joint = target.wristYaw * lift + .18 * wave * wag;
    if (kind === 'oli') {
      j.right_wrist_pitch_joint = target.wristPitch * lift + .08 * wave * wag;
      j.right_wrist_roll_joint = target.wristRoll * lift + .18 * wave * wag;
    }
    j.head_yaw_joint = -.10 * lift;
    // No lower-body/root turn; feet stay where they are.
  } else if (id === 'inspect') {
    // Choreographed slow saccades and pauses, no fast bobbling.
    const gaze = keyframe(t, [
      [0, 0], [.65, 0], [1.55, .40], [2.6, .40],
      [3.7, -.32], [5.0, -.32], [6.35, 0], [8, 0],
    ]);
    const lookDown = keyframe(t, [
      [0, 0], [2, 0], [3.1, -.10], [4.2, -.10],
      [5.1, 0], [8, 0],
    ]);
    j.head_yaw_joint = gaze;
    j.head_pitch_joint = lookDown;
    j.waist_yaw_joint = .18 * gaze;
  } else if (id === 'reach') {
    const extend = envelope(t, .6, 1.65, 4.2, 5.35);
    j.left_shoulder_pitch_joint = -.62 * extend;
    j.left_shoulder_roll_joint = .14 + .11 * extend;
    j.left_elbow_joint = -.26 - .18 * extend;
    j.left_wrist_yaw_joint = -.12 * extend;
    j.head_yaw_joint = .10 * extend;
    j.head_pitch_joint = -.06 * extend;
    j.waist_yaw_joint = .06 * extend;
  }

  return constrain(pose, kind);
}

function mixPose(a, b, t) {
  return {
    body: Object.fromEntries(
      Object.keys(b.body).map(k => [k, lerp(a.body[k], b.body[k], t)])
    ),
    joints: Object.fromEntries(
      Object.keys(b.joints).map(k => [k, lerp(a.joints[k] ?? 0, b.joints[k], t)])
    ),
  };
}

const stateByRobot = new WeakMap();

/**
 * Switching motions blends from the currently visible pose over 0.65s.
 * Scrubbing is deliberately immediate, but selecting a new motion must not
 * trigger a scrub event (otherwise it bypasses this smoothing entirely).
 */
export function applyHumanoidMotion(robot, stage, robotId, id, seconds, options = {}) {
  if (!robot || !stage) return;
  const target = sampleHumanoidMotion(robotId, id, seconds);
  const last = stateByRobot.get(robot);
  let transition = last?.transition ?? null;
  if (!last || options.instant) {
    transition = null;
  } else if (last.id !== id) {
    transition = { start: last.pose, elapsed: 0 };
  }
  let pose = target;
  if (transition) {
    const dt = clamp(Number.isFinite(options.deltaTime) ? options.deltaTime : 1 / 60, 0, .05);
    transition.elapsed = Math.min(.65, transition.elapsed + dt);
    pose = mixPose(transition.start, target, smoothstep(transition.elapsed / .65));
    if (transition.elapsed >= .65) transition = null;
  }
  stage.position.y = pose.body.height;
  stage.rotation.set(pose.body.roll, pose.body.yaw, pose.body.pitch, 'YXZ');
  for (const [joint, value] of Object.entries(pose.joints)) {
    if (robot.joints?.[joint]) robot.setJointValue(joint, value);
  }
  stateByRobot.set(robot, { id, pose, transition });
}
