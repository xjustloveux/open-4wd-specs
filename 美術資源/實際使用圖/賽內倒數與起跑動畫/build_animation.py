"""Build one-shot race countdown WebP assets from single or sequenced source PNGs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


THEMES = {
    "default": "default",
    "moon-rabbit": "moon-rabbit-workshop-2026-97c954",
}
ASSETS = ("3", "2", "1", "start")


def default_authoring_root(script_path: Path) -> Path:
    """Locate the ignored authoring input without depending on tracked PNG masters."""
    repository_root = script_path.resolve().parents[3]
    return repository_root / "release-input" / "ui" / "race-countdown"


def render_frame(source: Image.Image, canvas_size: tuple[int, int], spec: dict[str, float]) -> Image.Image:
    """Render one authored transform into pixels so runtime CSS owns no motion style."""
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    maximum = int(min(canvas_size) * 0.9 * spec["scale"])
    fitted = ImageOps.contain(source, (maximum, maximum), Image.Resampling.LANCZOS)
    fitted = ImageEnhance.Brightness(fitted).enhance(spec["brightness"])
    if spec["opacity"] < 1:
        alpha = fitted.getchannel("A").point(lambda value: round(value * spec["opacity"]))
        fitted.putalpha(alpha)
    position = ((canvas_size[0] - fitted.width) // 2, (canvas_size[1] - fitted.height) // 2)
    canvas.alpha_composite(fitted, position)
    return canvas


def build_asset(
    source_path: Path,
    frames_root: Path,
    output_root: Path,
    name: str,
    project: dict[str, object],
) -> None:
    """Write normalized PNG frames plus animated and static runtime WebP files."""
    kind = "start" if name == "start" else "digit"
    timeline = project[kind]
    assert isinstance(timeline, dict)
    specs = timeline["frames"]
    assert isinstance(specs, list)
    canvas_value = project["canvas"]
    assert isinstance(canvas_value, list)
    canvas_size = (int(canvas_value[0]), int(canvas_value[1]))
    source_frames_dir = source_path.with_suffix("")
    if timeline.get("sourceMode") == "sequence":
        source_paths = sorted(source_frames_dir.glob("*.png"))
        if len(source_paths) != len(specs):
            raise ValueError(
                f"{source_frames_dir} must contain exactly {len(specs)} PNG source frames"
            )
    else:
        source_paths = [source_path] * len(specs)
    sources = [Image.open(path).convert("RGBA") for path in source_paths]
    frames = [
        render_frame(source, canvas_size, frame_spec)
        for source, frame_spec in zip(sources, specs, strict=True)
    ]

    target_frames = frames_root / name
    target_frames.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(target_frames / f"{index:02d}.png", optimize=True)

    output_root.mkdir(parents=True, exist_ok=True)
    webp = project["webp"]
    assert isinstance(webp, dict)
    frames[0].save(
        output_root / f"{name}.webp",
        save_all=True,
        append_images=frames[1:],
        duration=int(project["frameDurationMs"]),
        loop=int(webp["loop"]),
        quality=int(webp["quality"]),
        method=int(webp["method"]),
        minimize_size=True,
    )
    static_index = int(timeline["staticFrame"])
    frames[static_index].save(
        output_root / f"{name}-static.webp",
        quality=int(webp["quality"]),
        method=int(webp["method"]),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--runtime-themes",
        type=Path,
        required=True,
        help="Path to open-4wd/public/assets/themes",
    )
    parser.add_argument(
        "--authoring-root",
        type=Path,
        default=default_authoring_root(Path(__file__)),
        help="Path to release-input/ui/race-countdown",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    project = json.loads((root / "animation-project.json").read_text(encoding="utf-8"))
    for source_theme, runtime_theme in THEMES.items():
        for name in ASSETS:
            build_asset(
                args.authoring_root / source_theme / "source" / f"{name}.png",
                args.authoring_root / source_theme / "frames",
                args.runtime_themes / runtime_theme / "assets" / "race-countdown",
                name,
                project,
            )


if __name__ == "__main__":
    main()
