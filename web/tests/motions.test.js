import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS, applyMotion, sampleMotion } from '../src/motions.js';
import { sampleUnitreeMotion, applyUnitreeMotion } from '../src/unitreeMotions.js';

const LEGS = ['FL', 'FR', 'RL', 'RR'];
const LIMITS = {
  hipL: [-0.7853981634, 0.6457718232],
  hipR: [-0.6457718232, 0.7853981634],
  thigh: [-1.2653637077, 3.6215581979],
  calf: [-2.4958208304, -0.5235987756],
};
function difference(a, b) {
  let largest = 0;
  for (const leg of LEGS) {
    for (let i = 0; i < 3; i++) {
      largest = Math.max(largest, Math.abs(a.joints[leg][i] - b.joints[leg][i]));
    }
  }
  for (const key of ['height', 'yaw', 'roll', 'pitch']) {
    largest = Math.max(largest, Math.abs(a.body[key] - b.body[key]));
  }
  return largest;
}

test('every motion respects MagicDog URDF joint limits and yields finite values', () => {
  for (const motion of MOTIONS) {
    for (let index = 0; index <= 900; index++) {
      const pose = sampleMotion(motion.id, motion.duration * index / 900);
      for (const leg of LEGS) {
        const ranges = [
          leg.endsWith('L') ? LIMITS.hipL : LIMITS.hipR,
          LIMITS.thigh, LIMITS.calf,
        ];
        for (let joint = 0; joint < 3; joint++) {
          const value = pose.joints[leg][joint];
          assert.ok(Number.isFinite(value), motion.id + ':' + leg + ' nonfinite');
          assert.ok(value >= ranges[joint][0] - 1e-6, motion.id + ':' + leg + ' below limit');
          assert.ok(value <= ranges[joint][1] + 1e-6, motion.id + ':' + leg + ' above limit');
        }
      }
    }
  }
});

test('all five animations match at the loop boundary without a jump', () => {
  for (const motion of MOTIONS) {
    const beforeWrap = sampleMotion(motion.id, motion.duration - 0.00001);
    const afterWrap = sampleMotion(motion.id, 0);
    assert.ok(
      difference(beforeWrap, afterWrap) < 0.001,
      motion.id + ' has loop seam: ' + difference(beforeWrap, afterWrap),
    );
  }
});

test('gait moves opposite diagonal pairs out of phase', () => {
  const pose = sampleMotion('walk', 0.42);
  assert.ok(Math.abs(pose.joints.FL[1] - pose.joints.FR[1]) > 0.015);
  assert.ok(Math.abs(pose.joints.RR[1] - pose.joints.RL[1]) > 0.015);
  // The front and rear pairs share the gait phase but have slightly
  // different default thigh angles in the URDF standing pose.
  assert.ok(Math.abs(pose.joints.FL[1] - pose.joints.RR[1]) < 0.08);
  assert.ok(Math.abs(pose.joints.FR[1] - pose.joints.RL[1]) < 0.08);
});

test('changing motions blends smoothly instead of snapping directly to target', () => {
  const values = {};
  const robot = { setJointValue(name, value) { values[name] = value; } };
  const stage = {
    position: { y: 0 },
    rotation: { set(...args) { this.values = args; } },
  };
  applyMotion(robot, stage, 'idle', 0);
  const oldThigh = values.FL_thigh_joint;
  const targetThigh = sampleMotion('walk', 0).joints.FL[1];

  applyMotion(robot, stage, 'walk', 0, { deltaTime: 1 / 60 });
  const firstBlended = values.FL_thigh_joint;
  assert.ok(Math.abs(firstBlended - oldThigh) < 0.01);
  assert.ok(Math.abs(firstBlended - targetThigh) > 0.01);

  for (let i = 1; i <= 28; i++) {
    applyMotion(robot, stage, 'walk', i / 60, { deltaTime: 1 / 60 });
  }
  assert.ok(Math.abs(values.FL_thigh_joint - sampleMotion('walk', 28 / 60).joints.FL[1]) < 1e-6);
});

test('manual scrubbing instantly applies exact target pose', () => {
  const values = {};
  const robot = { setJointValue(name, value) { values[name] = value; } };
  const stage = {
    position: { y: 0 },
    rotation: { set(...args) { this.values = args; } },
  };
  applyMotion(robot, stage, 'idle', 0);
  applyMotion(robot, stage, 'walk', 1.35, { instant: true });
  assert.equal(values.FR_calf_joint, sampleMotion('walk', 1.35).joints.FR[2]);
  assert.equal(stage.position.y, sampleMotion('walk', 1.35).body.height);
});

test('Go2 and A1 remain within their URDF limits over five cyclic previews', () => {
  for (const [robotId, limits] of [
    ['go2', [[-1.0472, 1.0472], [-1.5708, 3.4907], [-2.7227, -.83776]]],
    ['a1', [[-.802851455, .802851455], [-1.047197551, 4.188790204], [-2.696533694, -.916297857]]],
  ]) {
    for (const motion of MOTIONS) {
      for (let n = 0; n <= 300; n++) {
        const pose = sampleUnitreeMotion(robotId, motion.id, motion.duration * n / 300);
        for (const leg of LEGS) {
          for (let joint = 0; joint < 3; joint++) {
            const angle = pose.joints[leg][joint];
            assert.ok(Number.isFinite(angle));
            assert.ok(angle >= limits[joint][0] - .00001, robotId + ' ' + motion.id + ' joint below limit');
            assert.ok(angle <= limits[joint][1] + .00001, robotId + ' ' + motion.id + ' joint above limit');
          }
        }
      }
      const a = sampleUnitreeMotion(robotId, motion.id, motion.duration - .00001);
      const b = sampleUnitreeMotion(robotId, motion.id, 0);
      assert.ok(difference(a, b) < .001, robotId + '/' + motion.id + ' is not loop-safe');
    }
  }
});

test('Go2 and A1 preview pose is applied to correct URDF joint names', () => {
  for (const robotId of ['go2', 'a1']) {
    const values = {};
    const robot = { setJointValue(name, value) { values[name] = value; } };
    const stage = { position: { y: 0 }, rotation: { set() {} } };
    applyUnitreeMotion(robot, stage, robotId, 'walk', .5, { instant: true });
    assert.equal(Object.keys(values).length, 12);
    const pose = sampleUnitreeMotion(robotId, 'walk', .5);
    assert.equal(values.RR_calf_joint, pose.joints.RR[2]);
  }
});
