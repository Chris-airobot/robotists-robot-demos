import argparse
import math
import time

import gymnasium as gym
import torch

from isaaclab.app import AppLauncher


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

parser = argparse.ArgumentParser()
parser.add_argument("--robot_height", type=float, default=0.34)

AppLauncher.add_app_launcher_args(parser)
args = parser.parse_args()

app_launcher = AppLauncher(args)
simulation_app = app_launcher.app


# Isaac/Omniverse imports must come after AppLauncher
import isaaclab.sim as sim_utils
import robot_lab.tasks  # noqa: F401

from isaaclab_tasks.utils import parse_env_cfg
from isaaclab.utils.math import quat_from_euler_xyz
from pxr import UsdGeom


TASK = "RobotLab-Isaac-Velocity-Flat-MagicLab-Dog-v0"


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def motion_window(t, start, end, ramp=0.4):
    if t < start or t > end:
        return 0.0

    a = min(1.0, (t - start) / ramp)
    b = min(1.0, (end - t) / ramp)

    return max(0.0, min(a, b))


def quat_y(degrees):
    a = math.radians(degrees) / 2.0
    return (
        math.cos(a),
        0.0,
        math.sin(a),
        0.0,
    )


def material(color, metallic=0.0, roughness=0.5,
             emissive=(0.0, 0.0, 0.0), opacity=1.0):

    return sim_utils.materials.PreviewSurfaceCfg(
        diffuse_color=color,
        metallic=metallic,
        roughness=roughness,
        emissive_color=emissive,
        opacity=opacity,
    )


def spawn_box(path, position, size, color,
              metallic=0.0, emissive=(0.0, 0.0, 0.0),
              opacity=1.0):

    cfg = sim_utils.CuboidCfg(
        size=size,
        visual_material=material(
            color,
            metallic=metallic,
            emissive=emissive,
            opacity=opacity,
        ),
    )

    return cfg.func(
        path,
        cfg,
        translation=position,
    )


def spawn_cylinder(path, position, radius, height, axis,
                   color, metallic=0.0, emissive=(0.0, 0.0, 0.0)):

    cfg = sim_utils.CylinderCfg(
        radius=radius,
        height=height,
        axis=axis,
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


def set_visible(prim, visible):
    imageable = UsdGeom.Imageable(prim)

    if visible:
        imageable.MakeVisible()
    else:
        imageable.MakeInvisible()


# ---------------------------------------------------------------------
# Industrial room
# ---------------------------------------------------------------------

def create_realistic_room():

    # Concrete floor
    spawn_box(
        "/World/InspectionScene/FloorVisual",
        (2.0, 1.2, 0.0),
        (8.0, 6.0, 0.02),
        (0.16, 0.17, 0.18),
        metallic=0.05,
    )

    # Back wall
    spawn_box(
        "/World/InspectionScene/BackWall",
        (2.0, 3.0, 1.5),
        (8.0, 0.12, 3.0),
        (0.30, 0.31, 0.32),
    )

    # Side wall
    spawn_box(
        "/World/InspectionScene/SideWall",
        (-1.0, 1.0, 1.5),
        (0.12, 4.0, 3.0),
        (0.27, 0.28, 0.29),
    )

    # Safety bollards
    yellow = (0.85, 0.55, 0.03)

    for i, x in enumerate([1.45, 2.75]):
        spawn_cylinder(
            f"/World/InspectionScene/Bollard_{i}",
            (x, 1.85, 0.45),
            radius=0.055,
            height=0.9,
            axis="Z",
            color=yellow,
            metallic=0.3,
        )

    # Background industrial pipes
    pipe_color = (0.38, 0.40, 0.42)

    spawn_cylinder(
        "/World/InspectionScene/PipeVertical1",
        (3.45, 2.7, 1.0),
        radius=0.065,
        height=2.0,
        axis="Z",
        color=pipe_color,
        metallic=0.8,
    )

    spawn_cylinder(
        "/World/InspectionScene/PipeVertical2",
        (3.75, 2.7, 1.0),
        radius=0.065,
        height=2.0,
        axis="Z",
        color=pipe_color,
        metallic=0.8,
    )

    spawn_cylinder(
        "/World/InspectionScene/PipeTop",
        (3.60, 2.7, 2.0),
        radius=0.065,
        height=0.30,
        axis="X",
        color=pipe_color,
        metallic=0.8,
    )

    # Ambient industrial lighting
    dome_cfg = sim_utils.DomeLightCfg(
        intensity=650.0,
        color=(0.92, 0.95, 1.0),
        visible_in_primary_ray=False,
    )

    dome_cfg.func(
        "/World/InspectionScene/DomeLight",
        dome_cfg,
    )


# ---------------------------------------------------------------------
# Industrial equipment
# ---------------------------------------------------------------------

def create_industrial_scene():

    # Main electrical / pump control cabinet
    spawn_box(
        "/World/InspectionScene/MainCabinet",
        (2.10, 1.05, 0.75),
        (0.85, 0.50, 1.50),
        (0.22, 0.24, 0.25),
        metallic=0.65,
    )

    # Cabinet front panel
    spawn_box(
        "/World/InspectionScene/FrontPanel",
        (2.10, 0.785, 0.78),
        (0.64, 0.035, 0.95),
        (0.10, 0.11, 0.12),
        metallic=0.4,
    )

    # Bottom machine section
    spawn_box(
        "/World/InspectionScene/BaseUnit",
        (2.10, 1.05, 0.17),
        (1.05, 0.68, 0.34),
        (0.14, 0.15, 0.16),
        metallic=0.7,
    )

    # Second cabinet so the room does not look completely empty
    spawn_box(
        "/World/InspectionScene/SideCabinet",
        (3.25, 1.18, 0.60),
        (0.72, 0.55, 1.20),
        (0.26, 0.28, 0.29),
        metallic=0.6,
    )

    # Industrial pipe
    spawn_cylinder(
        "/World/InspectionScene/Pipe",
        (2.65, 1.55, 0.32),
        radius=0.055,
        height=2.5,
        axis="X",
        color=(0.35, 0.37, 0.39),
        metallic=0.8,
    )

    # -------------------------------------------------------------
    # PRESSURE GAUGE
    # Face points toward -Y, where MagicDog will stand.
    # -------------------------------------------------------------

    # Outer rim
    spawn_cylinder(
        "/World/InspectionScene/Gauge/Rim",
        (2.10, 0.745, 0.92),
        radius=0.17,
        height=0.055,
        axis="Y",
        color=(0.08, 0.08, 0.08),
        metallic=0.8,
    )

    # White gauge face
    spawn_cylinder(
        "/World/InspectionScene/Gauge/Face",
        (2.10, 0.710, 0.92),
        radius=0.145,
        height=0.018,
        axis="Y",
        color=(0.88, 0.88, 0.84),
    )

    # Red high-pressure needle.
    #
    # Approximate needle angle; enough for the visual story.
    needle_angle = -55.0
    angle = math.radians(needle_angle)

    needle_length = 0.105

    needle_x = 2.10 + 0.5 * needle_length * math.cos(angle)
    needle_z = 0.92 + 0.5 * needle_length * math.sin(angle)

    needle_cfg = sim_utils.CuboidCfg(
        size=(needle_length, 0.018, 0.010),
        visual_material=material(
            (0.75, 0.03, 0.03),
            emissive=(0.10, 0.0, 0.0),
        ),
    )

    needle_cfg.func(
        "/World/InspectionScene/Gauge/Needle",
        needle_cfg,
        translation=(needle_x, 0.695, needle_z),
        orientation=quat_y(-needle_angle),
    )

    # Small gauge center
    spawn_cylinder(
        "/World/InspectionScene/Gauge/Center",
        (2.10, 0.684, 0.92),
        radius=0.025,
        height=0.018,
        axis="Y",
        color=(0.04, 0.04, 0.04),
    )

    # Gauge tick marks
    for i in range(11):
        angle_deg = -120.0 + i * 24.0
        angle = math.radians(angle_deg)

        radius = 0.115

        x_tick = 2.10 + radius * math.cos(angle)
        z_tick = 0.92 + radius * math.sin(angle)

        tick_cfg = sim_utils.CuboidCfg(
            size=(0.028, 0.010, 0.006),
            visual_material=material((0.03, 0.03, 0.03)),
        )

        tick_cfg.func(
            f"/World/InspectionScene/Gauge/Tick_{i}",
            tick_cfg,
            translation=(x_tick, 0.675, z_tick),
            orientation=quat_y(-angle_deg),
        )

    # -------------------------------------------------------------
    # Scan visualization
    # -------------------------------------------------------------

    scan_color = (0.05, 0.65, 0.85)

    scan_parts = []

    scan_parts.append(
        spawn_box(
            "/World/InspectionScene/ScanFrame/Top",
            (2.10, 0.670, 1.125),
            (0.42, 0.008, 0.008),
            scan_color,
            emissive=scan_color,
        )
    )

    scan_parts.append(
        spawn_box(
            "/World/InspectionScene/ScanFrame/Bottom",
            (2.10, 0.670, 0.715),
            (0.42, 0.008, 0.008),
            scan_color,
            emissive=scan_color,
        )
    )

    scan_parts.append(
        spawn_box(
            "/World/InspectionScene/ScanFrame/Left",
            (1.895, 0.670, 0.92),
            (0.008, 0.008, 0.42),
            scan_color,
            emissive=scan_color,
        )
    )

    scan_parts.append(
        spawn_box(
            "/World/InspectionScene/ScanFrame/Right",
            (2.305, 0.670, 0.92),
            (0.008, 0.008, 0.42),
            scan_color,
            emissive=scan_color,
        )
    )

    # -------------------------------------------------------------
    # Red anomaly visualization
    # -------------------------------------------------------------

    alarm_color = (0.90, 0.03, 0.03)

    alarm_parts = []

    alarm_parts.append(
        spawn_box(
            "/World/InspectionScene/AlarmFrame/Top",
            (2.10, 0.655, 1.15),
            (0.47, 0.009, 0.009),
            alarm_color,
            emissive=alarm_color,
        )
    )

    alarm_parts.append(
        spawn_box(
            "/World/InspectionScene/AlarmFrame/Bottom",
            (2.10, 0.655, 0.69),
            (0.47, 0.009, 0.009),
            alarm_color,
            emissive=alarm_color,
        )
    )

    alarm_parts.append(
        spawn_box(
            "/World/InspectionScene/AlarmFrame/Left",
            (1.87, 0.655, 0.92),
            (0.009, 0.009, 0.47),
            alarm_color,
            emissive=alarm_color,
        )
    )

    alarm_parts.append(
        spawn_box(
            "/World/InspectionScene/AlarmFrame/Right",
            (2.33, 0.655, 0.92),
            (0.009, 0.009, 0.47),
            alarm_color,
            emissive=alarm_color,
        )
    )

    # Warning beacon on top of the machine
    beacon_cfg = sim_utils.SphereCfg(
        radius=0.07,
        visual_material=material(
            alarm_color,
            emissive=alarm_color,
        ),
    )

    beacon = beacon_cfg.func(
        "/World/InspectionScene/AlarmBeacon",
        beacon_cfg,
        translation=(2.10, 1.03, 1.58),
    )

    # Everything starts hidden.
    for prim in scan_parts:
        set_visible(prim, False)

    for prim in alarm_parts:
        set_visible(prim, False)

    set_visible(beacon, False)

    return scan_parts, alarm_parts, beacon


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main():

    env_cfg = parse_env_cfg(
        TASK,
        device=args.device,
        num_envs=1,
        use_fabric=True,
    )

    env_cfg.scene.num_envs = 1

    # Kinematic website animation: robot cannot fall over.
    env_cfg.scene.robot.spawn.rigid_props.disable_gravity = True

    # Remove command arrows.
    env_cfg.commands.base_velocity.debug_vis = False

    env = gym.make(TASK, cfg=env_cfg)

    env.reset()

    base_env = env.unwrapped
    robot = base_env.scene["robot"]
    sim = base_env.sim
    device = base_env.device

    # Add industrial environment AFTER Isaac environment creation.
    create_realistic_room()
    scan_parts, alarm_parts, beacon = create_industrial_scene()

    sim.step(render=True)

    print("\n==============================================")
    print(" Robotist MagicDog Inspection Demo")
    print("==============================================")
    print("0-2 s   : standby")
    print("2-7 s   : approach equipment")
    print("7-9 s   : turn toward gauge")
    print("9-11 s  : visual inspection / scanning")
    print("11-13 s : anomaly detected")
    print("13-15 s : turn back to patrol route")
    print("15-20 s : continue patrol")
    print("20+ s   : finish")
    print("==============================================\n")

    joint_id = {
        name: i
        for i, name in enumerate(robot.joint_names)
    }

    q_default = robot.data.default_joint_pos[0].clone()
    qd = torch.zeros_like(q_default)

    # Diagonal trot.
    phase_offset = {
        "FL": 0.0,
        "RR": 0.0,
        "FR": math.pi,
        "RL": math.pi,
    }

    gait_frequency = 1.8

    start_time = time.perf_counter()

    scanning_announced = False
    anomaly_announced = False
    patrol_announced = False

    while simulation_app.is_running():

        frame_start = time.perf_counter()

        t = min(time.perf_counter() - start_time, 22.0)

        # -------------------------------------------------------------
        # ROBOT ROOT TRAJECTORY
        # -------------------------------------------------------------

        x = 0.0
        y = 0.0
        yaw = 0.0

        # Stand
        if t < 2.0:
            pass

        # Approach cabinet
        elif t < 7.0:
            u = smooth01((t - 2.0) / 5.0)

            x = 2.10 * u

        # Turn 90 deg left, facing gauge
        elif t < 9.0:
            x = 2.10

            u = smooth01((t - 7.0) / 2.0)

            yaw = (math.pi / 2.0) * u

        # Inspect gauge
        elif t < 13.0:
            x = 2.10
            yaw = math.pi / 2.0

            # Deliberate inspection scan:
            # left -> center -> right -> hold
            scan_t = t - 9.0

            if scan_t < 0.7:
                yaw += math.radians(-3.0)
            elif scan_t < 1.4:
                yaw += 0.0
            elif scan_t < 2.1:
                yaw += math.radians(3.0)
            else:
                yaw += 0.0

        # Turn back toward patrol direction
        elif t < 15.0:
            x = 2.10

            u = smooth01((t - 13.0) / 2.0)

            yaw = (math.pi / 2.0) * (1.0 - u)

        # Continue patrol
        elif t < 20.0:
            u = smooth01((t - 15.0) / 5.0)

            x = 2.10 + 1.90 * u
            yaw = 0.0

        # Finish
        else:
            x = 4.00
            yaw = 0.0

        # -------------------------------------------------------------
        # GAIT
        # -------------------------------------------------------------

        walk_amp = max(
            motion_window(t, 2.0, 7.0),
            motion_window(t, 7.0, 9.0),
            motion_window(t, 13.0, 15.0),
            motion_window(t, 15.0, 20.0),
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
                + walk_amp * 0.035 * math.sin(p)
            )

            q[thigh_id] = (
                q_default[thigh_id]
                + walk_amp * 0.30 * s
            )

            swing = max(0.0, s)
            stance = min(0.0, s)

            q[calf_id] = (
                q_default[calf_id]
                - walk_amp * 0.35 * swing
                + walk_amp * 0.08 * stance
            )

        z = (
            args.robot_height
            + walk_amp
            * 0.008
            * math.sin(2.0 * phase)
        )

        # -------------------------------------------------------------
        # INSPECTION VISUALIZATION
        # -------------------------------------------------------------

        scanning = 9.0 <= t < 11.0
        anomaly = 11.0 <= t < 13.0

        for prim in scan_parts:
            set_visible(prim, scanning)

        for prim in alarm_parts:
            set_visible(prim, anomaly)

        set_visible(beacon, anomaly)

        if scanning and not scanning_announced:

            print("\n[INSPECTION]")
            print("Target detected: Pressure Gauge")
            print("Reading instrument...")

            scanning_announced = True

        if anomaly and not anomaly_announced:

            print("\n[INSPECTION RESULT]")
            print("Pressure: 8.7 bar")
            print("Expected range: 4.0 - 7.0 bar")
            print("STATUS: HIGH")
            print("ALERT: Abnormal pressure detected\n")

            anomaly_announced = True

        if t >= 15.0 and not patrol_announced:

            print("[PATROL]")
            print("Inspection recorded.")
            print("Continuing patrol route.\n")

            patrol_announced = True

        # -------------------------------------------------------------
        # WRITE ROBOT STATE
        # -------------------------------------------------------------

        roll_t = torch.tensor(
            [0.0],
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
        root_pose[0, 2] = z
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

        sim.step(render=True)

        # Roughly real-time 60 FPS
        elapsed = (
            time.perf_counter()
            - frame_start
        )

        sleep_time = (
            (1.0 / 60.0)
            - elapsed
        )

        if sleep_time > 0:
            time.sleep(sleep_time)

    env.close()


if __name__ == "__main__":
    main()
    simulation_app.close()
