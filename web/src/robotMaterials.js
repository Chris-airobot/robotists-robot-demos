/**
 * Lightweight LimX humanoid presentation palette for manufacturer STL meshes.
 *
 * OLI and LUNA ROS URDFs ship monochrome/untextured STL geometry, not a
 * textured commercial product model. These link-level colors approximate the
 * light silver/satin shell and dark joint/visor contrast visible in LimX's
 * official product photos. They do not claim per-surface visual accuracy.
 *
 * Keep material styling isolated to these two robot IDs. MagicDog, Go2 and A1
 * retain their existing loaders and materials.
 */
const PALETTES = {
  oli: {
    shell:   { color: '#e0e5e9', metalness: 0.40, roughness: 0.47 },
    silver:  { color: '#bac4cc', metalness: 0.58, roughness: 0.39 },
    dark:    { color: '#303842', metalness: 0.23, roughness: 0.55 },
    joint:   { color: '#69737e', metalness: 0.50, roughness: 0.48 },
    visor:   { color: '#161d27', metalness: 0.25, roughness: 0.25 },
  },
  luna: {
    shell:   { color: '#e4e8ec', metalness: 0.19, roughness: 0.65 },
    silver:  { color: '#bcc5cf', metalness: 0.38, roughness: 0.54 },
    dark:    { color: '#4f5a66', metalness: 0.24, roughness: 0.63 },
    joint:   { color: '#717b86', metalness: 0.32, roughness: 0.55 },
    visor:   { color: '#161b26', metalness: 0.18, roughness: 0.28 },
  },
};

/** Return a per-mesh palette entry, or null for non-LimX mesh URLs. */
export function getHumanoidStlStyle(meshUrl) {
  const matched = String(meshUrl).match(/(?:^|\/)(oli|luna)\/meshes\/([^/?#]+)\.stl(?:[?#]|$)/i);
  if (!matched) return null;
  const robotId = matched[1].toLowerCase();
  const part = matched[2].toLowerCase();
  const palette = PALETTES[robotId];

  // The head pitch mesh corresponds to the complete head/visor assembly.
  // STL does not distinguish the black screen from its light housing; tint
  // the whole mesh dark rather than fabricate a separate display geometry.
  if (part === 'head_pitch_link' || part === 'neck_pitch_link') return palette.visor;
  if (part === 'neck_yaw_link' || part === 'head_yaw_link') return palette.dark;

  if (part === 'd435_link' || part.includes('_camera')) return palette.dark;
  if (part.includes('_wrist_')) return palette.dark;
  if (part.includes('_ankle_roll_')) return palette.dark; // feet

  if (part.includes('_elbow_') || part.includes('_hip_yaw_')) return palette.joint;
  if (part.includes('_shoulder_roll_') || part.includes('_shoulder_yaw_')) return palette.joint;
  if (part.includes('_ankle_pitch_')) return palette.silver;
  if (part.includes('_knee_')) return palette.silver;
  if (part.includes('_hip_roll_')) return palette.silver;

  if (part.includes('_achilles_') || part.includes('_rod_')) return palette.silver;
  if (part.startsWith('waist_') && part !== 'waist_pitch_link') return palette.silver;

  return palette.shell;
}
