"""核對兩套訊息原稿的語意、透明度與唯一性，記錄可重現的來源雜湊。"""
from pathlib import Path
import hashlib
import json
import re
from PIL import Image

HERE = Path(__file__).resolve().parent
SPECS = HERE.parents[2]
catalog = (SPECS.parent / 'open-4wd/src/race-messages/catalog.ts').read_text(encoding='utf-8')
keys = set(re.findall(r"^\s*\['([a-z][a-z-]+)',", catalog, re.MULTILINE))
assert len(keys) == 96
records = {}
digests = set()
for season in ['halloween', 'christmas']:
    source = SPECS / 'release-input/ui/race-messages' / season
    files = sorted(source.glob('*.png'))
    assert {file.stem for file in files} == keys, season
    records[season] = {}
    for file in files:
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        assert digest not in digests, f'duplicate image: {file.name}'
        digests.add(digest)
        with Image.open(file) as image:
            assert image.mode == 'RGBA', file.name
            low, high = image.getchannel('A').getextrema()
            assert low == 0 and high > 0, file.name
            records[season][file.stem] = {
                'source': file.relative_to(SPECS).as_posix(),
                'sha256': digest,
                'bytes': file.stat().st_size,
                'size': list(image.size),
            }
    print(f'{season}: 96 unique transparent PNG sources; exact catalog coverage')
(HERE / 'records/race-message-sources.json').write_text(
    json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
)
