import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUMANOID_MOTIONS, sampleHumanoidMotion, applyHumanoidMotion } from '../src/humanoidMotions.js';

const root = new URL('../../models/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('limx_assets.json', root), 'utf8'));

function parseJoints(urdf) {
  const limits = {};
  for (const match of urdf.matchAll(/<joint\s+name="([^"]+)"\s+type="revolute"[^>]*>([\s\S]*?)<\/joint>/g)) {
    const min = match[2].match(/lower="([^"]+)"/);
    const max = match[2].match(/upper="([^"]+)"/);
    assert.ok(min && max, 'No joint limits: ' + match[1]);
    limits[match[1]] = [Number(min[1]), Number(max[1])];
  }
  return limits;
}

function maxPoseDiff(a, b) {
  let max = 0;
  for (const name of Object.keys(a.joints)) max = Math.max(max, Math.abs(a.joints[name] - b.joints[name]));
  for (const name of Object.keys(a.body)) max = Math.max(max, Math.abs(a.body[name] - b.body[name]));
  return max;
}

test('official LimX model manifests cover every visual mesh and preserve pinned provenance', () => {
  for (const robotId of ['oli', 'luna']) {
    const urdf = readFileSync(new URL(robotId + '/urdf/' + robotId + '.urdf', root), 'utf8');
    const entry = manifest.robots[robotId];
    assert.ok(entry.commit.match(/^[a-f0-9]{40}$/));
    const required = new Set();
    for (const visual of urdf.matchAll(/<visual(?:\s[^>]*)?>([\s\S]*?)<\/visual>/g)) {
      for (const mesh of visual[1].matchAll(/<mesh\s+filename="([^"]+\.STL)"/g)) {
        assert.ok(mesh[1].startsWith('../meshes/'), 'Unconverted package URI');
        required.add(mesh[1].replace('../meshes/', ''));
      }
    }
    assert.ok(required.size > 20, 'Expected detailed manufacturer geometry');
    assert.deepEqual(new Set(entry.files.map(x => x.name)), required);
    for (const asset of entry.files) {
      assert.match(asset.gitBlobSha, /^[a-f0-9]{40}$/);
      assert.ok(asset.bytes > 0);
    }
  }
});

test('OLI and LUNA have robot-specific valid, cyclic joint previews', () => {
  for (const robotId of ['oli','luna']) {
    const xml = readFileSync(new URL(robotId + '/urdf/' + robotId + '.urdf', root), 'utf8');
    const jointLimits = parseJoints(xml);
    const expectedCount = robotId === 'oli' ? 31 : 27;
    assert.equal(Object.keys(jointLimits).length, expectedCount);
    for (const motion of HUMANOID_MOTIONS) {
      for (let frame = 0; frame <= 300; frame++) {
        const pose = sampleHumanoidMotion(robotId, motion.id, motion.duration * frame / 300);
        assert.equal(Object.keys(pose.joints).length, expectedCount);
        for (const [joint, angle] of Object.entries(pose.joints)) {
          const limits = jointLimits[joint];
          assert.ok(limits, robotId + ': missing URDF joint ' + joint);
          assert.ok(Number.isFinite(angle));
          assert.ok(angle >= limits[0] - .00001, robotId + ': ' + joint + ' below lower limit');
          assert.ok(angle <= limits[1] + .00001, robotId + ': ' + joint + ' above upper limit');
        }
      }
      const start = sampleHumanoidMotion(robotId, motion.id, 0);
      const end = sampleHumanoidMotion(robotId, motion.id, motion.duration - .00001);
      assert.ok(maxPoseDiff(start, end) < .001, robotId + '/' + motion.id + ' should loop without snaps');
    }
  }
});

test('both humanoids use a separate wave animation with an animated right arm', () => {
  for (const robotId of ['oli','luna']) {
    const atRest = sampleHumanoidMotion(robotId,'greet',0);
    const midWave = sampleHumanoidMotion(robotId,'greet',2);
    assert.ok(midWave.joints.right_shoulder_roll_joint < atRest.joints.right_shoulder_roll_joint - .7);
    assert.ok(midWave.joints.right_elbow_joint < atRest.joints.right_elbow_joint - .5);
  }
});

test('humanoid application writes exactly the manufacturer joints, blends switches', () => {
  const known = parseJoints(readFileSync(new URL('oli/urdf/oli.urdf', root), 'utf8'));
  const values = {};
  const robot = {
    joints: Object.fromEntries(Object.keys(known).map(k=>[k, {}])),
    setJointValue(name, value) { values[name] = value; },
  };
  const stage = { position: {y:0}, rotation: {set(...args){this.values = args}} };
  applyHumanoidMotion(robot,stage,'oli','idle',0,{instant:true});
  const a = values.right_shoulder_roll_joint;
  applyHumanoidMotion(robot,stage,'oli','greet',2,{deltaTime:1/60});
  assert.ok(Math.abs(values.right_shoulder_roll_joint - a) < .01);
  for (let frame=0; frame<28; frame++) applyHumanoidMotion(robot,stage,'oli','greet',2,{deltaTime:1/60});
  assert.equal(Object.keys(values).length,31);
});
