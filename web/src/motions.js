/**
 * MagicDog browser-only motion previews.
 *
 * URDF-calibrated geometric facts:
 * - Front/rear knee and thigh joints both rotate about local +Y.
 * - thigh-to-knee and knee-to-foot lengths are 0.20 m each.
 * - Base standing height is ~0.325 m.
 *
 * Motions are analytical previews, not measured trajectories or stable
 * whole-body controllers. This file never changes the URDF or physics model.
 */

export const MOTIONS = [
  { id: 'idle', name: 'Idle / Stand', group: 'BASIC MOTIONS', duration: 8, description: 'A balanced standing pose with gentle breathing and weight shifts.', icon: 'Activity' },
  { id: 'walk', name: 'Walking', group: 'BASIC MOTIONS', duration: 6, description: 'An in-place diagonal trot with separate ground-contact and foot-swing phases.', icon: 'Footprints' },
  { id: 'turn', name: 'Turning', group: 'BASIC MOTIONS', duration: 6, description: 'A gentle, reversible in-place turn with counter-stepping feet.', icon: 'Compass' },
  { id: 'greet', name: 'Greeting', group: 'INTERACTIONS', duration: 5, description: 'A smooth right-front paw raise, hold, and return.', icon: 'Hand' },
  { id: 'inspect', name: 'Inspection', group: 'INTERACTIONS', duration: 6, description: 'A slow scanning motion with coordinated torso and leg adjustments.', icon: 'ScanEye' },
];
export const MOTION_BY_ID = Object.fromEntries(MOTIONS.map(m => [m.id, m]));

const TAU = 2 * Math.PI;
const L1 = 0.20;
const L2 = 0.20;
const BASE_HEIGHT = 0.325;
const TRANSITION_SECONDS = 0.36;
const LEG_NAMES = ['FL', 'FR', 'RL', 'RR'];
const DIAGONAL_PHASE = { FL: 0, RR: 0, FR: 0.5, RL: 0.5 };
const REST_JOINTS = {
  FL: [0, 0.78, -1.48],
  FR: [0, 0.78, -1.48],
  RL: [0, 0.82, -1.48],
  RR: [0, 0.82, -1.48],
};
const LIMITS = {
  hipLeft: [-0.7853981634, 0.6457718232],
  hipRight: [-0.6457718232, 0.7853981634],
  thigh: [-1.2653637077, 3.6215581979],
  knee: [-2.4958208304, -0.5235987756],
};
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const lerp = (a, b, t) => a + (b - a) * t;

function smootherstep(u) {
  const t = clamp(u, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function restFoot(leg) {
  const [, thigh, knee] = REST_JOINTS[leg];
  return {
    x: -L1 * Math.sin(thigh) - L2 * Math.sin(thigh + knee),
    z: -L1 * Math.cos(thigh) - L2 * Math.cos(thigh + knee),
  };
}
const REST_FEET = Object.fromEntries(LEG_NAMES.map(leg => [leg, restFoot(leg)]));

/**
 * 2-link sagittal inverse kinematics in the URDF joint convention.
 * A downward straight leg is theta = knee = 0; a bent knee is negative.
 * Keep positions inside the physically reachable leg workspace.
 */
function footIK(x, z) {
  const distanceSq = clamp(x * x + z * z, 0.0001, (L1 + L2 - 0.001) ** 2);
  const cosKnee = clamp((distanceSq - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const knee = -Math.acos(cosKnee);
  const thigh = Math.atan2(-x, -z) - Math.atan2(
    L2 * Math.sin(knee),
    L1 + L2 * Math.cos(knee),
  );
  return [
    clamp(thigh, ...LIMITS.thigh),
    clamp(knee, ...LIMITS.knee),
  ];
}

/**
 * Smooth cyclic foot path:
 *  - stance: foot travels backwards at approximately ground level
 *  - swing: foot returns forwards via an elevated arch
 *
 * Both ends of each portion use a quintic easing function; position, speed,
 * and acceleration vanish at the phase boundaries to prevent visible snaps.
 */
function footCycle(phase, stride, lift, duty = 0.58) {
  const p = ((phase % 1) + 1) % 1;
  if (p < duty) {
    const progress = smootherstep(p / duty);
    return { x: stride * (0.5 - progress), lift: 0 };
  }
  const u = (p - duty) / (1 - duty);
  const travel = smootherstep(u);
  const arc = Math.sin(Math.PI * u);
  return { x: stride * (travel - 0.5), lift: lift * arc * arc };
}

function wavePhase(seconds, hz, leg) {
  return (seconds * hz + DIAGONAL_PHASE[leg]) % 1;
}

function createRestPose() {
  return {
    body: { height: BASE_HEIGHT, yaw: 0, roll: 0, pitch: 0 },
    joints: Object.fromEntries(LEG_NAMES.map(leg => [leg, [...REST_JOINTS[leg]]])),
  };
}

/**
 * Pure analytical evaluation: evaluating the same time always gives the same
 * pose. Every motion duration is chosen so its trajectory loops continuously.
 */
export function sampleMotion(id, seconds) {
  const key = MOTION_BY_ID[id] ? id : 'idle';
  const duration = MOTION_BY_ID[key].duration;
  const t = ((Number.isFinite(seconds) ? seconds : 0) % duration + duration) % duration;
  const progress = t / duration;
  const cycle = 1.5 * t; // 6 seconds = 9 full trot cycles
  const pose = createRestPose();

  if (key === 'idle') {
    pose.body.height += 0.0014 * Math.sin(TAU * (t / 4));
    pose.body.roll = 0.003 * Math.sin(TAU * (t / 8));
    return pose;
  }

  if (key === 'walk' || key === 'turn') {
    const turning = key === 'turn';
    const turnRate = Math.cos(TAU * progress);
    if (turning) pose.body.yaw = 0.40 * Math.sin(TAU * progress);

    // Two diagonal pairs move half a stride out of phase.
    for (const leg of LEG_NAMES) {
      const phase = wavePhase(t, 1.5, leg);
      const sideSign = leg.endsWith('L') ? 1 : -1;
      const stride = turning ? 0.064 * sideSign * turnRate : 0.096;
      const { x, lift } = footCycle(phase, stride, turning ? 0.027 : 0.036);
      const base = REST_FEET[leg];
      const [thigh, knee] = footIK(base.x + x, base.z + lift);
      const hipSway = (turning ? 0.010 : 0.014) * Math.sin(TAU * phase);
      pose.joints[leg] = [
        clamp(hipSway, ...(sideSign === 1 ? LIMITS.hipLeft : LIMITS.hipRight)),
        thigh, knee,
      ];
    }

    // Small synchronized weight transfer, not exaggerated floating.
    pose.body.height += (turning ? 0.0019 : 0.0032) * Math.cos(TAU * 2 * cycle);
    pose.body.pitch = (turning ? 0.003 : 0.007) * Math.sin(TAU * cycle);
    pose.body.roll = (turning ? 0.006 : 0.004) * Math.sin(TAU * cycle);
    return pose;
  }

  if (key === 'greet') {
    // Smooth ramp up, hold the paw, smooth ramp down.
    const lift = smootherstep((t - 0.55) / 0.95) * (1 - smootherstep((t - 3.50) / 0.95));
    const base = REST_FEET.FR;
    const wag = 0.008 * Math.sin(TAU * 1.2 * (t - 0.55));
    const [thigh, knee] = footIK(
      base.x + (0.079 + wag) * lift,
      base.z + 0.092 * lift,
    );
    pose.joints.FR = [
      clamp(-0.075 * lift, ...LIMITS.hipRight), thigh, knee,
    ];
    pose.body.pitch = -0.015 * lift;
    pose.body.roll = -0.010 * lift;
    return pose;
  }

  // Inspect: steady slow headless body scan (head is fixed in this URDF).
  const w = TAU * progress;
  pose.body.yaw = 0.14 * Math.sin(w);
  pose.body.pitch = -0.024 * Math.sin(w);
  pose.body.roll = 0.008 * Math.sin(w);
  pose.body.height += 0.0015 * Math.sin(w) ** 2;
  for (const leg of LEG_NAMES) {
    const [, thigh, knee] = REST_JOINTS[leg];
    pose.joints[leg][1] = thigh + 0.025 * Math.sin(w);
    pose.joints[leg][2] = knee - 0.015 * Math.sin(w);
  }
  return pose;
}

function mixPose(from, to, t) {
  const joints = {};
  for (const leg of LEG_NAMES) {
    joints[leg] = from.joints[leg].map((v, index) => lerp(v, to.joints[leg][index], t));
  }
  return {
    body: {
      height: lerp(from.body.height, to.body.height, t),
      yaw: lerp(from.body.yaw, to.body.yaw, t),
      roll: lerp(from.body.roll, to.body.roll, t),
      pitch: lerp(from.body.pitch, to.body.pitch, t),
    },
    joints,
  };
}

const lastPoseByRobot = new WeakMap();

/**
 * Update only robot joints and the stage transform.
 *
 * Crossfade between different motions over 360ms to avoid hard joint snaps.
 * pass {instant: true} when scrubbing the timeline to get the exact pose.
 */
export function applyMotion(robot, stage, id, time, options = {}) {
  if (!robot || !stage) return;
  const target = sampleMotion(id, time);
  const previous = lastPoseByRobot.get(robot);
  const instant = options.instant === true;
  let transition = previous?.transition ?? null;

  if (!previous || instant) {
    transition = null;
  } else if (previous.id !== id) {
    transition = { start: previous.pose, elapsed: 0 };
  }

  let pose = target;
  if (transition) {
    const dt = clamp(Number.isFinite(options.deltaTime) ? options.deltaTime : (1 / 60), 0, 0.05);
    transition.elapsed = Math.min(TRANSITION_SECONDS, transition.elapsed + dt);
    const alpha = smootherstep(transition.elapsed / TRANSITION_SECONDS);
    pose = mixPose(transition.start, target, alpha);
    if (transition.elapsed >= TRANSITION_SECONDS) transition = null;
  }

  stage.position.y = pose.body.height;
  stage.rotation.set(pose.body.roll, pose.body.yaw, pose.body.pitch, 'YXZ');
  for (const leg of LEG_NAMES) {
    const [hip, thigh, knee] = pose.joints[leg];
    robot.setJointValue(leg + '_hip_joint', hip);
    robot.setJointValue(leg + '_thigh_joint', thigh);
    robot.setJointValue(leg + '_calf_joint', knee);
  }
  lastPoseByRobot.set(robot, { id, pose, transition });
}
