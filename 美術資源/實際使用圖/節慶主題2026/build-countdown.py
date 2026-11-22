"""使用既有倒數工程的時序與編碼器重建節慶插畫動畫。"""
from pathlib import Path
import json
import runpy

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / '賽內倒數與起跑動畫'
SPECS = HERE.parents[2]


def build_countdowns():
    """只重建兩套節慶主題，不改寫原有兩套主題。"""
    engine = runpy.run_path(str(SHARED / 'build_animation.py'))
    project = json.loads((SHARED / 'animation-project.json').read_text(encoding='utf-8'))
    themes = json.loads((HERE / 'themes.json').read_text(encoding='utf-8'))
    for season, identifier in themes.items():
        source = SPECS / 'release-input/ui/race-countdown' / season
        output = SPECS.parent / 'open-4wd/public/assets/themes' / identifier / 'assets/race-countdown'
        for name in ['3', '2', '1', 'start']:
            engine['build_asset'](source / 'source' / f'{name}.png', source / 'frames', output, name, project)
        print(f'{season}: shared 900ms digits / 720ms sequential start')


if __name__ == '__main__':
    build_countdowns()
