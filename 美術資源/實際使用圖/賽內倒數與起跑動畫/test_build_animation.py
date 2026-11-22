"""Tests for the reproducible race countdown animation builder."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

import build_animation
from build_animation import build_asset


class BuildAnimationTest(unittest.TestCase):
    def test_default_authoring_root_uses_release_input(self) -> None:
        """Falling back to the tracked docs tree would break after PNG masters leave Git."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository_root = Path(temporary_directory) / "open-4wd-specs"
            script_path = (
                repository_root
                / "美術資源"
                / "實際使用圖"
                / "賽內倒數與起跑動畫"
                / "build_animation.py"
            )
            resolver = getattr(build_animation, "default_authoring_root", None)

            self.assertIsNotNone(resolver)
            self.assertEqual(
                resolver(script_path),
                repository_root / "release-input" / "ui" / "race-countdown",
            )

    def test_start_uses_each_authored_source_frame_in_sequence(self) -> None:
        """Removing sequence loading would collapse the authored action back to one pose."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_root = root / "source"
            source_frames = source_root / "start"
            source_frames.mkdir(parents=True)
            source_path = source_root / "start.png"
            Image.new("RGBA", (64, 64), (8, 8, 8, 255)).save(source_path)
            expected_colors = []
            for index in range(8):
                color = (20 + index * 20, 40 + index * 10, 80 + index * 8, 255)
                expected_colors.append(color)
                Image.new("RGBA", (64, 64), color).save(source_frames / f"{index:02d}.png")

            project = {
                "canvas": [64, 64],
                "frameDurationMs": 90,
                "webp": {"quality": 100, "method": 6, "loop": 1},
                "start": {
                    "sourceMode": "sequence",
                    "frames": [
                        {"scale": 1.0, "opacity": 1.0, "brightness": 1.0}
                        for _ in range(8)
                    ],
                    "staticFrame": 5,
                },
            }

            frames_root = root / "frames"
            output_root = root / "runtime"
            build_asset(source_path, frames_root, output_root, "start", project)

            rendered_colors = [
                Image.open(frames_root / "start" / f"{index:02d}.png").getpixel((32, 32))
                for index in range(8)
            ]
            self.assertEqual(rendered_colors, expected_colors)
            with Image.open(output_root / "start.webp") as animation:
                self.assertEqual(animation.n_frames, 8)

    def test_start_rejects_an_incomplete_authored_sequence(self) -> None:
        """Silently accepting a short sequence would ship a truncated firing action."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_root = root / "source"
            source_frames = source_root / "start"
            source_frames.mkdir(parents=True)
            source_path = source_root / "start.png"
            Image.new("RGBA", (64, 64), (8, 8, 8, 255)).save(source_path)
            for index in range(7):
                Image.new("RGBA", (64, 64), (index * 20, 40, 80, 255)).save(
                    source_frames / f"{index:02d}.png"
                )
            project = {
                "canvas": [64, 64],
                "frameDurationMs": 90,
                "webp": {"quality": 100, "method": 6, "loop": 1},
                "start": {
                    "sourceMode": "sequence",
                    "frames": [
                        {"scale": 1.0, "opacity": 1.0, "brightness": 1.0}
                        for _ in range(8)
                    ],
                    "staticFrame": 5,
                },
            }

            with self.assertRaisesRegex(ValueError, "exactly 8 PNG source frames"):
                build_asset(source_path, root / "frames", root / "runtime", "start", project)

    def test_single_source_mode_ignores_a_sibling_frame_directory(self) -> None:
        """An unrelated directory must not silently change a single-source asset's output."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_root = root / "source"
            source_frames = source_root / "start"
            source_frames.mkdir(parents=True)
            source_path = source_root / "start.png"
            expected_color = (12, 34, 56, 255)
            Image.new("RGBA", (64, 64), expected_color).save(source_path)
            for index in range(8):
                Image.new("RGBA", (64, 64), (180, index * 10, 40, 255)).save(
                    source_frames / f"{index:02d}.png"
                )
            project = {
                "canvas": [64, 64],
                "frameDurationMs": 90,
                "webp": {"quality": 100, "method": 6, "loop": 1},
                "start": {
                    "frames": [
                        {"scale": 1.0, "opacity": 1.0, "brightness": 1.0}
                        for _ in range(8)
                    ],
                    "staticFrame": 5,
                },
            }

            frames_root = root / "frames"
            build_asset(source_path, frames_root, root / "runtime", "start", project)

            rendered_colors = [
                Image.open(frames_root / "start" / f"{index:02d}.png").getpixel((32, 32))
                for index in range(8)
            ]
            self.assertEqual(rendered_colors, [expected_color] * 8)


if __name__ == "__main__":
    unittest.main()
