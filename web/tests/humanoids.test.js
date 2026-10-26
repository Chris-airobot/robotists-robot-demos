import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUMANOID_MOTIONS, sampleHumanoidMotion, applyHumanoidMotion } from '../src/humanoidMotions.js';
import { getHumanoidStlStyle } from '../src/robotMaterials.js';
import { ROBOTS } from '../src/robots.js';

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
    // The shoulder alone does not determine hand height. On LUNA the
    // elbow folds deeply to point the FOREARM upwards; OLI uses more
    // shoulder abduction. Both poses must strongly bend the elbow.
    assert.ok(midWave.joints.right_elbow_joint < atRest.joints.right_elbow_joint - 1.0);
    assert.ok(Math.abs(midWave.joints.right_shoulder_roll_joint - atRest.joints.right_shoulder_roll_joint) > .4);
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

test('public robot selector excludes the unavailable G1 placeholder', () => {
  assert.deepEqual(ROBOTS.map(robot => robot.id), ['magicdog','go2','a1','oli','luna']);
  assert.equal(new Set(ROBOTS.map(robot => robot.index)).size, ROBOTS.length);
});

test('every LimX visual STL gets a presentation material; no non-LimX files are recolored', () => {
  assert.equal(getHumanoidStlStyle('https://localhost:5173/magicdog/meshes/base.obj'), null);
  assert.equal(getHumanoidStlStyle('https://localhost:5173/go2/meshes/base.dae'), null);
  assert.equal(getHumanoidStlStyle('/g1/meshes/base_link.stl'), null);
  for (const robotId of ['oli', 'luna']) {
    const files = manifest.robots[robotId].files;
    const styles = files.map(file => {
      const style = getHumanoidStlStyle('http://127.0.0.1:5173/' + robotId + '/meshes/' + file.name);
      assert.ok(style, robotId + '/' + file.name + ' has no style');
      assert.match(style.color, /^#[0-9a-f]{6}$/i);
      assert.ok(style.roughness > 0 && style.roughness <= 1);
      assert.ok(style.metalness >= 0 && style.metalness <= 1);
      return style;
    });
    const unique = new Set(styles.map(x => x.color));
    assert.ok(unique.size >= 3, robotId + ' palette is still monochrome');
    assert.notEqual(
      getHumanoidStlStyle('/' + robotId + '/meshes/base_link.STL').color,
      getHumanoidStlStyle('/' + robotId + '/meshes/head_pitch_link.STL').color,
      robotId + ' head visor and body must contrast',
    );
  }
});

test('URDFLoader dot-segment URLs match humanoid material palette after normalization', () => {
  // URDFLoader passes a syntactic path from workingPath + "../meshes/...".
  // It is not normalized until the browser performs a fetch.
  for (const id of ['oli','luna']) {
    for (const file of manifest.robots[id].files) {
      const direct = getHumanoidStlStyle('/' + id + '/meshes/' + file.name);
      const unnormalized = getHumanoidStlStyle('/' + id + '/urdf/../meshes/' + file.name);
      const full = getHumanoidStlStyle('http://127.0.0.1:5173/' + id + '/urdf/../meshes/' + file.name + '?cache=1');
      assert.ok(direct, id + '/' + file.name + ' has no material style');
      assert.deepEqual(unnormalized, direct, id + '/' + file.name + ' URDF relative path lost its style');
      assert.deepEqual(full, direct, id + '/' + file.name + ' absolute URL lost its style');
    }
  }
});

test('squat folds both legs symmetrically and lowers the pelvis without twisting planted feet', () => {
  for (const id of ['oli', 'luna']) {
    const start = sampleHumanoidMotion(id, 'squat', 0);
    const bottom = sampleHumanoidMotion(id, 'squat', 2.2);
    assert.ok(bottom.body.height < start.body.height - .04, id + ': pelvis did not descend');
    assert.equal(bottom.body.yaw, 0, id + ': pelvis must not spin on planted feet');
    assert.equal(bottom.body.roll, 0, id + ': pelvis must not lean on planted feet');
    for (const side of ['left','right']) {
      const knee = bottom.joints[side + '_knee_joint'];
      const hip = bottom.joints[side + '_hip_pitch_joint'];
      const ankle = bottom.joints[side + '_ankle_pitch_joint'];
      assert.ok(knee > start.joints[side + '_knee_joint'] + .45);
      assert.ok(Math.abs(hip + knee + ankle) < 1e-8, 'nominal foot pitch is not compensated');
      assert.ok(Math.abs(bottom.joints.left_knee_joint - bottom.joints.right_knee_joint) < 1e-9);
    }
  }
});

test('torso-turn and look-around keep the pelvis and all leg joints still', () => {
  for (const id of ['oli', 'luna']) {
    const atRest = sampleHumanoidMotion(id, 'idle', 0);
    for (const motion of ['turn','inspect','greet','reach']) {
      const duration = HUMANOID_MOTIONS.find(x => x.id === motion).duration;
      for (const t of [1.8,2.6,3.8,5]) {
        const pose = sampleHumanoidMotion(id, motion, Math.min(t, duration));
        assert.equal(pose.body.height, atRest.body.height);
        assert.equal(pose.body.yaw, 0);
        assert.equal(pose.body.roll, 0);
        for (const side of ['left','right']) {
          for (const joint of ['hip_pitch','hip_roll','hip_yaw','knee','ankle_pitch','ankle_roll']) {
            assert.equal(
              pose.joints[side + '_' + joint + '_joint'],
              atRest.joints[side + '_' + joint + '_joint'],
              id + '/' + motion + ' moved a planted leg ' + side + '_' + joint,
            );
          }
        }
      }
    }
  }
});

test('authored humanoid motion envelopes are continuous with bounded per-frame changes', () => {
  for (const id of ['oli','luna']) {
    for (const motion of HUMANOID_MOTIONS) {
      let prev = sampleHumanoidMotion(id, motion.id, 0);
      for (let frame = 1; frame <= motion.duration * 120; frame++) {
        const pose = sampleHumanoidMotion(id, motion.id, frame / 120);
        assert.ok(
          maxPoseDiff(prev, pose) < .05,
          id + '/' + motion.id + ' abrupt change at frame ' + frame,
        );
        prev = pose;
      }
    }
  }
});

test('walking uses opposite leg swing phases while preserving stance-foot height', () => {
  for (const [id, thigh, calf] of [
    ['oli', .467, .385],
    ['luna', .3608, .417],
  ]) {
    // The walking controller uses a slightly bent knee (~0.40rad) to avoid
    // the near-extension IK singularity. Root height is adjusted to keep
    // the resulting ground contact at the same absolute world height.
    const neutralZ = -thigh * Math.cos(-.12) - calf * Math.cos(.12);
    const walkingZ = -thigh * Math.cos(-.20) - calf * Math.cos(.20);
    const idleHeight = sampleHumanoidMotion(id, 'idle', 0).body.height;
    let maxStanceDrift = 0;
    let maxSwingClearance = 0;
    let sampledLegAsymmetry = false;
    for (let frame = 0; frame < 6 * 120; frame++) {
      const t = frame / 120;
      const p = sampleHumanoidMotion(id, 'walk', t);
      assert.ok(
        Math.abs(p.body.height + walkingZ - (idleHeight + neutralZ)) < 1e-6,
        id + ': walking pelvis height should preserve absolute stance floor',
      );
      for (const [side, offset] of [['left', 0], ['right', .5]]) {
        const phase = (t * 3 / 6 + offset) % 1;
        const hip = p.joints[side + '_hip_pitch_joint'];
        const knee = p.joints[side + '_knee_joint'];
        const ankle = p.joints[side + '_ankle_pitch_joint'];
        const footZ = -thigh * Math.cos(hip) - calf * Math.cos(hip + knee);
        if (phase < .62) {
          maxStanceDrift = Math.max(maxStanceDrift, Math.abs(footZ - walkingZ));
        } else {
          maxSwingClearance = Math.max(maxSwingClearance, footZ - walkingZ);
        }
        assert.ok(Math.abs(hip + knee + ankle) < 1e-8, id + ' lost foot pitch compensation');
      }
      if (Math.abs(p.joints.left_knee_joint - p.joints.right_knee_joint) > .02) sampledLegAsymmetry = true;
    }
    assert.ok(maxStanceDrift < .0005, id + ': sagittal stance foot is not height-locked');
    assert.ok(maxSwingClearance > .025, id + ': swing feet do not lift');
    assert.ok(sampledLegAsymmetry, id + ': feet are not alternating');
  }
});

test('wave folds the elbow deeply rather than relying on horizontal shoulder roll', () => {
  for (const id of ['oli','luna']) {
    const ready = sampleHumanoidMotion(id, 'greet', 0);
    const raised = sampleHumanoidMotion(id, 'greet', 3);
    assert.ok(raised.joints.right_elbow_joint < ready.joints.right_elbow_joint - 1.0);
    assert.ok(raised.joints.right_elbow_joint < -1.7);
    assert.ok(Math.abs(raised.joints.right_wrist_yaw_joint) < .7);
    if (id === 'oli') assert.ok(Math.abs(raised.joints.right_wrist_pitch_joint) <= .3);
  }
});

test('walking preview uses slow three-cycle cadence without angular frame spikes', () => {
  for (const id of ['oli','luna']) {
    const duration = HUMANOID_MOTIONS.find(m => m.id === 'walk').duration;
    assert.equal(duration, 6);
    const dt = 1 / 60;
    let previous = sampleHumanoidMotion(id, 'walk', 0);
    let largestStep = 0;
    for (let frame = 1; frame <= duration / dt; frame++) {
      const pose = sampleHumanoidMotion(id, 'walk', frame * dt);
      for (const joint of Object.keys(pose.joints)) {
        const step = Math.abs(pose.joints[joint] - previous.joints[joint]);
        largestStep = Math.max(largestStep, step);
      }
      previous = pose;
    }
    assert.ok(largestStep < .025, id + ': walking has sudden joint jumps at 60 Hz (' + largestStep + ')');
    const start = sampleHumanoidMotion(id, 'walk', 0);
    const wrap = sampleHumanoidMotion(id, 'walk', duration - .000001);
    assert.ok(maxPoseDiff(start, wrap) < .0001, id + ': loop boundary not smooth');
  }
});
