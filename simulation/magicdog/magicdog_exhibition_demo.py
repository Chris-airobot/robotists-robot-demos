import argparse
import math
import time
from pathlib import Path

import gymnasium as gym
import torch

from isaaclab.app import AppLauncher


parser = argparse.ArgumentParser()
parser.add_argument("--robot_height", type=float, default=0.34)
parser.add_argument("--gift_z_offset", type=float, default=0.115)
parser.add_argument("--record", action="store_true", help="Record the viewport to an MP4")
parser.add_argument("--record_path", default="~/Videos/magicdog_exhibition.mp4")
parser.add_argument("--record_fps", type=int, default=60)
parser.add_argument("--record_width", type=int, default=1920)
parser.add_argument("--record_height", type=int, default=1080)

AppLauncher.add_app_launcher_args(parser)
args = parser.parse_args()

if args.record:
    if args.record_fps <= 0:
        parser.error("--record_fps must be positive")
    if args.record_width <= 0 or args.record_height <= 0:
        parser.error("record width and height must be positive")
    if args.record_width % 2 or args.record_height % 2:
        parser.error("H.264 record width and height must be even")
    if Path(args.record_path).suffix.lower() != ".mp4":
        parser.error("--record_path must end in .mp4")

app_launcher = AppLauncher(args)
simulation_app = app_launcher.app
active_capture = None


# Real Isaac Sim human animation support
from isaacsim.core.utils.extensions import enable_extension

# Isaac Sim 5.1 human animation stack.
# Enable the bundle extensions so USD animation schemas are fully registered
# before ApplyAnimationGraphAPICommand is used.
HUMAN_EXTENSIONS = [
    "omni.anim.graph.bundle",
    "omni.anim.navigation.bundle",
    "omni.anim.retarget.bundle",
    "omni.anim.people",
    "omni.kit.scripting",
    "isaacsim.replicator.agent.core",
]

for ext in HUMAN_EXTENSIONS:
    print(f"[EXT] enabling {ext}")
    enable_extension(ext)
    simulation_app.update()

if args.record:
    # Video encoding is an optional dependency of the viewport capture extension.
    for ext in ("omni.videoencoding", "omni.kit.capture.viewport"):
        print(f"[EXT] enabling {ext}")
        enable_extension(ext)
        simulation_app.update()

# A few extra Kit updates allow extension/plugin/schema registration to settle.
for _ in range(5):
    simulation_app.update()


import isaaclab.sim as sim_utils
import robot_lab.tasks  # noqa: F401

from isaaclab_tasks.utils import parse_env_cfg
from isaaclab.utils.math import quat_from_euler_xyz
from pxr import Gf, Sdf, UsdGeom
from isaacsim.storage.native import get_assets_root_path

import carb
import omni.kit.commands
import omni.anim.graph.core as ag


TASK = "RobotLab-Isaac-Velocity-Flat-MagicLab-Dog-v0"


# ================================================================
# Helpers
# ================================================================

def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def lerp(a, b, u):
    return a + (b - a) * u


def motion_window(t, start, end, ramp=0.4):
    if t < start or t > end:
        return 0.0

    a = min(1.0, (t - start) / ramp)
    b = min(1.0, (end - t) / ramp)

    return max(0.0, min(a, b))


def material(
    color,
    metallic=0.0,
    roughness=0.5,
    emissive=(0.0, 0.0, 0.0),
):
    return sim_utils.materials.PreviewSurfaceCfg(
        diffuse_color=color,
        metallic=metallic,
        roughness=roughness,
        emissive_color=emissive,
    )


def spawn_box(path, position, size, color,
              metallic=0.0, emissive=(0.0, 0.0, 0.0)):

    cfg = sim_utils.CuboidCfg(
        size=size,
        visual_material=material(
            color,
            metallic=metallic,
            emissive=emissive,
        ),
    )

    return cfg.func(
        path,
        cfg,
        translation=position,
    )


def spawn_cylinder(path, position, radius, height, axis, color):

    cfg = sim_utils.CylinderCfg(
        radius=radius,
        height=height,
        axis=axis,
        visual_material=material(color),
    )

    return cfg.func(
        path,
        cfg,
        translation=position,
    )


def spawn_sphere(path, position, radius, color):

    cfg = sim_utils.SphereCfg(
        radius=radius,
        visual_material=material(color),
    )

    return cfg.func(
        path,
        cfg,
        translation=position,
    )


def create_movable_root(stage, path):
    root = UsdGeom.Xform.Define(stage, path)
    op = root.AddTransformOp()
    return root, op


def set_root_pose(op, x, y, z, yaw):
    m = Gf.Matrix4d(1.0)

    rotation = Gf.Rotation(
        Gf.Vec3d(0.0, 0.0, 1.0),
        math.degrees(yaw),
    )

    m.SetRotate(rotation)
    m.SetTranslateOnly(Gf.Vec3d(x, y, z))

    op.Set(m)


# ================================================================
# Isaac Sim animated human
# ================================================================

def find_skel_root(prim):
    if not prim or not prim.IsValid():
        return None

    if prim.GetTypeName() == "SkelRoot":
        return prim

    for child in prim.GetAllChildren():
        result = find_skel_root(child)
        if result is not None:
            return result

    return None


def setup_human_animation(stage, sim):
    assets_root = get_assets_root_path()

    if not assets_root:
        raise RuntimeError("Could not resolve Isaac Sim assets root")

    # ------------------------------------------------------------
    # Biped animation graph supplied by Isaac Sim
    # ------------------------------------------------------------

    biped_path = assets_root + "/Isaac/People/Characters/Biped_Setup.usd"

    biped_prim = stage.DefinePrim(
        "/World/Characters/Biped_Setup",
        "Xform",
    )

    biped_prim.GetReferences().AddReference(biped_path)

    print("[HUMAN] Biped setup:", biped_path)

    # Give USD references time to resolve.
    for _ in range(3):
        sim.step(render=True)

    # Biped_Setup.usd contains its own demo mannequin.
    # We only need its AnimationGraph, so hide the demo geometry.
    demo_paths = [
        "/World/Characters/Biped_Setup/biped_demo_meters",
        "/World/Characters/Biped_Setup/Character",
    ]

    for demo_path in demo_paths:
        demo_prim = stage.GetPrimAtPath(demo_path)

        if demo_prim.IsValid():
            try:
                UsdGeom.Imageable(demo_prim).MakeInvisible()
                print("[HUMAN] Hidden Biped_Setup demo asset:", demo_path)
            except Exception:
                pass

    # ------------------------------------------------------------
    # Find the actual SkelRoot inside our police character
    # ------------------------------------------------------------

    visitor = stage.GetPrimAtPath(
        "/World/Exhibition/Visitor/Character"
    )

    skel_root = find_skel_root(visitor)

    if skel_root is None:
        raise RuntimeError(
            "Could not find SkelRoot inside Isaac human asset"
        )

    skel_path = skel_root.GetPrimPath()

    print("[HUMAN] SkelRoot:", skel_path)

    graph_prim = stage.GetPrimAtPath(
        "/World/Characters/Biped_Setup/"
        "CharacterAnimation/AnimationGraph"
    )

    if not graph_prim.IsValid():
        raise RuntimeError(
            "Biped_Setup AnimationGraph did not load"
        )

    # Remove any stale graph assignment.
    try:
        omni.kit.commands.execute(
            "RemoveAnimationGraphAPICommand",
            paths=[Sdf.Path(skel_path)],
        )
    except Exception:
        pass

    # Attach Isaac's real people animation graph.
    omni.kit.commands.execute(
        "ApplyAnimationGraphAPICommand",
        paths=[Sdf.Path(skel_path)],
        animation_graph_path=Sdf.Path(
            graph_prim.GetPrimPath()
        ),
    )

    # NVIDIA specifically notes that the stage should be stepped
    # after applying the graph before accessing the character.
    for _ in range(5):
        sim.step(render=True)

    character = ag.get_character(
        str(skel_path)
    )

    if character is None:
        raise RuntimeError(
            "Animation graph attached, but ag.get_character() failed"
        )

    # Start in a proper idle animation instead of T-pose.
    character.set_variable(
        "Walk",
        0.0,
    )

    character.set_variable(
        "Action",
        "Idle",
    )

    print("[HUMAN] Animation graph ready.")
    print("[HUMAN] Starting in Idle animation.")

    return character



# ================================================================
# Exhibition scene
# ================================================================

def create_exhibition_scene(stage):

    # Floor
    spawn_box(
        "/World/Exhibition/Floor",
        (1.8, 0.5, -0.035),
        (9.0, 6.0, 0.06),
        (0.16, 0.17, 0.18),
        metallic=0.05,
    )

    # Back wall
    spawn_box(
        "/World/Exhibition/BackWall",
        (2.0, 3.0, 1.5),
        (9.0, 0.12, 3.0),
        (0.28, 0.29, 0.31),
    )

    # Booth platform
    spawn_box(
        "/World/Exhibition/Booth/Platform",
        (4.05, 0.65, -0.045),
        (2.1, 2.1, 0.08),
        (0.22, 0.23, 0.25),
    )

    # Booth rear panel
    spawn_box(
        "/World/Exhibition/Booth/RearPanel",
        (4.55, 1.55, 1.15),
        (1.4, 0.12, 2.3),
        (0.08, 0.09, 0.11),
        metallic=0.3,
    )

    # Main display
    spawn_box(
        "/World/Exhibition/Booth/Display",
        (4.55, 1.475, 1.35),
        (1.05, 0.035, 0.65),
        (0.04, 0.10, 0.14),
        emissive=(0.02, 0.25, 0.40),
    )

    # Pedestal
    spawn_box(
        "/World/Exhibition/Booth/Pedestal",
        (4.05, 0.95, 0.48),
        (0.55, 0.55, 0.96),
        (0.65, 0.66, 0.67),
        metallic=0.25,
    )

    # Decorative side light bars
    for i, x in enumerate([3.35, 4.75]):
        spawn_box(
            f"/World/Exhibition/Booth/LightBar{i}",
            (x, 1.48, 1.1),
            (0.035, 0.035, 1.8),
            (0.08, 0.45, 0.70),
            emissive=(0.05, 0.40, 0.70),
        )

    # Bollards / route markers
    for i, y in enumerate([-0.45, 1.45]):
        spawn_cylinder(
            f"/World/Exhibition/Bollard{i}",
            (2.25, y, 0.35),
            radius=0.045,
            height=0.70,
            axis="Z",
            color=(0.75, 0.55, 0.05),
        )

    # Lighting
    dome_cfg = sim_utils.DomeLightCfg(
        intensity=700.0,
        color=(0.92, 0.95, 1.0),
        visible_in_primary_ray=False,
    )

    dome_cfg.func(
        "/World/Exhibition/DomeLight",
        dome_cfg,
    )

    # ============================================================
    # Real Isaac Sim human character
    # ============================================================

    visitor_root, visitor_op = create_movable_root(
        stage,
        "/World/Exhibition/Visitor",
    )

    assets_root = get_assets_root_path()

    # Isaac Sim 5.1 built-in rigged character.
    #
    # Using the police character first because its path is explicitly
    # documented and stable. We can swap the character later without
    # changing any of the motion/demo code.
    human_asset = (
        assets_root
        + "/Isaac/People/Characters/"
        + "original_male_adult_police_04/"
        + "male_adult_police_04.usd"
    )

    human_prim = stage.DefinePrim(
        "/World/Exhibition/Visitor/Character",
        "Xform",
    )

    human_prim.GetReferences().AddReference(
        human_asset
    )

    # Initial visitor position.
    set_root_pose(
        visitor_op,
        1.35,
        1.20,
        0.0,
        math.radians(-61.0),
    )

    print("[ASSET] Loading Isaac Sim human:")
    print(human_asset)

    # ============================================================
    # Gift box carried by MagicDog
    # ============================================================

    gift_root, gift_op = create_movable_root(
        stage,
        "/World/Exhibition/GiftCarrier",
    )

    # Small payload tray physically sitting on MagicDog's back.
    spawn_box(
        "/World/Exhibition/GiftCarrier/Tray",
        (0.0, 0.0, 0.0),
        (0.38, 0.28, 0.025),
        (0.08, 0.09, 0.10),
        metallic=0.65,
    )

    # Gift sits ON the tray rather than floating above the robot.
    spawn_box(
        "/World/Exhibition/GiftCarrier/Gift",
        (0.0, 0.0, 0.078),
        (0.24, 0.18, 0.13),
        (0.72, 0.10, 0.08),
        metallic=0.1,
    )

    # Ribbon across top
    spawn_box(
        "/World/Exhibition/GiftCarrier/RibbonX",
        (0.0, 0.0, 0.147),
        (0.26, 0.032, 0.012),
        (0.92, 0.76, 0.18),
        metallic=0.3,
    )

    spawn_box(
        "/World/Exhibition/GiftCarrier/RibbonY",
        (0.0, 0.0, 0.148),
        (0.032, 0.20, 0.014),
        (0.92, 0.76, 0.18),
        metallic=0.3,
    )

    return visitor_op, gift_op


# ================================================================
# Main
# ================================================================

def main():
    global active_capture

    env_cfg = parse_env_cfg(
        TASK,
        device=args.device,
        num_envs=1,
        use_fabric=True,
    )

    env_cfg.scene.num_envs = 1

    # This is a cinematic product animation.
    env_cfg.scene.robot.spawn.rigid_props.disable_gravity = True

    env_cfg.commands.base_velocity.debug_vis = False

    env = gym.make(
        TASK,
        cfg=env_cfg,
    )

    env.reset()

    base_env = env.unwrapped

    robot = base_env.scene["robot"]
    sim = base_env.sim
    device = base_env.device
    stage = sim.stage

    visitor_op, gift_op = create_exhibition_scene(stage)

    sim.step(render=True)

    # Real Isaac Sim human animation controller
    human_graph = setup_human_animation(
        stage,
        sim,
    )

    joint_id = {
        name: i
        for i, name in enumerate(robot.joint_names)
    }

    q_default = robot.data.default_joint_pos[0].clone()
    qd = torch.zeros_like(q_default)

    phase_offset = {
        "FL": 0.0,
        "RR": 0.0,
        "FR": math.pi,
        "RL": math.pi,
    }

    gait_frequency = 1.8

    start_time = time.perf_counter()

    messages = {
        "detected": False,
        "greet": False,
        "guide": False,
        "arrived": False,
        "gift": False,
    }

    human_started_walking = False
    human_stopped_walking = False

    visitor_x = 1.35
    visitor_y = 1.20

    human_follow_start = 14.25
    human_follow_timeout = 23.5
    # Stop on the floor with clearance from the booth platform's x=3.0 edge.
    human_destination = (2.70, 1.15, 0.0)

    # The working start pose (-61 degrees) visually faces MagicDog at
    # (-0.8, 0.0). Derive the character's model-forward offset from that
    # known alignment instead of guessing a cardinal-axis correction.
    visitor_facing_yaw = math.radians(-61.0)
    visitor_forward_yaw_offset = visitor_facing_yaw - math.atan2(
        0.0 - visitor_y,
        -0.8 - visitor_x,
    )
    previous_t = 0.0

    print("\n")
    print("==============================================")
    print(" MAGICDOG - INTERACTIVE EXHIBITION ASSISTANT")
    print("==============================================")
    print("0-3 s    Visitor waiting")
    print("3-7 s    MagicDog approaches visitor")
    print("7-10 s   Greeting / expressive bow")
    print("10-12 s  Turns toward exhibit")
    print("12-19 s  Guides visitor to booth")
    print("19-21 s  Turns back to visitor")
    print("21-26 s  Presents welcome gift")
    print("26+ s    Final greeting pose")
    print("==============================================")
    print("\n")

    capture = None
    record_frame = 0
    if args.record:
        import asyncio
        import omni.timeline
        from omni.kit.capture.viewport import (
            CaptureExtension,
            CaptureOptions,
            CaptureRangeType,
            CaptureRenderPreset,
        )
        from omni.kit.viewport.utility import get_active_viewport

        record_path = Path(args.record_path).expanduser().resolve()
        record_path.parent.mkdir(parents=True, exist_ok=True)
        previous_record_mtime = record_path.stat().st_mtime_ns if record_path.exists() else None

        viewport = get_active_viewport()
        capture = CaptureExtension.get_instance()
        if viewport is None or capture is None:
            raise RuntimeError("Viewport capture is unavailable after scene setup")
        active_capture = capture

        # The capture extension's tests wait for rendered viewport frames before
        # start(). Human USD/animation assets can still be loading after setup.
        viewport_ready = asyncio.ensure_future(viewport.wait_for_rendered_frames())
        ready_deadline = time.monotonic() + 30.0
        while not viewport_ready.done():
            if time.monotonic() >= ready_deadline:
                viewport_ready.cancel()
                raise RuntimeError("Viewport did not become ready for recording")
            simulation_app.update()
        viewport_ready.result()

        render_presets = {
            "RaytracedLighting": CaptureRenderPreset.RAY_TRACE,
            "RealTimePathTracing": CaptureRenderPreset.REAL_TIME_PATHTRACING,
            "PathTracing": CaptureRenderPreset.PATH_TRACE,
            "iray": CaptureRenderPreset.IRAY,
        }
        if viewport.render_mode not in render_presets:
            raise RuntimeError(f"Unsupported viewport render mode: {viewport.render_mode}")

        # The final pose begins at 26 s; 27 s records one full second of it.
        total_record_frames = 27 * args.record_fps
        options = CaptureOptions()
        options.camera = viewport.camera_path.pathString
        options.render_preset = render_presets[viewport.render_mode]
        options.output_folder = str(record_path.parent)
        options.file_name = record_path.stem
        options.file_type = ".mp4"
        options.mp4_encoding_profile = "H264_PROFILE_HIGH"
        options.app_level_capture = False
        options.range_type = CaptureRangeType.FRAMES
        options.start_frame = 0
        options.end_frame = total_record_frames - 1
        options.capture_every_Nth_frames = 1
        options.fps = args.record_fps
        options.animation_fps = args.record_fps
        options.res_width = args.record_width
        options.res_height = args.record_height
        options.overwrite_existing_frames = True
        capture.options = options
        capture.show_default_progress_window = False

        capture_timeline = omni.timeline.get_timeline_interface()

        def advance_record_frame(_dt):
            nonlocal record_frame
            record_frame += 1
            capture_timeline.set_current_time(record_frame / args.record_fps)
            return record_frame < total_record_frames

        capture.forward_one_frame_fn = advance_record_frame
        print(f"[RECORD] Preparing: {record_path}", flush=True)
        if not capture.start():
            raise RuntimeError(f"Viewport capture failed to start: {record_path}")
        print(f"[RECORD] Started: {record_path}", flush=True)

    while simulation_app.is_running() and (capture is None or not capture.done):

        frame_start = time.perf_counter()

        if capture is None:
            t = min(
                time.perf_counter() - start_time,
                28.0,
            )
        else:
            t = record_frame / args.record_fps
        frame_dt = max(0.0, t - previous_t)
        previous_t = t

        # ========================================================
        # Robot trajectory
        # ========================================================

        x = -0.8
        y = 0.0
        yaw = 0.0

        bow = 0.0
        body_roll = 0.0

        # Waiting
        if t < 3.0:
            pass

        # Approach visitor
        elif t < 7.0:
            u = smooth01((t - 3.0) / 4.0)

            x = lerp(-0.8, 0.35, u)
            y = lerp(0.0, 0.25, u)
            yaw = lerp(0.0, math.radians(18.0), u)

        # Greeting
        elif t < 10.0:
            x = 0.35
            y = 0.25
            yaw = math.radians(18.0)

            gt = t - 7.0

            if gt < 1.0:
                bow = 0.055 * math.sin(math.pi * gt)
            elif gt < 2.3:
                body_roll = math.radians(4.0) * math.sin(
                    2.0 * math.pi * 1.2 * (gt - 1.0)
                )

        # Turn toward exhibit
        elif t < 12.0:
            x = 0.35
            y = 0.25

            u = smooth01((t - 10.0) / 2.0)

            yaw = lerp(
                math.radians(18.0),
                0.0,
                u,
            )

        # Guide visitor
        elif t < 19.0:
            u = smooth01((t - 12.0) / 7.0)

            x = lerp(0.35, 3.65, u)
            y = lerp(0.25, 0.45, u)
            yaw = 0.0

        # Turn back toward visitor
        elif t < 21.0:
            x = 3.65
            y = 0.45

            u = smooth01((t - 19.0) / 2.0)

            yaw = lerp(
                0.0,
                math.pi,
                u,
            )

        # Present gift
        elif t < 26.0:
            x = 3.65
            y = 0.45
            yaw = math.pi

            gt = t - 21.0

            if gt < 1.3:
                bow = 0.045 * math.sin(
                    math.pi * gt / 1.3
                )

            if 2.0 < gt < 4.0:
                body_roll = math.radians(3.0) * math.sin(
                    2.0 * math.pi * (gt - 2.0)
                )

        # Final pose
        else:
            x = 3.65
            y = 0.45
            yaw = math.pi

        # ========================================================
        # REAL HUMAN ANIMATION
        # ========================================================

        # While waiting / greeting, keep the visitor facing MagicDog. This is
        # the only phase that manually owns the animated character transform.
        if t < human_follow_start:
            # Continuously and smoothly face MagicDog while it moves.
            desired_yaw = (
                math.atan2(
                    y - visitor_y,
                    x - visitor_x,
                )
                + visitor_forward_yaw_offset
            )

            # shortest angular error
            yaw_error = math.atan2(
                math.sin(desired_yaw - visitor_facing_yaw),
                math.cos(desired_yaw - visitor_facing_yaw),
            )

            # Frame-rate-independent, natural tracking turn.
            max_step = math.radians(90.0) * frame_dt

            visitor_facing_yaw += max(
                -max_step,
                min(max_step, yaw_error),
            )

            visitor_rotation = Gf.Rotation(
                Gf.Vec3d(0.0, 0.0, 1.0),
                math.degrees(visitor_facing_yaw),
            ).GetQuat()
            visitor_rotation_imag = visitor_rotation.GetImaginary()

            # Write the actual graph character, not its parent Xform. The
            # animation graph may otherwise preserve the SkelRoot world pose
            # and visually cancel rotation authored on the parent.
            human_graph.set_world_transform(
                carb.Float3(visitor_x, visitor_y, 0.0),
                carb.Float4(
                    visitor_rotation_imag[0],
                    visitor_rotation_imag[1],
                    visitor_rotation_imag[2],
                    visitor_rotation.GetReal(),
                ),
            )

        # Keep the visitor properly animated while waiting.
        if t < human_follow_start:
            human_graph.set_variable(
                "Walk",
                0.0,
            )
            human_graph.set_variable(
                "Action",
                "Idle",
            )

        # Visitor follows MagicDog using Isaac's walking animation. From this
        # point onward, do not write visitor_op: the graph/path controller owns
        # the character transform and locomotion root motion.
        else:

            if not human_started_walking:

                print("[HUMAN] Starting real walking animation.")

                current_position = carb.Float3(0.0, 0.0, 0.0)
                current_rotation = carb.Float4(0.0, 0.0, 0.0, 0.0)
                human_graph.get_world_transform(
                    current_position,
                    current_rotation,
                )

                human_graph.set_variable(
                    "Action",
                    "Walk",
                )

                human_graph.set_variable(
                    "PathPoints",
                    [
                        carb.Float3(
                            current_position[0],
                            current_position[1],
                            current_position[2],
                        ),
                        carb.Float3(
                            2.05,
                            1.18,
                            0.0,
                        ),
                        carb.Float3(
                            2.65,
                            1.16,
                            0.0,
                        ),
                        carb.Float3(
                            human_destination[0],
                            human_destination[1],
                            human_destination[2],
                        ),
                    ],
                )

                # Low walking speed keeps the visitor behind MagicDog.
                human_graph.set_variable(
                    "Walk",
                    0.42,
                )

                human_started_walking = True

            if human_started_walking and not human_stopped_walking:
                current_position = carb.Float3(0.0, 0.0, 0.0)
                current_rotation = carb.Float4(0.0, 0.0, 0.0, 0.0)
                human_graph.get_world_transform(
                    current_position,
                    current_rotation,
                )

                distance_to_destination = math.sqrt(
                    (human_destination[0] - current_position[0]) ** 2
                    + (human_destination[1] - current_position[1]) ** 2
                    + (human_destination[2] - current_position[2]) ** 2
                )

                if (
                    distance_to_destination <= 0.05
                    or t >= human_follow_timeout
                ):
                    print("[HUMAN] Destination reached. Idle.")

                    human_graph.set_variable(
                        "Walk",
                        0.0,
                    )

                    human_graph.set_variable(
                        "Action",
                        "Idle",
                    )

                    human_stopped_walking = True


        # ========================================================
        # Gait
        # ========================================================

        walk_amp = max(
            motion_window(t, 3.0, 7.0),
            motion_window(t, 10.0, 12.0),
            motion_window(t, 12.0, 19.0),
            motion_window(t, 19.0, 21.0),
        )

        q = q_default.clone()

        phase = (
            2.0
            * math.pi
            * gait_frequency
            * t
        )

        for leg in ["FL", "FR", "RL", "RR"]:

            p = phase + phase_offset[leg]
            s = math.sin(p)

            hip_id = joint_id[f"{leg}_hip_joint"]
            thigh_id = joint_id[f"{leg}_thigh_joint"]
            calf_id = joint_id[f"{leg}_calf_joint"]

            q[hip_id] = (
                q_default[hip_id]
                + walk_amp
                * 0.035
                * math.sin(p)
            )

            q[thigh_id] = (
                q_default[thigh_id]
                + walk_amp
                * 0.30
                * s
            )

            swing = max(0.0, s)
            stance = min(0.0, s)

            q[calf_id] = (
                q_default[calf_id]
                - walk_amp
                * 0.35
                * swing
                + walk_amp
                * 0.08
                * stance
            )

        # Slight crouch/bow expression
        if bow > 0.0:
            for leg in ["FL", "FR"]:
                thigh_id = joint_id[f"{leg}_thigh_joint"]
                calf_id = joint_id[f"{leg}_calf_joint"]

                q[thigh_id] += 0.18
                q[calf_id] -= 0.25

        robot_z = (
            args.robot_height
            - bow
            + walk_amp
            * 0.008
            * math.sin(2.0 * phase)
        )

        # ========================================================
        # Robot pose
        # ========================================================

        roll_t = torch.tensor(
            [body_roll],
            device=device,
        )

        pitch_t = torch.tensor(
            [0.0],
            device=device,
        )

        yaw_t = torch.tensor(
            [yaw],
            device=device,
        )

        quat = quat_from_euler_xyz(
            roll_t,
            pitch_t,
            yaw_t,
        )

        root_pose = torch.zeros(
            (1, 7),
            device=device,
        )

        root_pose[0, 0] = x
        root_pose[0, 1] = y
        root_pose[0, 2] = robot_z
        root_pose[0, 3:7] = quat[0]

        root_vel = torch.zeros(
            (1, 6),
            device=device,
        )

        robot.write_root_pose_to_sim(
            root_pose
        )

        robot.write_root_velocity_to_sim(
            root_vel
        )

        robot.write_joint_state_to_sim(
            q.unsqueeze(0),
            qd.unsqueeze(0),
        )

        # ========================================================
        # Gift follows robot
        # ========================================================

        # offset slightly behind robot center
        gift_local_x = -0.05
        gift_local_y = 0.0

        gift_x = (
            x
            + gift_local_x * math.cos(yaw)
            - gift_local_y * math.sin(yaw)
        )

        gift_y = (
            y
            + gift_local_x * math.sin(yaw)
            + gift_local_y * math.cos(yaw)
        )

        gift_z = robot_z + args.gift_z_offset

        set_root_pose(
            gift_op,
            gift_x,
            gift_y,
            gift_z,
            yaw,
        )

        # ========================================================
        # Story messages
        # ========================================================

        if t >= 3.0 and not messages["detected"]:
            print("[PERCEPTION] Visitor detected.")
            messages["detected"] = True

        if t >= 7.0 and not messages["greet"]:
            print('[INTERACTION] "Hi! Welcome to Robotist."')
            messages["greet"] = True

        if t >= 12.0 and not messages["guide"]:
            print('[ASSISTANT] "Please follow me."')
            messages["guide"] = True

        if t >= 19.0 and not messages["arrived"]:
            print("[NAVIGATION] Destination reached.")
            messages["arrived"] = True

        if t >= 21.0 and not messages["gift"]:
            print('[SERVICE] "Here is your welcome gift."')
            messages["gift"] = True

        sim.step(render=True)

        # approximately real time
        elapsed = time.perf_counter() - frame_start
        sleep_time = (1.0 / 60.0) - elapsed

        if capture is None and sleep_time > 0:
            time.sleep(sleep_time)

    if capture is not None:
        if not capture.done or not record_path.is_file() or record_path.stat().st_size == 0:
            raise RuntimeError(f"Viewport capture did not finish: {record_path}")
        if previous_record_mtime == record_path.stat().st_mtime_ns:
            raise RuntimeError(f"Viewport capture did not update the MP4: {record_path}")
        print(f"[RECORD] Finished: {record_path}", flush=True)

    env.close()


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            if active_capture is not None:
                if not active_capture.done:
                    active_capture.cancel()
                    # cancel() marks the capture; Kit processes it on updates.
                    for _ in range(3):
                        if active_capture.done:
                            break
                        simulation_app.update()
                active_capture.forward_one_frame_fn = None
        finally:
            simulation_app.close()
