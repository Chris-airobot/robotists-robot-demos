import argparse
import math
import time

import gymnasium as gym
import torch

from isaaclab.app import AppLauncher


parser = argparse.ArgumentParser()
parser.add_argument("--robot_height", type=float, default=0.34)
AppLauncher.add_app_launcher_args(parser)

args = parser.parse_args()

app_launcher = AppLauncher(args)
simulation_app = app_launcher.app


import robot_lab.tasks  # noqa: F401
from isaaclab_tasks.utils import parse_env_cfg
from isaaclab.utils.math import quat_from_euler_xyz


TASK = "RobotLab-Isaac-Velocity-Flat-MagicLab-Dog-v0"


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def motion_window(t, start, end, ramp=0.5):
    if t < start or t > end:
        return 0.0

    a = min(1.0, (t - start) / ramp)
    b = min(1.0, (end - t) / ramp)
    return max(0.0, min(a, b))


def main():
    env_cfg = parse_env_cfg(
        TASK,
        device=args.device,
        num_envs=1,
        use_fabric=True,
    )

    # We are making an animation, not testing dynamics.
    env_cfg.scene.num_envs = 1
    env_cfg.scene.robot.spawn.rigid_props.disable_gravity = True
    env_cfg.commands.base_velocity.debug_vis = False

    env = gym.make(TASK, cfg=env_cfg)
    env.reset()

    base_env = env.unwrapped
    robot = base_env.scene["robot"]
    sim = base_env.sim
    device = base_env.device

    print("\nJoint names:")
    print(robot.joint_names)

    joint_id = {name: i for i, name in enumerate(robot.joint_names)}

    q_default = robot.data.default_joint_pos[0].clone()
    qd = torch.zeros_like(q_default)

    # Trot: diagonal legs move together.
    phase_offset = {
        "FL": 0.0,
        "RR": 0.0,
        "FR": math.pi,
        "RL": math.pi,
    }

    start_time = time.perf_counter()
    gait_frequency = 1.8

    while simulation_app.is_running():
        frame_start = time.perf_counter()

        # One 22-second demo, then hold final pose.
        t = min(time.perf_counter() - start_time, 22.0)

        # ------------------------------------------------------------
        # ROOT TRAJECTORY
        #
        # 0-2     stand
        # 2-8     walk forward
        # 8-10    inspect / stop
        # 10-13   turn left 90 deg
        # 13-19   walk forward again
        # 19-22   inspect / stop
        # ------------------------------------------------------------

        x = 0.0
        y = 0.0
        yaw = 0.0

        if t < 2.0:
            pass

        elif t < 8.0:
            u = smooth01((t - 2.0) / 6.0)
            x = 2.4 * u

        elif t < 10.0:
            x = 2.4

        elif t < 13.0:
            x = 2.4
            u = smooth01((t - 10.0) / 3.0)
            yaw = (math.pi / 2.0) * u

        elif t < 19.0:
            x = 2.4
            yaw = math.pi / 2.0
            u = smooth01((t - 13.0) / 6.0)
            y = 2.4 * u

        else:
            x = 2.4
            y = 2.4
            yaw = math.pi / 2.0

        # ------------------------------------------------------------
        # GAIT
        # ------------------------------------------------------------

        walk_amp = max(
            motion_window(t, 2.0, 8.0),
            motion_window(t, 10.0, 13.0),
            motion_window(t, 13.0, 19.0),
        )

        q = q_default.clone()

        phase = 2.0 * math.pi * gait_frequency * t

        for leg in ["FL", "FR", "RL", "RR"]:
            p = phase + phase_offset[leg]
            s = math.sin(p)

            hip_id = joint_id[f"{leg}_hip_joint"]
            thigh_id = joint_id[f"{leg}_thigh_joint"]
            calf_id = joint_id[f"{leg}_calf_joint"]

            # Small lateral body/leg motion.
            q[hip_id] = q_default[hip_id] + walk_amp * 0.035 * math.sin(p)

            # Main forward/back swing.
            q[thigh_id] = q_default[thigh_id] + walk_amp * 0.30 * s

            # Flex knee more during swing phase.
            swing = max(0.0, s)
            stance = min(0.0, s)

            q[calf_id] = (
                q_default[calf_id]
                - walk_amp * 0.35 * swing
                + walk_amp * 0.08 * stance
            )

        # Tiny vertical body oscillation while walking.
        z = args.robot_height + walk_amp * 0.008 * math.sin(2.0 * phase)

        roll = torch.tensor([0.0], device=device)
        pitch = torch.tensor([0.0], device=device)
        yaw_t = torch.tensor([yaw], device=device)

        quat = quat_from_euler_xyz(roll, pitch, yaw_t)

        root_pose = torch.zeros((1, 7), device=device)
        root_pose[0, 0] = x
        root_pose[0, 1] = y
        root_pose[0, 2] = z
        root_pose[0, 3:7] = quat[0]

        root_vel = torch.zeros((1, 6), device=device)

        # Force the visual animation state directly.
        robot.write_root_pose_to_sim(root_pose)
        robot.write_root_velocity_to_sim(root_vel)

        robot.write_joint_state_to_sim(
            q.unsqueeze(0),
            qd.unsqueeze(0),
        )

        sim.step(render=True)

        # Aim for ~60 fps wall-clock playback.
        elapsed = time.perf_counter() - frame_start
        sleep_time = (1.0 / 60.0) - elapsed

        if sleep_time > 0:
            time.sleep(sleep_time)

    env.close()


if __name__ == "__main__":
    main()
    simulation_app.close()
