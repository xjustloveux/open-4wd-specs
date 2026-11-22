"""Check visual-slot parity against both established themes, not only valid subsets."""
from pathlib import Path
import hashlib
import json
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3] / 'open-4wd/public/assets/themes'
reference_ids = ['default', 'moon-rabbit-workshop-2026-97c954']
references = [json.loads((ROOT / name / 'theme.json').read_text(encoding='utf-8')) for name in reference_ids]
keys = {key for manifest in references for key, value in manifest['assets'].items()
        if isinstance(value, str) and value.endswith(('.svg', '.webp', '.png'))}
report = {}
for season, identifier in json.loads((HERE / 'themes.json').read_text(encoding='utf-8')).items():
    folder = ROOT / identifier
    manifest = json.loads((folder / 'theme.json').read_text(encoding='utf-8'))
    missing = sorted(keys - set(manifest['assets']))
    assert not missing, (identifier, missing)
    assert all((folder / manifest['assets'][key]).is_file() for key in keys)
    assert len({manifest['assets'][key] for key in ['landing-hero', 'garage-background', 'scene-ugc']}) == 3
    provenance = json.loads((HERE / 'records' / f'{season}-build-manifest.json').read_text(encoding='utf-8'))
    for name, record in provenance['files'].items():
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == record['sha256'], name
    countdown = {}
    for file in sorted((folder / 'assets/race-countdown').glob('*.webp')):
        with Image.open(file) as image:
            assert image.size == (512, 512)
            assert image.mode == 'RGBA'
            animated = not file.stem.endswith('-static')
            assert image.n_frames > 1 if animated else image.n_frames == 1
            if animated:
                assert image.info['loop'] == 1
                duration = 0
                for index in range(image.n_frames):
                    image.seek(index)
                    image.load()
                    duration += image.info.get('duration', 0)
                assert duration == (720 if file.stem == 'start' else 900), (file.name, duration)
            countdown[file.name] = {'size': image.size, 'frames': image.n_frames,
                                    'loop': image.info.get('loop'), 'bytes': file.stat().st_size}
    files = sorted(file.relative_to(folder).as_posix() for file in (folder / 'assets').rglob('*') if file.is_file())
    report[season] = {'referenceThemes': reference_ids, 'imageKeys': len(keys), 'missingImageKeys': missing,
                      'uniqueFiles': len(files), 'files': files, 'countdown': countdown}
    print(identifier, len(keys), 'visual slots covered;', len(files), 'image files; hashes match')
(HERE / 'records/asset-parity.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
