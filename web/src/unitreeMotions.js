/**
 * Browser-only gait previews for original Unitree Go2 and A1 URDF models.
 * Adapted from Robotists' MagicDog foot-space animation, with each model's
 * sagittal link lengths and documented joint limits. Not a hardware policy.
 */
const TAU = Math.PI * 2;
const LEGS = ['FL', 'FR', 'RL', 'RR'];
const PHASE = { FL: 0, RR: 0, FR: .5, RL: .5 };
const PROFILES = {
  go2: {
    thigh: .213, calf: .213, rest: [0, .82, -1.54],
    height: .34, knee: [-2.7227, -.83776],
    thighLimits: [-1.5708, 3.4907], hipLimits: [-1.0472, 1.0472],
  },
  a1: {
    thigh: .2, calf: .2, rest: [0, .82, -1.50],
    height: .32, knee: [-2.696534, -.916298],
    thighLimits: [-1.047198, 4.18879], hipLimits: [-.802851, .802851],
  },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = x => { const t=clamp(x,0,1); return t*t*t*(t*(t*6-15)+10); };
const blend = (a,b,t) => a+(b-a)*t;
const stateByRobot = new WeakMap();

function footHome(config) {
  const [, thigh, knee] = config.rest;
  return {
    x: -config.thigh * Math.sin(thigh) - config.calf * Math.sin(thigh + knee),
    z: -config.thigh * Math.cos(thigh) - config.calf * Math.cos(thigh + knee),
  };
}

function ik(x,z,cfg) {
  const r2 = clamp(x*x+z*z,.0001,(cfg.thigh+cfg.calf-.001)**2);
  const cosK = clamp((r2-cfg.thigh**2-cfg.calf**2)/(2*cfg.thigh*cfg.calf),-1,1);
  const knee = -Math.acos(cosK);
  const thigh = Math.atan2(-x,-z) - Math.atan2(
    cfg.calf*Math.sin(knee),cfg.thigh+cfg.calf*Math.cos(knee)
  );
  return [clamp(thigh,...cfg.thighLimits),clamp(knee,...cfg.knee)];
}

function step(phase,stride,lift) {
  const p=((phase%1)+1)%1;
  if(p<.58) return {x:stride*(.5-smooth(p/.58)),z:0};
  const u=(p-.58)/.42;
  return {x:stride*(smooth(u)-.5),z:lift*Math.sin(Math.PI*u)**2};
}

function neutralPose(cfg) {
  return {
    body:{height:cfg.height,yaw:0,roll:0,pitch:0},
    joints:Object.fromEntries(LEGS.map(leg=>[leg,[...cfg.rest]])),
  };
}

export function sampleUnitreeMotion(robotId,id,seconds) {
  const cfg=PROFILES[robotId]||PROFILES.go2;
  const duration=id==='idle'?8:id==='greet'?5:6;
  const t=((seconds%duration)+duration)%duration;
  const u=t/duration;
  const pose=neutralPose(cfg);
  if(id==='idle'){
    pose.body.height+=.0015*Math.sin(TAU*t/4);
    pose.body.roll=.0025*Math.sin(TAU*t/8);
    return pose;
  }
  if(id==='walk'||id==='turn'){
    const turning=id==='turn';
    if(turning) pose.body.yaw=.38*Math.sin(TAU*u);
    for(const leg of LEGS){
      const phase=(1.5*t+PHASE[leg])%1;
      const sign=leg.endsWith('L')?1:-1;
      const stride=turning? sign*.06*Math.cos(TAU*u):.085;
      const off=step(phase,stride,turning?.026:.035);
      const home=footHome(cfg);
      const [thigh,knee]=ik(home.x+off.x,home.z+off.z,cfg);
      pose.joints[leg]=[
        clamp((turning?.01:.014)*Math.sin(TAU*phase),...cfg.hipLimits),
        thigh,knee
      ];
    }
    pose.body.height+=(turning?.002:.003)*Math.cos(TAU*3*t);
    pose.body.pitch=.006*Math.sin(TAU*1.5*t);
    pose.body.roll=.004*Math.sin(TAU*1.5*t);
    return pose;
  }
  if(id==='greet'){
    const lift=smooth((t-.5)/.95)*(1-smooth((t-3.5)/.95));
    const home=footHome(cfg);
    const [thigh,knee]=ik(home.x+.065*lift,home.z+.08*lift,cfg);
    pose.joints.FR=[-.055*lift,thigh,knee];
    pose.body.pitch=-.012*lift;
    return pose;
  }
  const w=TAU*u;
  pose.body.yaw=.135*Math.sin(w);
  pose.body.pitch=-.02*Math.sin(w);
  pose.body.roll=.006*Math.sin(w);
  for(const leg of LEGS){
    pose.joints[leg][1]+=.02*Math.sin(w);
    pose.joints[leg][2]-=.012*Math.sin(w);
  }
  return pose;
}

function mix(a,b,t) {
  return {
    body:Object.fromEntries(Object.keys(a.body).map(k=>[k,blend(a.body[k],b.body[k],t)])),
    joints:Object.fromEntries(LEGS.map(l=>[l,a.joints[l].map((q,i)=>blend(q,b.joints[l][i],t))])),
  };
}

export function applyUnitreeMotion(robot,stage,robotId,id,time,options={}) {
  if(!robot || !stage) return;
  const target=sampleUnitreeMotion(robotId,id,time);
  const old=stateByRobot.get(robot);
  let transition=old?.transition||null;
  if(!old || options.instant) transition=null;
  else if(old.id!==id) transition={start:old.pose,elapsed:0};
  let pose=target;
  if(transition){
    transition.elapsed=Math.min(.36,transition.elapsed+clamp(options.deltaTime??1/60,0,.05));
    pose=mix(transition.start,target,smooth(transition.elapsed/.36));
    if(transition.elapsed>=.36) transition=null;
  }
  stage.position.y=pose.body.height;
  stage.rotation.set(pose.body.roll,pose.body.yaw,pose.body.pitch,'YXZ');
  for(const leg of LEGS){
    const [hip,thigh,calf]=pose.joints[leg];
    robot.setJointValue(leg+'_hip_joint',hip);
    robot.setJointValue(leg+'_thigh_joint',thigh);
    robot.setJointValue(leg+'_calf_joint',calf);
  }
  stateByRobot.set(robot,{id,pose,transition});
}
