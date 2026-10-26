// Versioned robot registry. Large licensed Unitree meshes are installed locally
// by tools/install_unitree_models.py; browser never silently uses fake substitutes.
export const ROBOTS = [
  {
    id: 'magicdog', name: 'MagicDog', brand: 'MagicLab',
    category: 'Quadruped', dof: '12 DOF', format: 'URDF + OBJ',
    index: '01', subtitle: 'The signature quadruped of our motion studio.',
    description: 'A detailed quadruped platform visualized with the original MagicLab geometry and smooth browser-only foot-space motions.',
    urdf: 'magicdog/urdf/magicdog_repaint.urdf', ready: null, assetKind: 'OBJ + MTL',
    groundHeight: 0.325, cameraDistance: 2.25,
  },
  {
    id: 'go2', name: 'Go2', brand: 'Unitree Robotics',
    category: 'Quadruped', dof: '12 DOF', format: 'URDF + DAE',
    index: '02', subtitle: 'Agile quadruped exploration.',
    description: 'Unitree Go2 from its official public ROS model. Browser motions are illustrative and are not imported from the real robot controller.',
    urdf: 'go2/urdf/go2.urdf', ready: 'go2/meshes/asset-ready.txt',
    assetKind: 'Collada DAE', groundHeight: 0.34, cameraDistance: 2.25,
  },
  {
    id: 'a1', name: 'A1', brand: 'Unitree Robotics',
    category: 'Quadruped', dof: '12 DOF', format: 'URDF + DAE',
    index: '03', subtitle: 'Compact quadruped research platform.',
    description: 'Unitree A1 from its official public ROS model. Browser motions are analytical previews rather than physical locomotion policies.',
    urdf: 'a1/urdf/a1.urdf', ready: 'a1/meshes/asset-ready.txt',
    assetKind: 'Collada DAE', groundHeight: 0.32, cameraDistance: 2.2,
  },
];
export const ROBOT_BY_ID = Object.fromEntries(ROBOTS.map(robot => [robot.id, robot]));
