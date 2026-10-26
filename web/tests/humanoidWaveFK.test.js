import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleHumanoidMotion } from '../src/humanoidMotions.js';

const root = new URL('../../models/', import.meta.url);
const vec = text => (text || '0 0 0').trim().split(/\s+/).map(Number);
const add = (a, b) => a.map((v, i) => v + b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function rotate(v, rawAxis, angle) {
  const norm = Math.hypot(...rawAxis) || 1;
  const axis = rawAxis.map(x => x / norm);
  const c = Math.cos(angle), s = Math.sin(angle);
  const cv = cross(axis, v);
  const dot = axis.reduce((acc, x, i) => acc + x * v[i], 0);
  return v.map((x, i) => x * c + cv[i] * s + axis[i] * dot * (1 - c));
}

/**
 * Independent URDF chain forward kinematics; assertions below use actual
 * OEM joint origin offsets and axes, not just guessed shoulder angles.
 * This is a small zero-dependency fixture for joint/hand POSITION checks,
 * not a dynamics or collision simulation.
 */
function modelFK(xml) {
  const joints = [...xml.matchAll(/<joint\s+name="([^"]+)"\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/joint>/g)]
    .map(match => {
      const body = match[3];
      return {
        name: match[1],
        parent: body.match(/<parent\s+link="([^"]+)"/)?.[1],
        child: body.match(/<child\s+link="([^"]+)"/)?.[1],
        position: vec(body.match(/<origin[^>]*xyz="([^"]+)"/)?.[1]),
        rpy: vec(body.match(/<origin[^>]*rpy="([^"]+)"/)?.[1]),
        axis: vec(body.match(/<axis[^>]*xyz="([^"]+)"/)?.[1] || '0 0 1'),
      };
    });
  const byChild = Object.fromEntries(joints.map(j => [j.child, j]));
  return (link, jointValues) => {
    const chain = [];
    while (link !== 'base_link' && byChild[link]) {
      const joint = byChild[link];
      chain.unshift(joint);
      link = joint.parent;
    }
    assert.equal(link, 'base_link', 'FK target link not connected to the base');
    let position = [0, 0, 0];
    let basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const transform = v => v.map(
      (_, i) => basis[0][i] * v[0] + basis[1][i] * v[1] + basis[2][i] * v[2]
    );
    for (const joint of chain) {
      position = add(position, transform(joint.position));
      const rotations = [
        [[1, 0, 0], joint.rpy[0]],
        [[0, 1, 0], joint.rpy[1]],
        [[0, 0, 1], joint.rpy[2]],
        [joint.axis, jointValues[joint.name] || 0],
      ];
      for (const [axis, angle] of rotations) {
        if (angle) {
          const worldAxis = transform(axis);
          basis = basis.map(col => rotate(col, worldAxis, angle));
        }
      }
    }
    return position;
  };
}

test('OLI and LUNA wave places hand near right side of head with upward-bent forearm', () => {
  for (const id of ['oli', 'luna']) {
    const xml = readFileSync(new URL(id + '/urdf/' + id + '.urdf', root), 'utf8');
    const fk = modelFK(xml);
    for (const time of [2.25, 3.0, 3.5, 4.0]) {
      const { joints } = sampleHumanoidMotion(id, 'greet', time);
      const head = fk('head_pitch_link', joints);
      const shoulder = fk('right_shoulder_pitch_link', joints);
      const elbow = fk('right_elbow_link', joints);
      const hand = fk('right_hand_contact', joints);
      const handToHead = Math.hypot(...hand.map((x, i) => x - head[i]));
      const upForearm = hand[2] - elbow[2];
      assert.ok(upForearm > .14, id + ': forearm not pointing upward at t=' + time);
      assert.ok(hand[2] > shoulder[2] + .12, id + ': hand not above shoulder');
      assert.ok(hand[2] > head[2] + .065, id + ': hand not beside upper head');
      assert.ok(hand[1] < head[1] - .18, id + ': arm crossed to wrong side');
      assert.ok(handToHead < .48, id + ': hand too far from head: ' + handToHead);
      assert.ok(joints.right_elbow_joint < -1.7, id + ': elbow was not bent');
    }
  }
});

test('whole arm lowers to its original rest pose at each wave loop boundary', () => {
  for (const id of ['oli', 'luna']) {
    const ready = sampleHumanoidMotion(id, 'greet', 0);
    const end = sampleHumanoidMotion(id, 'greet', 5.99999);
    for (const joint of Object.keys(ready.joints)) {
      assert.ok(
        Math.abs(ready.joints[joint] - end.joints[joint]) < .0001,
        id + '/' + joint + ': wave loop discontinuity',
      );
    }
  }
});
