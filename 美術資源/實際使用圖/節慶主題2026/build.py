"""Build the two approved seasonal themes from local, retained authoring sources."""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib
import json
import shutil
import re
import subprocess
import runpy

HERE = Path(__file__).resolve().parent
SPECS = HERE.parents[2]
WORKSPACE = SPECS.parent
APP = WORKSPACE / 'open-4wd'
IDS = json.loads((HERE / 'themes.json').read_text(encoding='utf-8'))
BASE = json.loads((APP / 'public/assets/themes/default/theme.json').read_text(encoding='utf-8'))

# 節慶主題自備的音效槽（順序即 theme.json 的鍵順序）。
THEME_SFX_SLOTS = ['sfx-click','sfx-confirm','sfx-cancel','sfx-error','sfx-toast','sfx-checkpoint','sfx-race-finish','sfx-motor-loop','sfx-collision-light','sfx-collision-heavy','sfx-weapon-melee-launch','sfx-weapon-melee-impact','sfx-weapon-projectile-launch','sfx-weapon-projectile-impact','sfx-skill-boost','sfx-skill-brake','sfx-skill-swerve','sfx-skill-jump','sfx-skill-slam','sfx-skill-stabilize']

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8', newline='\n')

def vector(body, color, accent, cream, motif=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><g fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{body}</g><g fill="{accent}" stroke="{color}" stroke-width="1.5">{motif}</g></svg>\n'

runpy.run_path(str(HERE / 'build-countdown.py'))['build_countdowns']()

for season, identifier in IDS.items():
    source = SPECS / 'release-input/ui/themes' / season
    vector_source = HERE / 'sources' / season
    output = APP / 'public/assets/themes' / identifier
    assets = output / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    is_xmas = season == 'christmas'
    Image.open(source / f'{season}.png').convert('RGB').save(assets / 'landing-hero.webp', 'WEBP', quality=88, method=6)
    for scene, filename in [('workshop', 'workshop-background'), ('ugc', 'scene-ugc')]:
        Image.open(source / f'scene-{scene}-source.png').convert('RGB').save(assets / f'{filename}.webp', 'WEBP', quality=88, method=6)
    if is_xmas:
        # One registered panel surface contains both the nine-slice outline and pencil grain.
        outline = (vector_source / 'pencil-outline.svg').read_text(encoding='utf-8')
        grain = (vector_source / 'pencil-grain.svg').read_text(encoding='utf-8')
        grain_body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', grain)
        outline = outline.replace('</svg>', f'<g opacity=".18" transform="translate(24 24) scale(.79 1.18)">{grain_body}</g></svg>')
        write(vector_source / 'panel-surface.svg', outline)
        copies = {'panel-surface.svg':'panel-surface.svg','christmas-holly.svg':'brand-emblem.svg','pencil-star.svg':'workshop-entry-icon.svg','christmas-gift.svg':'primary-action-decoration.svg'}
        color, accent, cream = '#36583c', '#a8443c', '#fffdf5'
        motif = '<path d="M113 13l6 12l14 2l-10 10l2 14l-12-7l-12 7l2-14l-10-10l14-2z"/>'
    else:
        write(vector_source / 'panel-surface.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><g fill="none" stroke="#b79362" opacity=".2" stroke-width=".7"><path d="M0 18h120M0 48h120M0 78h120M0 108h120M15 0v120M75 0v120"/><path d="M0 0l120 120M-30 0l120 120M30 0l120 120M0 60l60 60M60 0l60 60"/></g></svg>\n')
        copies = {'panel-surface.svg':'panel-surface.svg','pumpkin.svg':'brand-emblem.svg','hanging-bats.svg':'workshop-entry-icon.svg','bat.svg':'primary-action-decoration.svg'}
        ImageOps.pad(Image.open(source / 'empty-garage-illustration.png').convert('RGBA'), (640,360), color=(0,0,0,0)).save(assets / 'harvest-engraving.webp', 'WEBP', quality=82, method=6)
        color, accent, cream = '#e5c38b', '#f49a39', '#211726'
        motif = '<path d="M106 22l9-7l4 9l8-9l2 10l16 4l-10 8l-5-3l-5 7l-5-7l-6 3z"/>'
    for original, target in copies.items():
        shutil.copyfile(vector_source / original, assets / target)
    icons = {
        'core-loop-assembly': '<path d="M38 40h60v38H38zM48 32v8m40-8v8M30 48h8m60 0h8M50 50h36v18H50zM46 86h44"/><circle cx="43" cy="83" r="7"/><circle cx="94" cy="83" r="7"/>',
        'core-loop-tuning': '<path d="M35 35h60M35 60h60M35 85h60M48 28v14M80 53v14M58 78v14"/><circle cx="48" cy="35" r="6"/><circle cx="80" cy="60" r="6"/><circle cx="58" cy="85" r="6"/>',
        'core-loop-race': '<path d="M40 96V24q23-12 46 0v34q-23-12-46 0M40 35h46M40 47h46M55 20v35M70 20v35M30 97h30"/>',
        'empty-generic': '<path d="M28 48h78v48H28zM42 48V36h50v12M28 65h78M60 60h14v12H60zM40 84h20"/>',
        'empty-connection': '<path d="M24 84q26 0 26-20V50m-9-13v13h18V37m-18 3h18M84 84q-18 0-18-17M70 35l10 10m-3-17l10 10M61 26l4-10m28 38l11 3"/>',
        'empty-garage': '<path d="M22 95h94M28 95V42l39-24l39 24v53M43 95V54h48v41M51 65h32M51 76h32M51 87h32"/>',
    }
    for name, body in icons.items():
        svg = vector(body, '#61452e' if not is_xmas and name.startswith('core-loop') else color, accent, cream, motif)
        if name.startswith('core-loop'):
            # Match the original theme's visual vocabulary and small-icon stroke weight.
            svg = (APP / 'public/assets/themes/default/assets' / f'{name}.svg').read_text(encoding='utf-8')
            svg = svg.replace('#000', '#36583c' if is_xmas else '#61452e')
            badge = '<path d="M39 2l2 4l4 1l-3 3l1 4l-4-2l-4 2l1-4l-3-3l4-1z" fill="#a8443c" stroke="#36583c" stroke-width=".7"/>' if is_xmas else '<path d="M33 3l5 3l2-2l2 2l5-3l-2 8l-5-2l-5 2z" fill="#f49a39" stroke="#61452e" stroke-width=".7"/>'
            svg = svg.replace('</svg>', badge + '</svg>')
            write(vector_source / f'{name}.svg', svg)
            write(assets / f'{name}.svg', svg)
        elif is_xmas or name != 'empty-garage':
            empty_source = source / f'{name}-illustration.png'
            ImageOps.pad(Image.open(empty_source).convert('RGBA'), (640, 360), color=(0,0,0,0)).save(assets / f'{name}.webp', 'WEBP', quality=88, method=6)
    tokens = {
        '--color-bg-canvas':'#f7f4e9' if is_xmas else '#19131f',
        '--color-bg-surface':'#fffdf5' if is_xmas else '#292031',
        '--color-bg-surface-raised':'#eeeedd' if is_xmas else '#36283b',
        '--color-bg-elevated':'#fffdf5' if is_xmas else '#36283b',
        '--color-border-subtle':'#7a8964' if is_xmas else '#9a7256',
        '--color-text-primary':'#2c4533' if is_xmas else '#f6e6bf',
        '--color-text-secondary':'#52634d' if is_xmas else '#dcc5ad',
        '--color-text-muted':'#5c694f' if is_xmas else '#c3b09e',
        '--color-primary':'#375f43' if is_xmas else '#f4b955',
        '--color-text-on-accent':'#211726',
        '--color-accent-speed':'#a8443c' if is_xmas else '#f5a14a',
        '--color-accent-energy':'#876a28' if is_xmas else '#dcbd62',
        '--o4-panel-radius':'0.3rem 0.7rem 0.2rem 0.5rem' if is_xmas else '0.4rem',
        '--o4-card-radius':'0.35rem', '--o4-button-radius':'0.2rem 0.55rem 0.2rem 0.45rem' if is_xmas else '0.3rem',
        '--o4-button-bevel':'0rem','--o4-border-width':'1px',
        '--o4-panel-background':'#fffdf5' if is_xmas else '#292031',
        '--o4-panel-border':'#7a8964' if is_xmas else '#9a7256',
        '--o4-panel-shadow':'2px 4px 0 #b6af8b55' if is_xmas else '3px 4px 0 #0c0913',
        '--o4-control-surface':'#fffef7' if is_xmas else '#302337',
        '--o4-control-border':'#778563' if is_xmas else '#9a7256',
        '--o4-display-font':"'KaiTi', 'DFKai-SB', var(--font-family-base)" if is_xmas else 'var(--font-family-base)',
        '--o4-display-weight':'700' if is_xmas else '800', '--o4-display-letter-spacing':'0.015em',
        '--o4-display-transform':'none','--o4-hover-lift':'-1px','--o4-press-depth':'1px',
        '--o4-scene-overlay':'linear-gradient(180deg,#f7f4e9d9,#f7f4e9f2)' if is_xmas else 'linear-gradient(180deg,#19131fcc,#19131ff2)',
        '--o4-scene-filter':'saturate(.85)',
    }
    for key, value in {'black':'#f0ecdf' if is_xmas else '#16101d','steel-0':'#f7f4e9' if is_xmas else '#22182b','steel-1':'#fffdf5' if is_xmas else '#34263b','steel-2':'#d6d7c3' if is_xmas else '#5a4057','orange':'#a8443c' if is_xmas else '#f5a14a','orange-hot':'#923d36' if is_xmas else '#ffd078','blue':'#375f43' if is_xmas else '#dbb276','gold':'#876a28' if is_xmas else '#e6c987','ivory':'#2c4533' if is_xmas else '#f6e6bf','muted':'#52634d' if is_xmas else '#dcc5ad','frame':'#7a8964' if is_xmas else '#9a7256','panel-shadow':tokens['--o4-panel-shadow']}.items():
        tokens[f'--garage-{key}'] = value
    # 車庫背景圖的寬高比，以及展示台在圖中的位置、寬度（以圖寬高為 1）與觀看俯角（度）；車庫展示用它把車輛對到台面。
    tokens.update({'--garage-backdrop-aspect':'1.5','--garage-stand-x':'0.5' if is_xmas else '0.505','--garage-stand-y':'0.67' if is_xmas else '0.68','--garage-stand-width':'0.42' if is_xmas else '0.44','--garage-stand-elevation':'10' if is_xmas else '8'})
    assets_map = {key:'assets/landing-hero.webp' for key in ['landing-hero','garage-background','theme-preview','scene-home','scene-race-config','scene-race','scene-result','scene-ugc']}
    assets_map.update({key:'assets/workshop-background.webp' for key in ['garage-background','scene-race-config','scene-race']})
    assets_map['scene-ugc'] = 'assets/scene-ugc.webp'
    for name in ['3','2','1','start']:
        key = 'race-start' if name == 'start' else f'race-countdown-{name}'
        assets_map[key] = f'assets/race-countdown/{name}.webp'
        assets_map[f'{key}-static'] = f'assets/race-countdown/{name}-static.webp'
    assets_map.update({'landing-panel-pattern':'assets/panel-surface.svg','brand-emblem':'assets/brand-emblem.svg','workshop-entry-icon':'assets/workshop-entry-icon.svg','primary-action-decoration':'assets/primary-action-decoration.svg'})
    assets_map.update({key:f'assets/{key}.svg' if key.startswith('core-loop') else f'assets/{key}.webp' for key in icons})
    if not is_xmas:
        # Keep the registered empty-garage path; headings use the separate pumpkin emblem.
        assets_map['empty-garage'] = 'assets/harvest-engraving.webp'
    # 音訊檔由 美術資源/主題音訊 的產生器產出後放入 assets/audio，本腳本只登錄路徑、不產生也不刪除音檔。
    # 比賽以外的六個 BGM 槽共用首頁曲；保留槽與三個路面循環音不列，執行時沿用 default。
    for key in ['bgm-home','bgm-garage','bgm-editor','bgm-browse','bgm-room','bgm-race','bgm-result']:
        assets_map[key] = 'assets/audio/bgm-race.ogg' if key == 'bgm-race' else 'assets/audio/bgm-home.ogg'
    assets_map.update({key:f'assets/audio/{key}.ogg' for key in THEME_SFX_SLOTS})
    manifest = {
        'id':identifier,'styleApiVersion':1,'stylesheet':'theme.css',
        'name':dict(zip(['zh-TW','zh-CN','en','ja'], ['彩鉛聖誕工坊','彩铅圣诞工坊','Christmas Pencil Workshop','色鉛筆のクリスマス工房'] if is_xmas else ['萬聖節復古工坊','万圣节复古工坊','Halloween Harvest Workshop','ハロウィンのレトロ工房'])),
        'description':{'zh-TW':'以彩鉛筆觸、紙卡、松枝與紅緞帶構成的聖誕工坊。' if is_xmas else '美式復古萬聖節工坊，以雕刻南瓜、紙票券與蝙蝠翼點綴操作介面。','en':'Colored-pencil Christmas stationery, fir sprigs and ribbon, with neutral PBR vehicles.' if is_xmas else 'Vintage American Halloween tickets, engraved pumpkins and bat-wing accents.'},
        'traits':{'zh-TW':['彩鉛筆觸','聖誕紙卡','中性 PBR'] if is_xmas else ['美式萬聖節','復古票券','雕刻南瓜'],'en':['Colored pencil','Christmas stationery','Neutral PBR'] if is_xmas else ['American Halloween','Vintage tickets','Harvest engraving']},
        'previewAsset':'assets/landing-hero.webp','category':'seasonal','authors':['open4wd'],
        'renderProfile':BASE['renderProfile'],'tokens':tokens,'assets':assets_map,
    }
    manifest['description'].update({
        'zh-CN': '以彩铅笔触、纸卡、松枝与红缎带构成的圣诞工坊。' if is_xmas else '美式复古万圣节工坊，以雕刻南瓜、纸票券与蝙蝠翼点缀操作界面。',
        'ja': '色鉛筆の線、紙のカード、モミの枝、赤いリボンで彩るクリスマス工房。' if is_xmas else '彫刻風のカボチャ、紙のチケット、コウモリの翼で彩るアメリカン・レトロなハロウィン工房。',
    })
    manifest['traits'].update({
        'zh-CN': ['彩铅笔触', '圣诞纸卡', '中性 PBR'] if is_xmas else ['美式万圣节', '复古票券', '雕刻南瓜'],
        'ja': ['色鉛筆タッチ', 'クリスマスカード', 'ニュートラル PBR'] if is_xmas else ['アメリカン・ハロウィン', 'レトロチケット', '彫刻風カボチャ'],
    })
    write(output / 'theme.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    shutil.copyfile(vector_source / 'theme.css',output / 'theme.css')
    subprocess.run(['node', str(APP / 'node_modules/prettier/bin/prettier.cjs'), '--ignore-path', str(HERE / 'format-ignore'), '--write', str(output / 'theme.css'), str(output / 'theme.json')], cwd=APP, check=True)
    provenance = {'themeId':identifier,'approvedDesign':'Halloween v5 / Christmas v9','rasterOrigin':'OpenAI image_gen, approved in the seasonal-theme design conversation','vectorOrigin':'Project-authored SVG; no external references','rasterConversion':{'tool':'Pillow','format':'WebP','quality':88,'method':6},'fallback':'Theme audio is registered from assets/audio; reserved gameplay SFX and the three surface loops inherit default. All visual slots have local assets. Reserved gameplay tokens and neutral PBR are unchanged.','files':{p.relative_to(output).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.rglob('*')) if p.is_file()}}
    write(HERE / 'records' / f'{season}-build-manifest.json',json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
    print(identifier, sum(p.stat().st_size for p in output.rglob('*') if p.is_file()), 'bytes')
