# -*- coding: utf-8 -*-
"""Open4WD 主題音訊產生器（純程式合成，第二版：依 風格設定.md）。

以 Blender 內建 Python 執行（numpy 合成、aud 模組離線編碼 Ogg Opus）：
    blender --background --factory-startup --python generate.py -- --only <主題 id>   產生單一主題
    blender --background --factory-startup --python generate.py -- --merge            合併各主題片段成 manifest.json

不讀任何外部音訊；旋律、節奏與音色全部由演算法依固定種子產生，可重跑。
輸出：<主題>/bgm|se/<槽位>.ogg、loop-check/<主題>/<槽位>-x2.ogg 與 -seam.ogg、manifest.json。
"""
import hashlib
import json
import math
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import synth as S  # noqa: E402

SR = S.SR
GENERATOR_VERSION = 2

BGM_SLOTS = ['bgm-home', 'bgm-garage', 'bgm-editor', 'bgm-browse', 'bgm-room', 'bgm-race', 'bgm-result']
SFX_SLOTS = [
    'sfx-click', 'sfx-confirm', 'sfx-cancel', 'sfx-error', 'sfx-toast',
    'sfx-countdown', 'sfx-race-start', 'sfx-checkpoint', 'sfx-race-finish',
    'sfx-part-broken', 'sfx-elimination',
    'sfx-motor-loop', 'sfx-surface-hard', 'sfx-surface-loose', 'sfx-surface-slippery',
    'sfx-collision-light', 'sfx-collision-heavy',
    'sfx-weapon-melee-launch', 'sfx-weapon-melee-impact',
    'sfx-weapon-projectile-launch', 'sfx-weapon-projectile-impact',
    'sfx-skill-boost', 'sfx-skill-brake', 'sfx-skill-swerve', 'sfx-skill-jump',
    'sfx-skill-slam', 'sfx-skill-stabilize',
]
RESERVED_SFX = ['sfx-countdown', 'sfx-race-start', 'sfx-part-broken', 'sfx-elimination']
LOOP_SFX = ['sfx-motor-loop', 'sfx-surface-hard', 'sfx-surface-loose', 'sfx-surface-slippery']
# 只有 default 提供的槽位：路面聲是物理材質的聲音，跨主題差異很小，節慶主題不產出、執行時沿用 default
DEFAULT_ONLY_SFX = ['sfx-surface-hard', 'sfx-surface-loose', 'sfx-surface-slippery']
DEFAULT_ONLY_NOTE = '節慶主題不提供、執行時沿用 default'
BGM_BITRATE = 96000
SFX_BITRATE = 64000
THEME_AUDIO_MAX_BYTES = 20 * 1024 * 1024

# ───────────────────────── 樂理 ─────────────────────────

NOTE_PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
           'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
CHORD_IV = {'': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7],
            '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11]}
SCALES = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'harm': [0, 2, 3, 5, 7, 8, 11],
          'pent': [0, 2, 4, 7, 9]}


def chord(name):
    root = name[:2] if len(name) > 1 and name[1] in '#b' else name[:1]
    return NOTE_PC[root], CHORD_IV[name[len(root):]]


def note(name):
    return 12 * (int(name[-1]) + 1) + NOTE_PC[name[:-1]]


def line(text):
    """'bar:beat:dur:note …' → [(bar, beat, dur, midi)]。"""
    out = []
    for tok in text.split():
        b, p, d, n = tok.split(':')
        out.append((int(b), float(p), float(d), note(n)))
    return out


# ───────────────────────── 主題設定（對應 風格設定.md） ─────────────────────────

ARP4 = {
    'alt': [(0, 0), (1, 2), (1.5, 1), (2.5, 3), (3, 2), (3.5, 1)],
    'busy': [(0, 0), (.5, 1), (1, 2), (1.5, 3), (2, 2), (2.5, 1), (3, 2), (3.5, 3)],
    'sparse': [(0, 0), (2, 2)],
    'ost': [(0, 0), (.75, 0), (1.5, 2), (2.5, 0), (3, 2)],
}
ARP3 = {
    'alt': [(0, 0), (1, 2), (1.5, 1), (2, 3)],
    'busy': [(0, 0), (.5, 2), (1, 1), (1.5, 3), (2, 2), (2.5, 3)],
    'sparse': [(0, 0), (1.5, 2)],
    'ost': [(0, 0), (1, 0), (1.5, 2), (2, 0)],
}

THEMES = {
    'default': {
        'style': '帶放克律動的工坊電聲小編制',
        'key': 'E', 'scale': 'minor', 'beats': 4, 'phrase_bars': 4, 'swing': 0.5, 'rev': (0.9, 0.16),
        'motif': line('0:0:.5:E5 0:.5:.5:G5 0:1:.5:A5 0:1.5:1.5:B5 0:3.5:.5:D6 '
                      '1:0:.5:D6 1:.5:.5:B5 1:1:.5:A5 1:1.5:2:G5 2:0:1.5:A5 2:1.5:2.5:E5 '
                      '3:2:.5:B4 3:2.5:.5:D5 3:3:1:E5'),
        'prog': {'H': 'Em G Am7 D', 'A': 'Em C G D', 'B': 'C D Em G Am C D D', 'C': 'Am7 Em C D Am7 C D D',
                 'M': 'G D Em C', 'T': 'Em C Am7 D'},
        'inst': {'lead': 'epiano', 'arp': 'guitar_mute', 'pad': 'pad_warm', 'bass': 'ebass', 'bell': 'vibes',
                 'tick': 'metal_tick'},
        'base': {'arp': 52, 'pad': 52, 'bass': 38, 'bell': 76, 'tick': 96},
        'arp_std': [(0.5, 0), (1.5, 1), (2.5, 2), (2.75, 1), (3.5, 3)],
        'bass_std': [(0, .9, 0), (1.5, .45, 0), (2, .9, 0), (3.5, .45, 12)], 'kit': 'kit',
        'targets': {'lead': 0, 'arp': -9, 'pad': -12, 'bass': -5, 'drums': -5, 'orn': -11},
        'slots': {'bgm-home': (118, 0, 90, {}), 'bgm-garage': (100, 5, 165, {}), 'bgm-editor': (84, 0, 180, {}),
                  'bgm-browse': (110, 0, 120, {'H': 'M'}), 'bgm-room': (126, 0, 120, {}),
                  'bgm-race': (164, 0, 120, {}), 'bgm-result': (120, 0, 52, {'H': 'M'})},
        'sfx': {'pm': 1.0, 'click': 'metal_tick', 'ui': 'vibes', 'toast': 'vibes', 'err': 'epiano', 'cue': 'epiano',
                'acc': 'vibes', 'root': 76, 'up': [0, 7], 'tri': [0, 4, 7, 12], 'down': [12, 7, 3, 0], 'clash': 1,
                'final': [7, 11, 14, 19], 'rev': (0.5, 0.10)},
    },
    'christmas-workshop-2026-75fe9c': {
        'style': '玩具工坊的搖擺小品',
        'key': 'F', 'scale': 'major', 'beats': 4, 'phrase_bars': 4, 'swing': 0.62, 'rev': (1.4, 0.26),
        'motif': line('0:0:1:A5 0:1:1:C6 0:2:1:D6 0:3:1:C6 1:0:2:F6 1:2:1:D6 1:3:1:C6 '
                      '2:0:1:A5 2:1:1:G5 2:2:1:F5 2:3:1:G5 3:0:4:C6'),
        'prog': {'H': 'F Bb F C', 'A': 'F Dm Bb C', 'B': 'Dm Bb F C Dm Gm C C', 'C': 'Bb C Am Dm Bb C F C',
                 'T': 'F Dm Gm C'},
        'inst': {'lead': 'glock', 'arp': 'celesta', 'pad': 'pad_soft', 'bass': 'upright', 'bell': 'handbell',
                 'tick': 'musicbox'},
        'base': {'arp': 65, 'pad': 53, 'bass': 38, 'bell': 72, 'tick': 89},
        'arp_std': [(0, 0), (.5, 1), (1, 2), (1.5, 1), (2, 3), (2.5, 1), (3, 2), (3.5, 1)],
        'bass_std': [(0, 1.8, 0), (2, 1.6, 7)], 'kit': 'sleigh',
        'targets': {'lead': 0, 'arp': -9, 'pad': -12, 'bass': -5, 'drums': -8, 'orn': -9},
        'slots': {'bgm-home': (104, 0, 90, {}), 'bgm-garage': (92, 5, 165, {}), 'bgm-editor': (76, 0, 180, {}),
                  'bgm-browse': (108, -5, 120, {}), 'bgm-room': (116, 0, 120, {}), 'bgm-race': (152, -3, 120, {}),
                  'bgm-result': (112, 0, 52, {})},
        'sfx': {'pm': 1.25, 'click': 'musicbox', 'ui': 'musicbox', 'toast': 'handbell', 'err': 'celesta',
                'cue': 'glock', 'acc': 'handbell', 'root': 84, 'up': [0, 7], 'tri': [0, 4, 7, 12],
                'down': [12, 9, 5, 0], 'clash': 2, 'final': [0, 4, 7, 12], 'rev': (1.0, 0.25)},
    },
    'halloween-workshop-2026-a9028c': {
        'style': '老式遊樂園圓舞曲',
        'key': 'D', 'scale': 'harm', 'beats': 3, 'phrase_bars': 8, 'swing': 0.5, 'rev': (1.8, 0.3),
        'motif': line('0:0:1:D5 0:1:1:F5 0:2:1:A5 1:0:2:C#5 1:2:1:D5 2:0:1:Bb5 2:1:1:A5 2:2:1:F5 3:0:2:E5 3:2:1:D5 '
                      '4:0:1:A5 4:1:1:D6 4:2:1:A5 5:0:2:G5 5:2:1:Bb5 6:0:1:A5 6:1:1:G5 6:2:1:E5 7:0:3:D5'),
        'prog': {'H': 'Dm A Bb A Dm Gm A7 Dm', 'A': 'Dm Dm Gm A Dm Bb Gm A', 'B': 'Gm Gm Dm Dm Edim Edim A A7',
                 'C': 'Bb Bb F F Gm Gm A A7', 'T': 'Dm Dm Gm Gm Bb Bb A A7'},
        'inst': {'lead': 'theremin', 'arp': 'harpsi', 'pad': 'organ', 'bass': 'organ_pedal', 'bell': 'tubular',
                 'tick': 'harpsi'},
        'base': {'arp': 57, 'pad': 50, 'bass': 38, 'bell': 62, 'tick': 81},
        'arp_std': [(0, 0), (.5, 1), (1, 2), (1.5, 3), (2, 2), (2.5, 1)],
        'bass_std': [(0, 2.6, 0)], 'kit': 'spooky',
        'targets': {'lead': -1, 'arp': -8, 'pad': -10, 'bass': -6, 'drums': -6, 'orn': -9},
        'slots': {'bgm-home': (138, 0, 90, {}), 'bgm-garage': (120, 5, 165, {}), 'bgm-editor': (96, 0, 180, {}),
                  'bgm-browse': (132, -5, 120, {}), 'bgm-room': (150, 0, 120, {}), 'bgm-race': (144, 0, 120, {}),
                  'bgm-result': (126, 0, 52, {})},
        'race_meter': '6/8',  # 比賽曲：6/8 快板（每小節兩個附點四分音符拍，速度以附點四分音符計）
        'sfx': {'pm': 0.8, 'click': 'harpsi', 'ui': 'harpsi', 'toast': 'tubular', 'err': 'harpsi', 'cue': 'organ',
                'acc': 'tubular', 'click_semi': 0, 'click_body': 'bones', 'click_lp': 5000, 'root': 74, 'up': [0, 7], 'tri': [0, 3, 7, 12], 'down': [12, 8, 6, 0], 'clash': 6,
                'final': [0, 4, 7, 12], 'rev': (1.4, 0.3)},
    },
    'moon-rabbit-workshop-2026-97c954': {
        'style': '東方五聲的月夜小品',
        'key': 'D', 'scale': 'pent', 'beats': 4, 'phrase_bars': 4, 'swing': 0.54, 'rev': (1.6, 0.28),
        'motif': line('0:0:1:A4 0:1:1:B4 0:2:1:D5 0:3:1:B4 1:0:1:A4 1:1:1:F#4 1:2:2:E4 '
                      '2:0:1:D4 2:1:1:E4 2:2:1:F#4 2:3:1:A4 3:0:2:B4 3:2:2:A4'),
        'prog': {'H': 'D Bm G Asus4', 'A': 'D G Bm Asus4', 'B': 'Bm G D Asus4 Bm G Em Asus4',
                 'C': 'G D Em Bm G D Asus4 Asus4', 'N': 'Bm G D Asus4', 'T': 'D Bm Em Asus4'},
        'inst': {'lead': 'zheng', 'arp': 'marimba', 'pad': 'pad_soft', 'bass': 'upright', 'bell': 'bowl',
                 'tick': 'ceramic'},
        'base': {'arp': 50, 'pad': 50, 'bass': 38, 'bell': 62, 'tick': 86},
        'arp_std': [(0, 0), (.5, 2), (1.5, 1), (2, 3), (2.5, 2), (3.5, 1)],
        'bass_std': [(0, 1.5, 0), (2.5, .5, 7), (3, 1, 0)], 'kit': 'wood',
        'targets': {'lead': 0, 'arp': -9, 'pad': -12, 'bass': -5, 'drums': -7, 'orn': -10},
        'slots': {'bgm-home': (88, 0, 90, {}), 'bgm-garage': (80, 5, 165, {}), 'bgm-editor': (66, 0, 180, {}),
                  'bgm-browse': (92, -5, 120, {}), 'bgm-room': (100, 0, 120, {'H': 'N'}),
                  'bgm-race': (144, 2, 120, {'H': 'N'}), 'bgm-result': (96, 0, 52, {})},
        'sfx': {'pm': 1.1, 'click': 'ceramic', 'ui': 'ceramic', 'toast': 'bowl', 'err': 'zheng', 'cue': 'zheng',
                'acc': 'zheng', 'root': 81, 'up': [0, 5], 'tri': [0, 2, 5, 9], 'down': [9, 7, 2, 0], 'clash': 1,
                'final': [0, 4, 7, 12], 'rev': (1.2, 0.25)},
    },
}

# 段落模板：(名稱, 比例, 和弦進行, 主旋律模式, 主旋律由誰演奏, 琶音模式, 低音模式, 鼓強度, 點綴密度)
# 主旋律模式：full 完整動機／oct 高八度／harm 加平行聲部／answer 倒影應答／frag 片段／rhythm 節奏型固定音／
#             dim 加快或模進／aug 拉長一倍／free 依和弦生成的對比旋律／none 無
SECTIONS = {
    'bgm-home': [
        ('intro', .09, 'H', 'none', 'lead', 'sparse', 'long', -1, 1),
        ('A1', .18, 'H', 'full', 'lead', 'std', 'std', 1, 1),
        ('A2', .18, 'A', 'answer', 'lead', 'std', 'std', 2, 0),
        ('B', .18, 'B', 'free', 'lead', 'alt', 'std', 2, 1),
        ('A3', .18, 'H', 'harm', 'lead', 'busy', 'std', 2, 2),
        ('C', .10, 'C', 'frag', 'arp', 'off', 'long', 0, 1),
        ('turn', .09, 'T', 'none', 'lead', 'sparse', 'long', -1, 1),
    ],
    'bgm-garage': [
        ('intro', .08, 'H', 'none', 'lead', 'off', 'std', -1, 0),
        ('G1', .16, 'H', 'aug', 'arp', 'off', 'std', 1, 1),
        ('G2', .14, 'A', 'frag', 'lead', 'std', 'std', 1, 0),
        ('B', .14, 'B', 'free', 'arp', 'off', 'std', 1, 1),
        ('G3', .16, 'H', 'full', 'lead', 'alt', 'std', 1, 1),
        ('break', .10, 'C', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('G4', .14, 'A', 'answer', 'lead', 'std', 'std', 1, 0),
        ('turn', .08, 'T', 'none', 'lead', 'sparse', 'std', -1, 1),
    ],
    'bgm-editor': [
        ('e1', .14, 'H', 'none', 'lead', 'off', 'long', -1, 2),
        ('e2', .14, 'A', 'none', 'lead', 'sparse', 'long', -1, 0),
        ('e3', .14, 'B', 'frag', 'arp', 'off', 'long', -1, 1),
        ('e4', .14, 'C', 'none', 'lead', 'off', 'off', -1, 2),
        ('e5', .16, 'H', 'frag', 'arp', 'sparse', 'long', -1, 0),
        ('e6', .14, 'B', 'none', 'lead', 'sparse', 'long', -1, 1),
        ('turn', .14, 'T', 'none', 'lead', 'off', 'long', -1, 2),
    ],
    'bgm-browse': [
        ('intro', .08, 'H', 'none', 'lead', 'std', 'long', -1, 1),
        ('A1', .18, 'H', 'answer', 'lead', 'std', 'std', 1, 0),
        ('A2', .16, 'A', 'full', 'lead', 'alt', 'std', 1, 1),
        ('B', .16, 'B', 'free', 'lead', 'std', 'std', 1, 0),
        ('A3', .18, 'H', 'oct', 'lead', 'busy', 'std', 1, 2),
        ('C', .12, 'C', 'frag', 'arp', 'off', 'long', -1, 1),
        ('turn', .12, 'T', 'none', 'lead', 'std', 'long', 0, 1),
    ],
    'bgm-room': [
        ('intro', .10, 'H', 'none', 'lead', 'ost', 'off', -1, 0),
        ('r1', .18, 'H', 'none', 'lead', 'ost', 'pulse', 1, 1),
        ('r2', .18, 'A', 'rhythm', 'lead', 'ost', 'pulse', 2, 0),
        ('r3', .16, 'B', 'free', 'lead', 'alt', 'std', 2, 1),
        ('r4', .18, 'H', 'full', 'lead', 'busy', 'std', 2, 1),
        ('break', .10, 'C', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('turn', .10, 'T', 'none', 'lead', 'ost', 'off', -1, 0),
    ],
    'bgm-race': [
        ('intro', .07, 'H', 'none', 'lead', 'ost', 'drive', 1, 0),
        ('A1', .17, 'H', 'dim', 'lead', 'busy', 'drive', 3, 0),
        ('A2', .15, 'A', 'answer', 'lead', 'busy', 'drive', 3, 1),
        ('B', .15, 'B', 'free', 'lead', 'alt', 'drive', 3, 0),
        ('A3', .17, 'H', 'harm', 'lead', 'busy', 'drive', 3, 1),
        ('break', .10, 'C', 'frag', 'lead', 'ost', 'pulse', 1, 2),
        ('A4', .12, 'A', 'full', 'lead', 'busy', 'drive', 3, 1),
        ('turn', .07, 'T', 'none', 'lead', 'ost', 'drive', 1, 0),
    ],
    'bgm-result': [
        ('fanfare', .17, 'H', 'harm', 'lead', 'std', 'std', 2, 2),
        ('A', .30, 'A', 'full', 'lead', 'busy', 'std', 2, 1),
        ('B', .23, 'C', 'answer', 'lead', 'alt', 'std', 1, 1),
        ("A'", .18, 'H', 'oct', 'lead', 'busy', 'std', 2, 2),
        ('turn', .12, 'T', 'rhythm', 'lead', 'std', 'std', 2, 1),
    ],
}

# 各主題自己的段落編排（home 與 race）：段落順序、主旋律進場位置、break 位置與鼓的強弱各自設計。
# 沒列在這裡的（default 的全部、其餘五個槽位）用上面的共用範本。
# 安靜段落的位置刻意錯開：default 在頭尾，christmas 在中段，halloween 在中後段，moon-rabbit 在前段。
_X, _H, _M = 'christmas-workshop-2026-75fe9c', 'halloween-workshop-2026-a9028c', 'moon-rabbit-workshop-2026-97c954'
THEME_SECTIONS = {
    # christmas：鐘琴一開頭就把動機完整奏出 → 中段抽掉鼓與主旋律 → 高八度再現 → 帶著主旋律直接接回開頭
    (_X, 'bgm-home'): [
        ('A1', .20, 'H', 'full', 'lead', 'std', 'std', 1, 2),
        ('A2', .20, 'A', 'harm', 'lead', 'busy', 'std', 2, 1),
        ('break', .20, 'C', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('B', .10, 'B', 'frag', 'arp', 'off', 'long', 0, 1),
        ('A3', .20, 'H', 'oct', 'lead', 'alt', 'std', 2, 1),
        ('turn', .10, 'T', 'answer', 'lead', 'busy', 'std', 2, 1),
    ],
    # halloween：大鍵琴先用動機的節奏起頭、再把動機整段奏出；特雷門到接近一半才進場；
    #            break 放在特雷門兩次呈現之間；結尾回到開頭的大鍵琴節奏
    (_H, 'bgm-home'): [
        ('vamp', .11, 'H', 'rhythm', 'arp', 'off', 'std', 1, 1),
        ('H1', .22, 'H', 'full', 'arp', 'off', 'std', 1, 0),
        ('B', .11, 'B', 'free', 'arp', 'off', 'std', 2, 1),
        ('T1', .22, 'H', 'full', 'lead', 'std', 'std', 2, 1),
        ('break', .12, 'C', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('T2', .11, 'A', 'harm', 'lead', 'busy', 'std', 2, 2),
        ('turn', .11, 'T', 'rhythm', 'arp', 'off', 'std', 1, 1),
    ],
    # moon-rabbit：箏先獨自奏出動機（只有輕打擊）→ 很早就進入只剩缽與木琴的留白 → 逐段加厚 → 應答句接回開頭
    (_M, 'bgm-home'): [
        ('A1', .125, 'H', 'full', 'lead', 'sparse', 'long', 0, 1),
        ('break', .25, 'C', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('B', .125, 'B', 'free', 'lead', 'alt', 'std', 1, 0),
        ('A2', .25, 'H', 'harm', 'lead', 'busy', 'std', 2, 1),
        ('A3', .125, 'A', 'oct', 'lead', 'std', 'std', 2, 1),
        ('turn', .125, 'T', 'answer', 'lead', 'sparse', 'long', 0, 1),
    ],
    # christmas：全編制直接開場 → 約四分之一處只留雪橇鈴與固定音型 → 對比段 → 高八度 → 一個樂句的急停 → 最長的完整動機收尾
    (_X, 'bgm-race'): [
        ('A1', .16, 'H', 'dim', 'lead', 'busy', 'drive', 3, 1),
        ('A2', .10, 'A', 'harm', 'lead', 'busy', 'drive', 3, 0),
        ('break', .11, 'C', 'none', 'lead', 'ost', 'pulse', 0, 2),
        ('B', .16, 'B', 'free', 'lead', 'alt', 'drive', 2, 0),
        ('A3', .11, 'H', 'oct', 'lead', 'busy', 'drive', 3, 1),
        ('stop', .05, 'T', 'none', 'lead', 'sparse', 'long', -1, 2),
        ('A4', .21, 'A', 'full', 'lead', 'busy', 'drive', 3, 1),
        ('turn', .10, 'T', 'answer', 'lead', 'busy', 'drive', 3, 0),
    ],
    # halloween（6/8）：大鍵琴與定音鼓先跑三個樂句、特雷門才進場 → 正中間留一段只剩骨頭敲擊與風琴 →
    #                  對比段 → 最長的加平行聲部段落 → 回到大鍵琴節奏
    (_H, 'bgm-race'): [
        ('ride', .17, 'H', 'rhythm', 'arp', 'off', 'drive', 2, 0),
        ('A1', .17, 'H', 'full', 'lead', 'busy', 'drive', 3, 1),
        ('A2', .11, 'A', 'answer', 'lead', 'busy', 'drive', 3, 0),
        ('break', .11, 'C', 'none', 'lead', 'ost', 'pulse', 0, 2),
        ('B', .11, 'B', 'free', 'lead', 'alt', 'drive', 2, 1),
        ('A3', .22, 'H', 'harm', 'lead', 'busy', 'drive', 3, 1),
        ('turn', .11, 'T', 'rhythm', 'arp', 'off', 'drive', 2, 0),
    ],
    # moon-rabbit：箏直接奏加快的動機 → 第三個樂句起就抽薄成木魚與固定音型 → 應答 → 對比段 →
    #              最長的加平行聲部段落 → 高八度 → 應答句接回開頭
    (_M, 'bgm-race'): [
        ('A1', .11, 'H', 'dim', 'lead', 'busy', 'drive', 2, 1),
        ('break', .11, 'C', 'none', 'lead', 'ost', 'pulse', 0, 2),
        ('A2', .17, 'A', 'answer', 'lead', 'busy', 'drive', 3, 0),
        ('B', .17, 'B', 'free', 'lead', 'alt', 'drive', 3, 1),
        ('A3', .22, 'H', 'harm', 'lead', 'busy', 'drive', 3, 1),
        ('A4', .11, 'A', 'oct', 'lead', 'busy', 'drive', 2, 1),
        ('turn', .11, 'T', 'answer', 'lead', 'busy', 'drive', 2, 0),
    ],
}

# 6/8（一小節兩個附點四分音符拍；拍內三等分）用的音型
ARP68 = {
    'alt': [(0, 0), (2 / 3, 2), (1, 1), (5 / 3, 3)],
    'busy': [(0, 0), (1 / 3, 1), (2 / 3, 2), (1, 3), (4 / 3, 2), (5 / 3, 1)],
    'sparse': [(0, 0), (1, 2)],
    'ost': [(0, 0), (2 / 3, 0), (1, 2), (5 / 3, 0)],
}

RHYTHMS = {
    '6/8': {'dense': [[2 / 3, 1 / 3, 2 / 3, 1 / 3], [2 / 3, 2 / 3, 2 / 3], [2 / 3, 1 / 3, 1], [1, 2 / 3, 1 / 3]],
            'medium': [[1, 1], [2 / 3, 2 / 3, 2 / 3], [2], [4 / 3, 2 / 3]],
            'sparse': [[2], [1, 1], [-2], [2]]},
    4: {'dense': [[1, .5, .5, 1, 1], [.5, .5, .5, .5, 1, 1], [1.5, .5, 1, 1], [.5, .5, 1, .5, .5, 1]],
        'medium': [[2, 1, 1], [1, 1, 2], [1.5, .5, 2], [1, 1, 1, 1], [3, 1]],
        'sparse': [[4], [2, 2], [3, 1], [-4]]},
    3: {'dense': [[1, .5, .5, 1], [.5, .5, .5, .5, 1], [1, 1, 1], [1.5, .5, 1]],
        'medium': [[2, 1], [1, 2], [1, 1, 1], [3]],
        'sparse': [[3], [2, 1], [-3], [3]]},
}
STEPS = [-2, -1, -1, 0, 1, 1, 2, 3, -3]


# ───────────────────────── 鼓型 ─────────────────────────

def drum_pattern(kit, level, beats, fill, compound=False):
    """回傳一小節的 [(拍位, 鼓名, 力度)]；level 0＝只留輕打擊；fill＝段落最後一小節的過門。"""
    ev = []
    if level < 0:
        return ev
    if compound:  # 6/8：骨頭敲擊跑六個八分音符（重音在兩個大拍），定音鼓落在小節頭
        t = 1 / 3
        if level == 0:
            return [(0, 'bones', .5), (2 * t, 'bones', .3), (1, 'bones', .45), (5 * t, 'bones', .3)]
        ev += [(0, 'timp', 1.0)]
        ev += [(i * t, 'bones', .85 if i % 3 == 0 else .45) for i in range(6)]
        if level >= 2:
            ev += [(1, 'snare', .9), (5 * t, 'timp', .55)]
        if level >= 3:
            ev += [(0, 'kick', 1.0), (2 * t, 'kick', .6), (1, 'kick', .8)]
        if fill:
            ev += [(1, 'timp', .7), (4 * t, 'timp', .8), (5 * t, 'timp', .9), (2 * t, 'ratchet', .7)]
        return ev
    if kit == 'kit':
        if level == 0:
            return [(i * .5, 'hat', .5 if i % 2 else .3) for i in range(beats * 2)]
        ev += [(b, 'kick', 1.0 if b == 0 else .8) for b in {1: [0, 2], 2: [0, 1.5, 2], 3: [0, 1, 2, 3]}[level]]
        if level >= 2:
            ev += [(1, 'snare', .85), (3, 'snare', 1.0)]
        step = 0.25 if level >= 3 else 0.5
        for i in range(int(beats / step)):
            b = i * step
            ev.append((b, 'hat', 1.0 if b % 1 == 0.5 else (0.7 if b % 0.5 == 0 else 0.4)))
        if level >= 3:
            ev += [(1.5, 'ohat', .7), (3.5, 'ohat', .7)]
        if fill and level >= 2:
            ev += [(3.25, 'snare', .55), (3.5, 'snare', .7), (3.75, 'snare', .85)]
    elif kit == 'sleigh':
        if level == 0:
            return [(i, 'sleigh', .6) for i in range(beats)]
        ev += [(i * .5, 'sleigh', 1.0 if i % 2 == 0 else .55) for i in range(beats * 2)]
        ev += [(0, 'softkick', 1.0), (2, 'softkick', .8)] if level < 3 else [(b, 'softkick', 1.0) for b in range(beats)]
        if level >= 2:
            ev += [(1, 'brush', .9), (3, 'brush', 1.0)]
        if level >= 3:
            ev += [(i * .5 + .25, 'sleigh', .35) for i in range(beats * 2)]
        if fill:
            ev += [(3, 'brush', .6), (3.5, 'brush', .8), (3.5, 'tri', .7)]
    elif kit == 'spooky':
        if beats == 3:
            if level == 0:
                return [(1, 'bones', .5), (2, 'bones', .4)]
            ev += [(0, 'timp', 1.0), (1, 'bones', .8), (2, 'bones', .6)]
            if level >= 2:
                ev += [(2, 'brush', .7), (1.5, 'bones', .4)]
            if fill:
                ev += [(2, 'timp', .6), (2.5, 'timp', .75), (1.5, 'ratchet', .7)]
        else:
            if level == 0:
                return [(i * .5, 'bones', .5 if i % 2 else .3) for i in range(8)]
            ev += [(0, 'timp', 1.0), (2, 'timp', .7)]
            ev += [(i * .5, 'bones', .8 if i % 2 else .45) for i in range(8)]
            if level >= 2:
                ev += [(1, 'snare', .8), (3, 'snare', .9)]
            if level >= 3:
                ev += [(0, 'kick', 1.0), (1.5, 'kick', .7), (2, 'kick', .9), (3.5, 'kick', .6)]
            if fill:
                ev += [(3, 'timp', .7), (3.5, 'timp', .8), (3.75, 'timp', .9), (2.5, 'ratchet', .7)]
    elif kit == 'wood':
        if level == 0:
            return [(1.5, 'wood', .5), (3.5, 'woodlo', .4)]
        ev += [(0, 'frame', 1.0), (2, 'frame', .7), (1.5, 'wood', .8), (3, 'woodlo', .6)]
        if level < 3:
            ev += [(i + .5, 'shaker', .4) for i in range(4)]  # 輕沙鈴補高頻
        if level >= 2:
            ev += [(.5, 'woodlo', .5), (2.5, 'wood', .6), (3.5, 'wood', .7)]
        if level >= 3:
            ev += [(i * .5, 'shaker', 1.0 if i % 2 else .6) for i in range(8)]
            ev += [(1, 'frame', .6), (3, 'frame', .6), (2.75, 'wood', .5)]
        if fill:
            ev += [(3, 'wood', .6), (3.25, 'woodlo', .6), (3.5, 'wood', .75), (3.75, 'frame', .7)]
    return [e for e in ev if e[0] < beats]


# ───────────────────────── BGM 編曲 ─────────────────────────

class Stem:
    """循環匯流排（float32）：超出尾端的聲音回捲到開頭，是無縫循環的基礎。"""

    def __init__(self, n):
        self.n = n
        self.l = np.zeros(n, dtype=np.float32)
        self.r = np.zeros(n, dtype=np.float32)

    def _wrap(self, buf, sig, start):
        start %= self.n
        while len(sig):
            m = min(len(sig), self.n - start)
            buf[start:start + m] += sig[:m]
            sig = sig[m:]
            start = 0

    def add(self, sig, start, gain=1.0, pan=0.0):
        if sig.ndim == 2:
            left, right = sig[:, 0] * (gain * min(1.0, 1 - pan)), sig[:, 1] * (gain * min(1.0, 1 + pan))
        else:
            a = (pan + 1) * math.pi / 4
            left, right = sig * (gain * math.cos(a)), sig * (gain * math.sin(a))
        self._wrap(self.l, left.astype(np.float32), start)
        self._wrap(self.r, right.astype(np.float32), start)


SENDS = {'lead': 0.3, 'arp': 0.3, 'pad': 0.4, 'bass': 0.04, 'drums': 0.1, 'orn': 0.45}


def mix_stems(stems, targets, rng, tau, wet):
    n = next(iter(stems.values())).n
    left = np.zeros(n)
    right = np.zeros(n)
    send = np.zeros(n)
    gains = {}
    for name, st in stems.items():
        if max(np.abs(st.l).max(), np.abs(st.r).max()) < 1e-9:
            continue
        g = 10 ** ((targets[name] - S.lufs(np.stack([st.l, st.r], axis=1).astype(np.float64))) / 20)
        gains[name] = round(S.db(g), 2)
        left += st.l * g
        right += st.r * g
        send += (st.l + st.r) * (0.5 * g * SENDS[name])
    spec = np.fft.rfft(send)
    outs = []
    helper = Stem(n)
    for dry, ir in zip((left, right), S.reverb_ir(rng, tau, 6.0 * SR)):
        folded = np.zeros(n)
        helper._wrap(folded, ir, 0)  # 殘響脈衝響應摺進循環長度 → 循環卷積，尾音自動接回開頭
        outs.append(dry + wet * np.fft.irfft(spec * np.fft.rfft(folded), n))
    return np.stack(outs, axis=1), gains


def convert_meter_3_to_68(motif):
    """3/4 動機放進 6/8 小節（萬聖節比賽曲用）：原本的三個四分音符平均落在一小節的兩個大拍上。

    旋律維持三拍子的走法，伴奏跑 6/8 的三連八分音符，兩者形成三對二，聽起來仍帶圓舞曲感。
    """
    return [(bar, beat * 2 / 3, dur * 2 / 3, midi) for bar, beat, dur, midi in motif]


def render_bgm(theme, slot):
    T = THEMES[theme]
    bpm, tr, target, sub = T['slots'][slot]
    beats = T['beats']
    motif = T['motif']
    compound = slot == 'bgm-race' and T.get('race_meter') == '6/8'
    if compound:
        beats = 2
        motif = convert_meter_3_to_68(motif)
    sub_beat = 1 / 3 if compound else 0.5  # 拍內的細分單位
    pb = T['phrase_bars']
    spb = 60.0 / bpm
    phrase_beats = pb * beats
    phrase_sec = phrase_beats * spb
    rng = S.rng_for(theme, slot, GENERATOR_VERSION)

    # 段落配置：依比例分配樂句數
    tmpl = THEME_SECTIONS.get((theme, slot), SECTIONS[slot])
    total = max(len(tmpl), round(target / phrase_sec))
    counts = [max(1, round(f * total)) for _, f, *_ in tmpl]
    while sum(counts) != total:
        i = int(np.argmax(counts)) if sum(counts) > total else int(np.argmax([f for _, f, *_ in tmpl]))
        counts[i] += -1 if sum(counts) > total else 1
    for i, sec in enumerate(tmpl):
        if sec[3] == 'aug' and counts[i] % 2:
            counts[i] += 1
    bars_total = sum(counts) * pb
    n = int(round(bars_total * beats * spb * SR))

    keypc = (NOTE_PC[T['key']] + tr) % 12
    L = len(SCALES[T['scale']])
    home_notes = [m for m in range(12, 116) if (m - NOTE_PC[T['key']]) % 12 in SCALES[T['scale']]]
    shift = -L if tr >= 4 else 0
    notes = [m + tr for m in home_notes]  # 與 home_notes 同索引 → 動機以音階索引移調
    motif_idx = [(bar * beats + beat, dur, home_notes.index(midi)) for bar, beat, dur, midi in motif]
    lead_lo = min(i for _, _, i in motif_idx) + shift - 3
    lead_hi = max(i for _, _, i in motif_idx) + shift + L
    center = int(np.mean([i for _, _, i in motif_idx])) + shift
    min_dur = min(d for _, d, _ in motif_idx)
    swing = T['swing']

    stems = {k: Stem(n) for k in ('lead', 'arp', 'pad', 'bass', 'drums', 'orn')}
    inst = {k: S.INSTRUMENTS[v] for k, v in T['inst'].items()}
    cache = {}

    def pos(beat_abs, jitter=0.0):
        whole = math.floor(beat_abs)
        frac = beat_abs - whole
        frac = frac * (swing / 0.5) if frac < 0.5 else swing + (frac - 0.5) * ((1 - swing) / 0.5)
        return int(round(((whole + frac) * spb + rng.normal(0, jitter)) * SR))

    def vel(base, sd=0.07):
        return float(np.clip(base * (1 + rng.normal(0, sd)), 0.25, 1.0))

    def play(role, midi, dur_beats, v, **kw):
        name = T['inst'][role]
        if kw:
            return inst[role](S.midi_hz(midi), dur_beats * spb, v, rng, **kw)
        variant = int(rng.integers(3)) if name == 'zheng' else 0
        key = (name, midi, round(dur_beats, 3), int(round(v * 12)), variant)
        if key not in cache:
            cache[key] = inst[role](S.midi_hz(midi), dur_beats * spb, round(v * 12) / 12, S.rng_for('note', *key))
        return cache[key]

    def chord_at(sec_prog, bar_in_section):
        rootpc, iv = chord(sec_prog[bar_in_section % len(sec_prog)])
        return (rootpc + tr) % 12, iv

    def snap(idx, rootpc, iv, only_root=False):
        want = [iv[0]] if only_root else iv[:3]
        cands = [i for i in range(max(0, idx - L), min(len(notes), idx + L + 1)) if (notes[i] - rootpc) % 12 in want]
        return min(cands, key=lambda i: abs(i - idx)) if cands else idx

    def fit(idx, lo, hi):
        while idx < lo:
            idx += L
        while idx > hi:
            idx -= L
        return idx

    structure = []
    bar0 = 0
    full_start = tmpl[0][3] != 'none'  # 開頭段就有主旋律（結算曲）
    arp_sets = ARP68 if compound else ARP3 if beats == 3 else ARP4
    for si, (name, _, prog_key, mode, by, arp_mode, bass_mode, level, orn) in enumerate(tmpl):
        prog_key = sub.get(prog_key, prog_key)
        prog = T['prog'][prog_key].split()
        phrases = counts[si]
        sec_bars = phrases * pb
        is_home = prog_key == 'H'
        next_level = tmpl[(si + 1) % len(tmpl)][7]
        structure.append({'name': name, 'phrases': phrases, 'bars': sec_bars,
                          'startSec': round(bar0 * beats * spb, 2), 'progression': prog_key, 'lead': mode,
                          'leadBy': by if mode != 'none' else None, 'arp': arp_mode, 'bass': bass_mode,
                          'drumLevel': level, 'ornament': orn})

        # ── 主旋律 ──
        role = 'lead' if by == 'lead' else 'arp'
        reg = shift if by == 'lead' else shift - L
        lo, hi = lead_lo + (reg - shift), lead_hi + (reg - shift)
        prev_f = None
        for p in range(phrases):
            pbeat0 = (bar0 + p * pb) * beats
            line_notes = []  # (拍位, 長度, 音階索引, 是否第二聲部)
            if mode in ('full', 'oct', 'harm'):
                up = L if mode == 'oct' or (mode == 'harm' and p % 2 == 1) else 0
                for b, d, i in motif_idx:
                    line_notes.append((b, d, i + reg + up, False))
                    if mode == 'harm':
                        line_notes.append((b, d, i + reg + up - 2, True))
            elif mode == 'answer':
                first = motif_idx[0][2]
                for b, d, i in motif_idx:
                    line_notes.append((b, d, 2 * first - i + reg + (L if p % 2 else 0), False))
            elif mode == 'frag':
                pick = motif_idx[:4] if p % 2 == 0 else motif_idx[-3:]
                if p % 4 != 3:
                    line_notes = [(b, d, i + reg, False) for b, d, i in pick]
            elif mode == 'rhythm':
                for b, d, _ in motif_idx:
                    line_notes.append((b, min(d, 0.5), center + reg - shift, False))
            elif mode == 'dim':
                if min_dur >= 1:
                    half = phrase_beats / 2
                    for rep, off in ((0, 0), (1, 2 if p % 2 == 0 else -1)):
                        line_notes += [(b / 2 + rep * half, d / 2, i + reg + off, False) for b, d, i in motif_idx]
                else:
                    off = 0 if p % 2 == 0 else 2
                    line_notes = [(b, d, i + reg + off, False) for b, d, i in motif_idx]
            elif mode == 'aug':
                for b, d, i in motif_idx:
                    b2 = b * 2 - (p % 2) * phrase_beats
                    if 0 <= b2 < phrase_beats:
                        line_notes.append((b2, d * 2, i + reg, False))
            elif mode == 'free':
                frng = S.rng_for(theme, slot, 'free', si, p % 2)
                idx = center + reg - shift
                density = 0.85 if level >= 3 else 0.6 if level >= 1 else 0.35
                pool = RHYTHMS['6/8' if compound else beats]['dense' if density > 0.75 else 'medium' if density > 0.45 else 'sparse']
                b = 0.0
                for bar in range(pb):
                    for d in pool[frng.integers(len(pool))]:
                        if d > 0:
                            idx += int(STEPS[frng.integers(len(STEPS))])
                            line_notes.append((b, d, idx, False))
                        b += abs(d)
            exact = mode in ('full', 'oct', 'harm', 'aug') and is_home
            for j, (b, d, idx, second) in enumerate(line_notes):
                bar_in_sec = p * pb + int(b // beats)
                rootpc, iv = chord_at(prog, bar_in_sec)
                idx = fit(idx, lo - (2 if second else 0), hi)
                beat_in_bar = b % beats
                last = j == len(line_notes) - 1
                if mode == 'rhythm':
                    idx = snap(idx, rootpc, iv, only_root=(int(beat_in_bar) % 2 == 0))
                elif not exact and (beat_in_bar == int(beat_in_bar) or last):
                    idx = snap(idx, rootpc, iv)
                if mode == 'free' and j > 0 and not last and rng.random() < 0.15:
                    continue
                midi = notes[idx]
                v = vel((0.86 if beat_in_bar == 0 else 0.72) * (0.8 if second else 1.0) * (0.85 if role == 'arp' else 1.0))
                if T['inst'][role] == 'theremin':
                    sig = play(role, midi, d * 0.95, v, prev=prev_f)
                    prev_f = S.midi_hz(midi)
                else:
                    sig = play(role, midi, d * 0.95, v)
                stems['lead'].add(sig, pos(pbeat0 + b, 0.008), 1.0, -0.12 if second else 0.08)

        # ── 逐小節：pad、低音、琶音、鼓、點綴 ──
        for bar in range(sec_bars):
            gbar = bar0 + bar
            beat0 = gbar * beats
            rootpc, iv = chord_at(prog, bar)
            thin = level < 0
            # Pad（editor 與安靜段落力度較低）
            low = T['base']['pad'] + (rootpc - T['base']['pad']) % 12
            for j, s in enumerate(iv[:4]):
                stems['pad'].add(play('pad', low + s, beats * 0.98, 0.5 if thin else 0.65), pos(beat0), 1.0,
                                 (-0.3, 0.3, 0.0, 0.15)[j])
            # 低音
            blow = T['base']['bass'] + (rootpc - T['base']['bass']) % 12
            if bass_mode == 'long':
                pattern = [(0, beats * 0.95, 0)]
            elif bass_mode == 'pulse':
                pattern = [(b, 0.8, 0) for b in range(beats)]
            elif bass_mode == 'drive' and compound:  # 長短長短的奔跑音型
                pattern = [(0, .58, 0), (2 / 3, .28, 0), (1, .58, 0), (5 / 3, .28, 12 if bar % 2 else 7)]
            elif bass_mode == 'drive':
                pattern = [(i * 0.5, 0.42, 12 if i % 4 == 3 else 0) for i in range(beats * 2)]
            elif bass_mode == 'std' and compound:
                pattern = [(0, .9, 0), (1, .6, 0), (5 / 3, .3, 7)]
            elif bass_mode == 'std':
                pattern = T['bass_std'] if beats == T['beats'] else [(0, 1.4, 0), (1.5, 1.4, 0), (3, .9, 7)]
            else:
                pattern = []
            final_bar = gbar == bars_total - 1  # 全曲最後一小節：加低音與點綴的弱起，把聽者帶回開頭
            if final_bar and bass_mode in ('long', 'std'):
                pattern = [(b, d, s) for b, d, s in pattern if b < beats - 1] + [(beats - 1, 0.9, 7)]
            for b, d, semi in pattern:
                soft = final_bar and b == beats - 1 and not full_start  # 弱起要比下一拍的重音輕
                stems['bass'].add(play('bass', blow + (iv[2] if semi == 7 else semi), d,
                                       vel(0.5 if soft else 0.8 if b == 0 else 0.68)),
                                  pos(beat0 + b, 0.005))
            # 琶音
            if arp_mode != 'off':
                pattern = T['arp_std'] if (arp_mode == 'std' and beats == T['beats']) else \
                    arp_sets.get(arp_mode, arp_sets['busy'])
                alow = T['base']['arp'] + (rootpc - T['base']['arp']) % 12
                tones = [alow + s for s in iv[:3]] + [alow + 12]
                rot = (bar // pb) % 2 if arp_mode in ('alt', 'busy') else 0
                for i, (b, ti) in enumerate(pattern):
                    midi = tones[(ti + rot) % 4] + (12 if arp_mode == 'busy' and i % 4 == 3 else 0)
                    stems['arp'].add(play('arp', midi, 0.5, vel(0.7 if b % 1 == 0 else 0.55)), pos(beat0 + b, 0.006),
                                     1.0, 0.5 if i % 2 else -0.5)
            # 鼓
            # 全曲最後一小節：開頭是薄的引子就不打過門（否則接回開頭會有音量落差）；開頭是滿編制則保留
            fill = bar == sec_bars - 1 and level >= 1 and next_level >= 0 and (gbar != bars_total - 1 or full_start)
            for b, dname, v in drum_pattern(T['kit'], level, beats, fill, compound):
                v = vel(v, 0.06)
                key = ('drum', dname, int(v * 4), rootpc if dname == 'timp' else 0)
                if key not in cache:
                    kw = {'f': S.midi_hz(36 + (rootpc - 36) % 12)} if dname == 'timp' else {}
                    cache[key] = S.DRUMS[dname](S.rng_for(*key), v, **kw)
                g, pan = S.DRUM_MIX[dname]
                stems['drums'].add(cache[key], pos(beat0 + b, 0.003), g * v, pan)
            # 點綴：段落開頭的鐘、樂句結尾的小過門、安靜段落的零星高音
            if orn >= 1 and bar % pb == 0 and (bar == 0 or orn >= 2):
                bl = T['base']['bell'] + (rootpc - T['base']['bell']) % 12
                stems['orn'].add(S.mono(play('bell', bl, beats, 0.6)), pos(beat0, 0.004), 1.0, -0.3)
            if (final_bar and level < 2) or (orn >= 1 and bar % pb == pb - 1 and rng.random() < (0.45 if orn == 1 else 0.8)):
                tl = T['base']['tick'] + (rootpc - T['base']['tick']) % 12
                run = [tl + iv[1], tl + iv[2], tl + 12] if rng.random() < 0.5 else [tl + 12, tl + iv[2]]
                start = beats - sub_beat * len(run)
                for i, midi in enumerate(run):
                    stems['orn'].add(S.mono(play('tick', midi, 0.4, vel(0.5 + 0.05 * i))), pos(beat0 + start + i * sub_beat, 0.004),
                                     0.5 if final_bar and not full_start else 1.0, 0.4)
            if orn >= 2 and thin and bar % 2 == 1 and rng.random() < 0.5:
                tl = T['base']['tick'] + (rootpc - T['base']['tick']) % 12
                stems['orn'].add(S.mono(play('tick', tl + iv[int(rng.integers(3))], 0.5, vel(0.45))),
                                 pos(beat0 + float(rng.integers(beats)) + 0.5, 0.004), 1.0, 0.25)
        bar0 += sec_bars

    targets = dict(T['targets'])
    if slot == 'bgm-editor':  # 無鼓的安靜曲：點綴與琶音略為提前，補一點高頻空氣感
        targets['orn'] += 3.0
        targets['arp'] += 2.0
    mixed, gains = mix_stems(stems, targets, S.rng_for(theme, slot, 'rev'), *T['rev'])
    has_drums = any(sec[7] >= 1 for sec in tmpl)
    out, mastering = finalize_bgm(mixed, has_drums, slot == 'bgm-editor', HI4K_OVERRIDE.get((theme, slot)))
    params = {'bpm': bpm, 'beatsPerBar': beats,
              'meter': '6/8' if compound else f'{beats}/4', 'beatUnit': '附點四分音符' if compound else '四分音符',
              'sectionTemplate': 'theme-specific' if (theme, slot) in THEME_SECTIONS else 'shared',
              'transposeSemitones': tr, 'key': T['key'], 'scale': T['scale'],
              'bars': bars_total, 'phraseBars': pb, 'targetSec': target, 'swing': swing,
              'instruments': T['inst'], 'drumKit': T['kit'], 'stemGainsDb': gains,
              'reverbTauSec': T['rev'][0], 'reverbWet': T['rev'][1], 'targetLufs': -16.0,
              'mastering': mastering, 'sections': structure,
              'loopDesign': '整數小節；所有聲音與殘響以循環方式回捲到開頭；結尾段 turn 停在屬和弦並抽薄配器，接回開頭的主和弦'}
    return out.astype(np.float32), params, bars_total * beats * spb / bars_total


# ───────────────────────── BGM 母帶處理（全部為循環安全的運算） ─────────────────────────

SUB60_MAX = 7.0          # 60 Hz 以下能量佔比上限（%）
HI4K_TARGET = 4.5        # 有鼓的曲子：4 kHz 以上能量佔比目標（%）
HI4K_TARGET_QUIET = 1.5  # 編輯器曲：可較暗，但不趨近 0
HIGH_SHELF_MAX_DB = 12.0
BGM_CEILING_DB = -2.2    # 編碼前峰值上限；解碼後須 ≤ −1 dBFS


def spectrum_stats(mono):
    n = len(mono)
    spec = np.abs(np.fft.rfft(mono * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    total = spec.sum() + 1e-30
    return {'sub60Pct': round(float(spec[f < 60].sum() / total * 100), 2),
            'hi4kPct': round(float(spec[f >= 4000].sum() / total * 100), 2),
            'centroidHz': int(round(float((spec * f).sum() / total)))}


def short_term_range(mono):
    """與外部量測腳本相同：不重疊的 3 秒視窗 RMS，相對整體 RMS 的最小與最大值（dB）。"""
    win = 3 * SR
    overall = S.db(float(np.sqrt(np.mean(mono ** 2))))
    st = [S.db(float(np.sqrt(np.mean(mono[i:i + win] ** 2)))) - overall for i in range(0, len(mono) - win, win)]
    return round(min(st), 1), round(max(st), 1)


def eq_shape(low_gain, high_gain):
    def shape(f):
        f = np.maximum(f, 1e-3)
        hp = 1 / np.sqrt(1 + (35 / f) ** 8)                           # 35 Hz 高通
        low = 1 + (low_gain - 1) / (1 + (f / 60) ** 4)                 # 60 Hz 以下的 shelf
        high = 1 + (high_gain - 1) * (1 - 1 / (1 + (f / 3500) ** 4))   # 3.5 kHz 以上的 shelf
        return hp * low * high
    return shape


def level_ride(x, lo, hi, iters=3):
    """慢速音量校正：3 秒響度偏離整體超過 [lo, hi] dB 的部分拉回；增益以 2 秒視窗循環平滑。"""
    n = len(x)
    win = min(3 * SR, n // 2)
    k = np.zeros(n)
    m = min(2 * SR, n // 2)
    k[:m] = np.hanning(m)
    k = np.roll(k, -m // 2) / k.sum()
    kf = np.fft.rfft(k)
    applied = np.zeros(n)
    for _ in range(iters):
        p = x.mean(axis=1) ** 2
        c = np.cumsum(np.concatenate([p, p[:win]]))
        env = np.roll(np.concatenate([[c[win - 1]], c[win:-1] - c[:-win - 1]]) / win, win // 2)
        dev = 10 * np.log10(np.maximum(env, 1e-12) / np.mean(p))
        g = np.fft.irfft(np.fft.rfft(np.clip(dev, lo, hi) - dev) * kf, n)
        x = x * (10 ** (g / 20))[:, None]
        applied += g
    return x, round(float(applied.min()), 1), round(float(applied.max()), 1)


# 個別曲子的 4 kHz 以上目標：限幅較重的曲子在母帶後高頻佔比會掉到 3% 以下，目標預先拉高
HI4K_OVERRIDE = {('halloween-workshop-2026-a9028c', 'bgm-home'): 6.5}


def finalize_bgm(mixed, has_drums, quiet, hi4k_target=None):
    mono = mixed.mean(axis=1)
    before = spectrum_stats(mono)
    power = np.abs(np.fft.rfft(mono)) ** 2
    f = np.fft.rfftfreq(len(mono), 1 / SR)
    target_hi = hi4k_target or (HI4K_TARGET_QUIET if quiet or not has_drums else HI4K_TARGET)

    def fractions(lg, hg):
        w = power * eq_shape(lg, hg)(f) ** 2
        total = w.sum() + 1e-30
        return w[f < 60].sum() / total * 100, w[f >= 4000].sum() / total * 100

    lg, hg = 1.0, 1.0
    hg_max = 10 ** (HIGH_SHELF_MAX_DB / 20)
    for _ in range(4):  # 兩個 shelf 互相影響總能量，交替求解
        a, b = 0.05, 1.0
        if fractions(1.0, hg)[0] > SUB60_MAX:
            for _ in range(24):
                mid = (a + b) / 2
                a, b = (mid, b) if fractions(mid, hg)[0] <= SUB60_MAX else (a, mid)
            lg = a
        else:
            lg = 1.0
        a, b = 1.0, hg_max
        if fractions(lg, 1.0)[1] < target_hi:
            for _ in range(24):
                mid = (a + b) / 2
                a, b = (mid, b) if fractions(lg, mid)[1] < target_hi else (a, mid)
            hg = b
        else:
            hg = 1.0
    shape = eq_shape(lg, hg)
    x = np.stack([S.fft_filter(mixed[:, c], shape) for c in (0, 1)], axis=1)
    lo, hi = (-2.5, 2.5) if quiet else (-5.5, 8.0)
    x, ride_min, ride_max = level_ride(x, lo, hi)
    x = S.master(x, -16.0, BGM_CEILING_DB)
    mono = x.mean(axis=1)
    st_min, st_max = short_term_range(mono)
    info = {'highPassHz': 35, 'lowShelfDb': round(S.db(lg), 1), 'highShelfDb': round(S.db(hg), 1),
            'hi4kTargetPct': target_hi, 'sub60MaxPct': SUB60_MAX, 'beforeEq': before, 'after': spectrum_stats(mono),
            'levelRideWindowDb': [lo, hi], 'levelRideAppliedDb': [ride_min, ride_max],
            'shortTermVsOverallDb': [st_min, st_max], 'ceilingDbfs': BGM_CEILING_DB}
    return x, info


# ───────────────────────── SE 響度對齊 ─────────────────────────
# 單發音效以「最響 400 ms 的 K 加權響度」對齊（同一槽位四個主題用同一目標），循環音效以整段 RMS 對齊。
# 峰值上限留混音餘裕：BGM 與多台車的世界音效會相加，程式端總輸出有限幅器（D-20261112-03），留餘裕可減少限幅動作。
#           (基準, 目標, 峰值上限 dBFS)
SFX_TARGETS = {
    'sfx-click': ('lufs400', -30.0, -12.0), 'sfx-confirm': ('lufs400', -25.0, -9.0),
    'sfx-cancel': ('lufs400', -26.0, -9.0), 'sfx-error': ('lufs400', -25.0, -9.0),
    'sfx-toast': ('lufs400', -26.0, -10.0),
    'sfx-countdown': ('lufs400', -22.0, -6.0), 'sfx-race-start': ('lufs400', -18.0, -6.0),
    'sfx-checkpoint': ('lufs400', -22.0, -6.0), 'sfx-race-finish': ('lufs400', -19.0, -6.0),
    'sfx-part-broken': ('lufs400', -20.0, -6.0), 'sfx-elimination': ('lufs400', -20.0, -6.0),
    'sfx-motor-loop': ('rms', -24.0, -8.0), 'sfx-surface-hard': ('rms', -25.0, -8.0),
    'sfx-surface-loose': ('rms', -25.0, -8.0), 'sfx-surface-slippery': ('rms', -25.0, -8.0),
    'sfx-collision-light': ('lufs400', -26.0, -8.0), 'sfx-collision-heavy': ('lufs400', -20.0, -6.0),
    'sfx-weapon-melee-launch': ('lufs400', -24.0, -6.0), 'sfx-weapon-melee-impact': ('lufs400', -21.0, -6.0),
    'sfx-weapon-projectile-launch': ('lufs400', -23.0, -6.0), 'sfx-weapon-projectile-impact': ('lufs400', -21.0, -6.0),
    'sfx-skill-boost': ('lufs400', -21.0, -6.0), 'sfx-skill-brake': ('lufs400', -21.0, -6.0),
    'sfx-skill-swerve': ('lufs400', -23.0, -6.0), 'sfx-skill-jump': ('lufs400', -21.0, -6.0),
    'sfx-skill-slam': ('lufs400', -20.0, -6.0), 'sfx-skill-stabilize': ('lufs400', -22.0, -6.0),
}


def loud400(x):
    w = int(0.4 * SR)
    k = S.k_weight(np.concatenate([x, np.zeros(max(0, w - len(x)) + 256)]))
    c = np.cumsum(np.concatenate([[0.0], k ** 2]))
    ms = (c[w:] - c[:-w]).max() / w if len(k) > w else c[-1] / w
    return -0.691 + 10 * math.log10(max(ms, 1e-12))


def finalize_sfx(x, slot, loop):
    basis, target, cap_db = SFX_TARGETS[slot]
    cap = 10 ** (cap_db / 20)
    x = np.asarray(x, dtype=np.float64)
    if not loop:  # 45 Hz 高通：去掉小喇叭發不出、只佔餘裕的超低頻
        pad = np.concatenate([x, np.zeros(4096)])
        x = S.fft_filter(pad, lambda f: 1 / np.sqrt(1 + (45 / np.maximum(f, 1e-3)) ** 8))[:len(x)]
        x[:24] *= np.linspace(0, 1, 24)
    measure = (lambda y: S.db(float(np.sqrt(np.mean(y ** 2))))) if basis == 'rms' else loud400
    limited = False
    for _ in range(6):
        x = x * 10 ** ((target - measure(x)) / 20)
        if np.abs(x).max() <= cap:
            break
        knee = 0.6 * cap  # 無記憶軟限幅：壓住突出的峰值，保住響度（循環音效仍維持週期）
        over = np.abs(x) > knee
        x[over] = np.sign(x[over]) * (knee + (cap - knee) * np.tanh((np.abs(x[over]) - knee) / (cap - knee)))
        limited = True
    if np.abs(x).max() > cap:
        x = x * (cap / np.abs(x).max())
    return x, {'basis': basis, 'target': target, 'measured': round(measure(x), 2), 'peakCapDbfs': cap_db,
               'peakDbfs': round(S.db(float(np.abs(x).max())), 2), 'softLimited': limited,
               'rmsDb': round(S.db(float(np.sqrt(np.mean(x ** 2)))), 2)}


# ───────────────────────── 循環接縫量測 ─────────────────────────

def band_levels(x):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    edges = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000]
    return np.array([10 * math.log10(spec[(f >= a) & (f < b)].sum() + 1e-12) for a, b in zip(edges[:-1], edges[1:])])


def boundary_metrics(mono, i):
    """量測位置 i（循環索引）前後的差異：0.5 秒 RMS 差、0.25 秒八度頻帶差、接點高頻突波比。"""
    n = len(mono)
    idx = lambda a, b: mono[np.arange(a, b) % n]  # noqa: E731
    w, s = int(0.5 * SR), int(0.25 * SR)
    rms = lambda x: S.db(float(np.sqrt(np.mean(x ** 2)))) # noqa: E731
    joined = idx(i - SR, i + SR)
    hp = np.abs(np.diff(joined, 2))
    local = float(hp[SR - 96:SR + 96].max())
    ref = float(np.percentile(hp, 99.9)) + 1e-12
    typical = float(np.sqrt(np.mean(np.diff(joined) ** 2))) + 1e-12
    return {'rmsBeforeDb': round(rms(idx(i - w, i)), 2), 'rmsAfterDb': round(rms(idx(i, i + w)), 2),
            'rmsDiffDb': round(abs(rms(idx(i - w, i)) - rms(idx(i, i + w))), 2),
            'spectralDiffDb': round(float(np.mean(np.abs(band_levels(idx(i - s, i)) - band_levels(idx(i, i + s))))), 2),
            'clickRatio': round(local / ref, 2),
            'sampleJumpVsTypicalStep': round(abs(float(mono[i % n] - mono[(i - 1) % n])) / typical, 2)}


def seam_report(decoded, source, bar_samples):
    """接縫（檔尾接檔頭）與曲中每一條小節線用同一組量測比較；另量測編碼前的來源接縫，分辨差異來自編曲還是編碼。"""
    mono = decoded.astype(np.float64).mean(axis=1)
    src = source.astype(np.float64).mean(axis=1)
    n = len(mono)
    seam = boundary_metrics(mono, 0)
    inner = [boundary_metrics(mono, int(round(k * bar_samples))) for k in range(1, int(round(n / bar_samples)))]
    keys = ('rmsDiffDb', 'spectralDiffDb', 'clickRatio')
    stat = lambda fn: {k: round(float(fn([m[k] for m in inner])), 2) for k in keys}  # noqa: E731
    rank = {k: round(float(np.mean([m[k] <= seam[k] for m in inner])) * 100, 1) for k in keys}
    w = 10 * SR
    # 對齊：以一階差分（強調高頻、峰值較尖）做互相關；只有低頻長音的開頭峰值仍寬，容許 ±1 個取樣
    corr = np.fft.irfft(np.fft.rfft(np.diff(mono[:w]), 2 * w) * np.conj(np.fft.rfft(np.diff(src[:w]), 2 * w)), 2 * w)
    cands = np.concatenate([corr[:1500], corr[-1500:]])
    lag = int(np.argmax(cands))
    lag = lag - 3000 if lag >= 1500 else lag
    p95 = stat(lambda v: np.percentile(v, 95))
    return {'seam': seam, 'sourceSeam': boundary_metrics(src, 0),
            'barLinesMedian': stat(np.median), 'barLinesP95': p95, 'barLinesMax': stat(np.max),
            'seamPercentileAmongBarLines': rank, 'barLineCount': len(inner),
            'sampleCountMatchesSource': len(decoded) == len(source), 'alignmentLagSamples': lag,
            'seamWithinInnerRange': bool(seam['rmsDiffDb'] <= max(3.0, p95['rmsDiffDb']) and
                                         seam['clickRatio'] <= max(1.5, p95['clickRatio']))}


# ───────────────────────── SFX ─────────────────────────

def place(n, parts):
    total = max([n] + [int(s * SR) + len(sig) for s, sig, _ in parts])
    out = np.zeros(total)
    for s, sig, g in parts:
        i = int(s * SR)
        out[i:i + len(sig)] += sig * g
    return out


def sfx_reverb(x, rng, tau, wet):
    if wet <= 0:
        return x
    m = int(tau * 4 * SR)
    ir = S.fft_filter(rng.standard_normal(m), S.band_shape(300, 6500)) * np.exp(-S.tarr(m) / tau)
    ir /= math.sqrt(np.sum(ir ** 2))
    size = len(x) + m
    out = np.zeros(size)
    out[:len(x)] = x
    return out + wet * np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)


def finish_oneshot(x, peak_db, max_sec):
    x = x[:int(max_sec * SR)].copy()
    env = np.abs(x)
    last = np.nonzero(env > env.max() * 10 ** (-55 / 20))[0]
    x = x[:min(len(x), (last[-1] if len(last) else 0) + int(0.02 * SR))]
    fade = min(len(x), int(0.03 * SR))
    x[-fade:] *= np.linspace(1, 0, fade)
    x[:24] *= np.linspace(0, 1, 24)
    return S.norm(x, 10 ** (peak_db / 20))


def clang(n, f, tau, ratios=(1, 2.76, 5.4, 8.93)):
    t = S.tarr(n)
    return sum((1 / (i + 1)) * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (tau / (1 + 0.6 * i)))
               for i, r in enumerate(ratios) if f * r < S.NYQ)


def periodic_noise(n, rng, lo, hi):
    """隨機相位頻譜反轉換：長度 n 內完全週期，可無縫循環。"""
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = S.band_shape(lo, hi)(f) * np.exp(1j * rng.uniform(0, 2 * np.pi, len(f)))
    spec[0] = 0
    return np.fft.irfft(spec, n)


def periodic_ticks(n, rng, count, freq, tau, jitter=False):
    imp = np.zeros(n)
    for i in range(count):
        p = int(rng.uniform(0, n)) if jitter else int((i + 0.5) * n / count)  # 等距脈衝避開循環接點
        imp[p % n] += rng.uniform(0.4, 1.0) if jitter else 1.0
    m = int(tau * 8 * SR)
    t = S.tarr(m)
    k = np.zeros(n)
    k[:m] = np.exp(-t / tau) * (np.sin(2 * np.pi * freq * t) if freq else 1.0)
    return np.fft.irfft(np.fft.rfft(imp) * np.fft.rfft(k), n)


def render_sfx(theme, slot):
    """回傳 (單聲道訊號, 是否循環, 參數)。UI 音效取自點綴樂器，賽事提示取自主旋律樂器。"""
    T = THEMES[theme]
    P = T['sfx']
    rng = S.rng_for(theme, slot, GENERATOR_VERSION)
    pm, root, rev = P['pm'], P['root'], P['rev']
    short = theme.split('-')[0]

    def v(role, semi, dur=0.25, vel=0.85):
        return S.norm(S.mono(S.INSTRUMENTS[P[role]](S.midi_hz(root + semi), dur, vel, rng)))

    def seq(role, semis, gap, dur=0.25, gains=None):
        return place(0, [(i * gap, v(role, x, dur), gains[i] if gains else 1.0) for i, x in enumerate(semis)])

    def accent(semis, gap=0.05, dur=0.2):
        return S.norm(seq('acc', semis, gap, dur))

    def one(x, peak_db, max_sec, wet=1.0):
        return finish_oneshot(sfx_reverb(x, rng, rev[0], rev[1] * wet), peak_db, max_sec), False

    kind = slot[4:]
    info = {'pitchMultiplier': pm, 'rootMidi': root,
            'voices': {k: P[k] for k in ('click', 'ui', 'toast', 'err', 'cue', 'acc')}}
    n_ = lambda sec: int(sec * SR)  # noqa: E731

    if kind == 'click':
        body = v('click', P.get('click_semi', 12), 0.05, 0.7)[:n_(0.07)]
        body = body * S.expenv(len(body), 0.02)
        if P.get('click_body'):  # 補中頻主體，避免只有尖細的高頻
            knock = S.norm(S.DRUMS[P['click_body']](rng, 0.6))
            body = place(0, [(0, body, 0.7), (0, knock[:len(body)], 1.0)])
        if P.get('click_lp'):
            body = S.fft_filter(np.concatenate([body, np.zeros(2048)]), S.band_shape(0, P['click_lp']))[:len(body)]
        x, loop = one(body, -9, 0.1, wet=0.0)
    elif kind == 'confirm':
        x, loop = one(seq('ui', P['up'], 0.085, 0.3, gains=[1.0, 0.9]), -6, 0.9)
    elif kind == 'cancel':
        x, loop = one(seq('ui', [P['up'][1], P['up'][0] - (1 if short == 'halloween' else 0)], 0.095, 0.25, gains=[1.0, 0.5]), -7, 0.9)  # 第二音明顯較輕：起音落在第一個音，回饋即時
    elif kind == 'error':
        low = [(t0, v('err', -17 + s, 0.14, 0.8), 1.0) for t0 in (0, 0.17) for s in (0, P['clash'])]
        knock = S.DRUMS['woodlo'](rng, 0.6)
        x, loop = one(place(0, low + [(0, knock, 0.5), (0.17, knock, 0.45)]), -6, 0.7, wet=0.5)
    elif kind == 'toast':
        x, loop = one(seq('toast', P['tri'][1:], 0.12, 0.5), -8, 1.4, wet=1.3)
    elif kind == 'countdown':
        x, loop = one(place(0, [(0, v('cue', -3, 0.2, 0.9), 1.0), (0, v('ui', 9, 0.2, 0.6), 0.3)]), -3, 0.6, wet=0.4)
    elif kind == 'race-start':
        parts = [(0, v('cue', s + 9, 0.7, 0.95), 0.6) for s in (0, P['tri'][1], 7)]
        parts += [(0, v('cue', 9 + 12, 0.7, 0.9), 0.5), (0, v('acc', 9, 0.9, 0.9), 0.7), (0.0, v('ui', 21, 0.5, 0.8), 0.3)]
        puff = S.sweep_noise(n_(0.45), rng, 700 * pm, 5000 * pm, 1500) * S.hump(n_(0.45), 1.0, 0.5)
        x, loop = one(place(0, parts + [(0, puff, 0.15)]), -2, 1.8, wet=0.9)
    elif kind == 'checkpoint':
        x, loop = one(place(0, [(0, v('cue', 7, 0.15), 0.9), (0.085, v('cue', 14, 0.3), 1.0), (0.085, v('ui', 19, 0.25, 0.6), 0.35)]), -5, 0.9)
    elif kind == 'race-finish':
        m = T['motif'][:4]
        base = m[0][3]
        run = [(i * 0.14, S.norm(S.mono(S.INSTRUMENTS[P['cue']](S.midi_hz(midi), 0.25, 0.85, rng))), 0.8)
               for i, (_, _, _, midi) in enumerate(m)]
        final = [(0.6, S.norm(S.mono(S.INSTRUMENTS[P['cue']](S.midi_hz(base + s), 1.0, 0.9, rng))), 0.5) for s in P['final']]
        final += [(0.6, S.norm(S.mono(S.INSTRUMENTS[P['acc']](S.midi_hz(base + P['final'][0]), 1.2, 0.9, rng))), 0.6),
                  (0.74, S.norm(S.mono(S.INSTRUMENTS[P['ui']](S.midi_hz(base + P['final'][-1] + 12), 0.6, 0.7, rng))), 0.3)]
        x, loop = one(place(0, run + final), -3, 3.0, wet=1.5)
        info['note'] = '動機前四音加明亮終止和弦'
    elif kind == 'part-broken':
        n = n_(0.5)
        crack = S.norm(S.noise_band(n, rng, 1800 * pm, 7000)) * S.expenv(n, 0.025)
        ph = S.sweep_phase(n, 1500 * pm, 420 * pm, 0.6)
        fall = (np.sin(ph) + 0.5 * np.sin(2.76 * ph)) * S.expenv(n, 0.14)
        thud = np.sin(2 * np.pi * 95 * pm * S.tarr(n)) * S.expenv(n, 0.06)
        x, loop = one(place(0, [(0, crack, 1.0), (0.01, S.norm(fall), 0.6), (0, thud, 0.7),
                                (0.05, accent([0, -P['clash']], 0.06), 0.35)]), -3, 1.0, wet=0.6)
    elif kind == 'elimination':
        parts = [(i * 0.18, v('cue', s - 12, 0.2, 0.9), 0.9 - 0.1 * i) for i, s in enumerate(P['down'])]
        n = n_(0.6)
        boom = np.sin(S.sweep_phase(n, 150 * pm, 75, 0.5)) * S.expenv(n, 0.2)
        x, loop = one(place(0, parts + [(0.7, boom, 1.0), (0.7, S.norm(S.noise_band(n, rng, 60, 600)) * S.expenv(n, 0.08), 0.3)]),
                      -3, 2.2, wet=1.2)
    elif kind == 'motor-loop':
        # 4 秒循環。程式的播放速率是 0.7–2.0，且每台車同時播同一個檔：
        # 轉速帶緩慢漂移、每個諧波各自緩慢起伏，讓時間錯開的多個副本彼此不完全相干，減少梳狀濾波的空洞感。
        # 所有成分在 4 秒內都是整數週期（漂移的積分為零），檔案首尾無縫。
        loop_sec = 4
        n = loop_sec * SR
        t = S.tarr(n)
        f0 = int(round(110 * pm))  # 速率 0.7 時基頻仍在 60 Hz 以上
        tilt = {'default': 1.0, 'christmas': 1.15, 'halloween': 0.8, 'moon': 1.35}[short]
        drift = (0.004 / (2 * np.pi * 0.25)) * (1 - np.cos(2 * np.pi * 0.25 * t)) + \
            (0.003 / (2 * np.pi * 0.75)) * (np.cos(rng.uniform(0, 6.28)) - np.cos(2 * np.pi * 0.75 * t + 0))
        drift -= drift[0]
        tt = t + drift  # 轉速漂移 ±0.4%（0.25 Hz）與 ±0.3%（0.75 Hz）
        x = np.zeros(n)
        for k in range(1, 60):
            fk = k * f0
            if fk > 9000:
                break
            a = (1 / k ** tilt) * (1 + 2.2 * math.exp(-((fk - 950 * pm) / 320) ** 2) + 1.6 * math.exp(-((fk - 2600 * pm) / 260) ** 2))
            wob = 1 + 0.25 * np.sin(2 * np.pi * (int(rng.integers(1, 7)) / loop_sec) * t + rng.uniform(0, 6.28))
            x += a * wob * np.sin(2 * np.pi * fk * tt + rng.uniform(0, 6.28))
        am = {'default': 13, 'christmas': 16, 'halloween': 7, 'moon': 9}[short]
        x *= 1 + (0.32 if am == 7 else 0.2) * np.sin(2 * np.pi * am * tt)
        x = S.norm(x) + 0.2 * S.norm(periodic_noise(n, rng, 1500, 7000))
        if short == 'christmas':
            x += 0.06 * (np.sin(2 * np.pi * 5200 * tt) + np.sin(2 * np.pi * 6100 * tt)) * (0.5 + 0.5 * np.sin(2 * np.pi * 8 * t))
        if short == 'moon':
            x += 0.2 * periodic_ticks(n, rng, 4 * loop_sec, 700, 0.012, jitter=True)
        if short == 'halloween':
            x += 0.15 * np.sin(2 * np.pi * (f0 * 3 + 2) * tt)
        loop = True
        info.update({'fundamentalHz': f0, 'amHz': am, 'loopSec': loop_sec, 'playbackRateRange': [0.7, 2.0],
                     'method': '整數週期諧波加法（電機換相諧波＋齒輪共振峰）、轉速緩慢漂移、各諧波獨立起伏、週期噪音'})
    elif kind.startswith('surface-'):
        n = 2 * SR
        t = S.tarr(n)
        if kind == 'surface-hard':
            x = S.norm(periodic_noise(n, rng, 120 * pm, 1300 * pm)) * (1 + 0.25 * np.sin(2 * np.pi * 9 * t))
            x += 0.5 * periodic_ticks(n, rng, 22, 1800 * pm, 0.006)
        elif kind == 'surface-loose':
            grains = periodic_ticks(n, rng, 70, None, 0.012, jitter=True)
            x = S.norm(periodic_noise(n, rng, (450 if short == 'christmas' else 700) * pm, 5200 * pm)) * (0.25 + np.abs(grains) * 2.5)
            x += 0.35 * S.norm(periodic_noise(n, rng, 150, 500))
        else:
            x = S.norm(periodic_noise(n, rng, 3200 * pm, 10000)) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.5 * t))
            x += 0.18 * np.sin(2 * np.pi * 1500 * pm * t + 6 * np.sin(2 * np.pi * 1.0 * t)) * (0.5 + 0.5 * np.sin(2 * np.pi * 1.5 * t))
        loop = True
        info.update({'method': '週期噪音（隨機相位頻譜）＋循環卷積顆粒', 'playbackRateRange': [0.75, 2.0]})
    elif kind == 'collision-light':
        n = n_(0.16)
        x0 = np.sin(2 * np.pi * 190 * pm * S.tarr(n)) * S.expenv(n, 0.028) + S.norm(S.noise_band(n, rng, 900, 4500)) * S.expenv(n, 0.012) * 0.8
        x, loop = one(place(0, [(0, x0, 1.0), (0.0, accent([12], 0.0, 0.08), 0.2)]), -4, 0.35, wet=0.3)
    elif kind == 'collision-heavy':
        n = n_(0.6)
        boom = np.sin(S.sweep_phase(n, 165 * pm, 85, 0.5)) * S.expenv(n, 0.14)  # 主體 85–165 Hz，小喇叭聽得到
        crunch = S.norm(S.noise_band(n, rng, 250, 3200)) * S.expenv(n, 0.07)
        smack = S.norm(S.noise_band(n, rng, 700, 2800)) * S.expenv(n, 0.03)  # 中頻撞擊起音
        x, loop = one(place(0, [(0, boom, 1.0), (0, crunch, 0.7), (0, smack, 0.8), (0.005, S.norm(clang(n, 330 * pm, 0.2)), 0.35),
                                (0.02, accent([0, P['clash']], 0.0, 0.25), 0.25)]), -2, 1.1, wet=0.7)
    elif kind == 'weapon-melee-launch':
        n = n_(0.3)
        x0 = S.sweep_noise(n, rng, 450 * pm, 3200 * pm, 700, 1.4) * S.hump(n, 1.5, 1.3)
        x, loop = one(place(0, [(0, x0, 1.0), (0.1, accent([7], 0.0, 0.1), 0.15)]), -5, 0.55, wet=0.3)
    elif kind == 'weapon-melee-impact':
        n = n_(0.5)
        x0 = S.norm(clang(n, 520 * pm, 0.2)) * 0.8 + np.sin(2 * np.pi * 130 * pm * S.tarr(n)) * S.expenv(n, 0.04) + \
            S.norm(S.noise_band(n, rng, 1500, 8000)) * S.expenv(n, 0.01) * 0.6
        x, loop = one(place(0, [(0, x0, 1.0), (0.01, accent([P['clash'], 12], 0.0, 0.25), 0.2)]), -3, 0.9, wet=0.6)
    elif kind == 'weapon-projectile-launch':
        n = n_(0.26)
        x0 = np.sin(S.sweep_phase(n, 2100 * pm, 280 * pm, 0.6)) * S.expenv(n, 0.07) + \
            S.norm(S.noise_band(n, rng, 800, 5000)) * S.expenv(n, 0.03) * 0.4
        x, loop = one(place(0, [(0, x0, 1.0), (0.0, accent([19], 0.0, 0.08), 0.2)]), -4, 0.5, wet=0.4)
    elif kind == 'weapon-projectile-impact':
        n = n_(0.45)
        x0 = S.sweep_noise(n, rng, 3500 * pm, 300, 1800, 0.5) * S.expenv(n, 0.09) + \
            np.sin(S.sweep_phase(n, 150 * pm, 78, 0.5)) * S.expenv(n, 0.08) * 0.9
        x, loop = one(place(0, [(0, x0, 1.0), (0.02, accent([P['clash'] + 12, 0], 0.03, 0.15), 0.2)]), -3, 0.9, wet=0.6)
    elif kind == 'skill-boost':
        n = n_(0.7)
        x0 = S.sweep_noise(n, rng, 300 * pm, 5200 * pm, 1200, 1.6) * S.hump(n, 0.8, 1.8) * 0.8 + \
            np.sin(S.sweep_phase(n, 180 * pm, 1300 * pm, 1.4)) * S.hump(n, 1.0, 1.5) * 0.5
        x, loop = one(place(0, [(0, x0, 1.0), (0.25, accent(P['tri'], 0.07, 0.2), 0.3)]), -3, 1.3, wet=0.7)
    elif kind == 'skill-brake':
        n = n_(0.5)
        ph = S.sweep_phase(n, 950 * pm, 380 * pm, 0.7)
        x0 = S.sweep_noise(n, rng, 3600 * pm, 1300 * pm, 260, 0.7) * S.hump(n, 0.5, 0.6) + \
            (np.sin(ph) + 0.33 * np.sin(3 * ph) + 0.2 * np.sin(5 * ph)) * S.hump(n, 0.6, 0.6) * 0.3
        x, loop = one(place(0, [(0, x0, 1.0), (0.3, accent([0], 0.0, 0.15), 0.15)]), -4, 0.9, wet=0.4)
    elif kind == 'skill-swerve':
        n = n_(0.34)
        half = n // 2
        ph = np.concatenate([S.sweep_phase(half, 800 * pm, 2600 * pm), S.sweep_phase(n - half, 2600 * pm, 900 * pm)])
        ph[half:] += ph[half - 1]
        base = S.fft_filter(rng.standard_normal(n), S.band_shape(0, 350)) + 1j * S.fft_filter(rng.standard_normal(n), S.band_shape(0, 350))
        x0 = S.norm(np.real(base * np.exp(1j * ph))) * S.hump(n, 1.2) * (1 + 0.3 * np.sin(2 * np.pi * 22 * S.tarr(n)))
        x, loop = one(place(0, [(0, x0, 1.0), (0.08, accent([P['up'][1], P['up'][0]], 0.07, 0.1), 0.18)]), -5, 0.6, wet=0.3)
    elif kind == 'skill-jump':
        n = n_(0.4)
        t = S.tarr(n)
        f = 260 * pm * (950 / 260) ** ((t / t[-1]) ** 0.7) * (1 + 0.08 * np.sin(2 * np.pi * 19 * t) * np.exp(-t / 0.12))
        ph = 2 * np.pi * np.cumsum(f) / SR
        x0 = (np.sin(ph) + 0.3 * np.sin(2 * ph)) * S.hump(n, 0.6, 0.7)
        x, loop = one(place(0, [(0, x0, 1.0), (0.12, accent([P['up'][0], P['up'][1]], 0.08, 0.15), 0.25)]), -4, 0.8, wet=0.5)
    elif kind == 'skill-slam':
        n = n_(0.8)
        x0 = np.sin(S.sweep_phase(n, 175 * pm, 82, 0.45)) * S.expenv(n, 0.24) + \
            S.norm(S.noise_band(n, rng, 200, 2600)) * S.expenv(n, 0.09) * 0.7 + S.norm(clang(n, 240 * pm, 0.25)) * 0.3 + \
            S.norm(S.noise_band(n, rng, 600, 2400)) * S.expenv(n, 0.04) * 0.7
        x, loop = one(place(0, [(0, x0, 1.0), (0.01, accent([-12, -12 + P['clash']], 0.0, 0.35), 0.3)]), -2, 1.4, wet=0.8)
    elif kind == 'skill-stabilize':
        chord_sig = place(0, [(0, v('cue', s, 0.5, 0.8), 1 / 3) for s in (0, 7, 12)])
        t = S.tarr(len(chord_sig))
        chord_sig = chord_sig * (1 + 0.6 * np.exp(-t / 0.18) * np.sin(2 * np.pi * (18 - 20 * np.minimum(t, 0.5)) * t))
        shimmer = S.norm(S.noise_band(len(chord_sig), rng, 5000, 11000)) * S.hump(len(chord_sig), 2.0) * 0.1
        x, loop = one(place(0, [(0, chord_sig, 1.0), (0, shimmer, 1.0), (0.3, accent([12, 19], 0.06, 0.25), 0.3)]), -5, 1.3, wet=1.0)
    else:
        raise KeyError(slot)
    x, info['loudness'] = finalize_sfx(x, slot, loop)
    return x.astype(np.float32), loop, info


# ───────────────────────── 產生、驗證、清單 ─────────────────────────

def verify(path, source, loop):
    problems = []
    raw = open(path, 'rb').read()
    if raw[:4] != b'OggS':
        problems.append('缺少 OggS')
    if b'OpusHead' not in raw[:64]:
        problems.append('缺少 OpusHead')
    data, rate, ch = S.decode(path)
    src = source if source.ndim == 2 else source[:, None]
    if ch != src.shape[1]:
        problems.append(f'聲道 {ch}≠{src.shape[1]}')
    if rate != SR:
        problems.append(f'取樣率 {rate}')
    if len(data) != len(src):
        problems.append(f'取樣數 {len(data)}≠{len(src)}')
    if not np.all(np.isfinite(data)):
        problems.append('含非有限值')
    rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
    if rms < 10 ** (-50 / 20):
        problems.append('近乎靜音')
    result = {'decodedSamples': int(len(data)), 'sourceSamples': int(len(src)),
              'decodedDurationSec': round(len(data) / rate, 4), 'decodedChannels': ch, 'decodedSampleRate': rate,
              'decodedPeakDbfs': round(S.db(float(np.abs(data).max())), 2), 'decodedRmsDbfs': round(S.db(rms), 2),
              'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    return result, problems, data


def generate_theme(theme, only_slots=None):
    import bpy
    T = THEMES[theme]
    files, failures = [], []
    started = time.time()
    previous = {}
    if only_slots:  # 只重做指定槽位，其餘沿用既有片段
        with open(os.path.join(ROOT, '_fragments', f'{theme}.json'), encoding='utf-8') as fh:
            previous = {f['slot']: f for f in json.load(fh)['files']}
    for slot in BGM_SLOTS + SFX_SLOTS:
        if theme != 'default' and slot in DEFAULT_ONLY_SFX:
            continue
        if only_slots and slot not in only_slots:
            files.append(previous[slot])
            if previous[slot]['problems']:
                failures.append((previous[slot]['path'], previous[slot]['problems']))
            continue
        is_bgm = slot.startswith('bgm-')
        rel = f"{theme}/{'bgm' if is_bgm else 'se'}/{slot}.ogg"
        path = os.path.join(ROOT, *rel.split('/'))
        t0 = time.time()
        extra = {}
        if is_bgm:
            data, params, bar_sec = render_bgm(theme, slot)
            loop, bitrate = True, BGM_BITRATE
        else:
            data, loop, params = render_sfx(theme, slot)
            bitrate = SFX_BITRATE
        if loop:
            extra['loopEncoding'] = S.encode_loop(path, data, bitrate)
        else:
            S.encode(path, data, bitrate)
        checked, problems, decoded = verify(path, data, loop)
        if is_bgm:
            ceiling = BGM_CEILING_DB
            # 有損編碼會改變相位，被限幅壓平的峰值在解碼後會回彈（實測最多約 3 dB）。
            # 解碼後超過 −1 dBFS：前兩輪把限幅上限再壓低、維持 −16 LUFS 重編；仍超過就降整體音量（響度略低於目標）。
            ceiling, trim = BGM_CEILING_DB, 0.0
            for attempt in range(6):
                over = checked['decodedPeakDbfs'] - (-1.0)
                if over <= 0:
                    break
                if attempt < 2:
                    ceiling -= min(over + 0.3, 1.5)
                    data = S.master(data.astype(np.float64), -16.0, ceiling).astype(np.float32)
                else:
                    trim -= over + 0.2
                    data = (data * 10 ** (-(over + 0.2) / 20)).astype(np.float32)
                extra['loopEncoding'] = S.encode_loop(path, data, bitrate)
                checked, problems, decoded = verify(path, data, loop)
            extra['peakControl'] = {'finalCeilingDbfs': round(ceiling, 2), 'gainTrimDb': round(trim, 2),
                                    'decodedPeakDbfs': checked['decodedPeakDbfs']}
            if checked['decodedPeakDbfs'] > -1.0:
                problems.append('解碼後峰值高於 −1 dBFS')
            mono_d = decoded.astype(np.float64).mean(axis=1)
            extra['decodedAudit'] = {**spectrum_stats(mono_d), 'shortTermVsOverallDb': list(short_term_range(mono_d))}
            report = seam_report(decoded, data, bar_sec * SR)
            extra['loopSeam'] = report
            if not report['sampleCountMatchesSource'] or abs(report['alignmentLagSamples']) > 1:
                problems.append('解碼後長度或對齊與來源不符')
            if not report['seamWithinInnerRange']:
                problems.append('接縫量測超出曲中小節線的範圍')
            check_dir = os.path.join(ROOT, 'loop-check', theme)
            S.encode(os.path.join(check_dir, f'{slot}-x2.ogg'), np.concatenate([decoded, decoded]), bitrate)
            tail = min(len(decoded), 15 * SR)
            S.encode(os.path.join(check_dir, f'{slot}-seam.ogg'), np.concatenate([decoded[-tail:], decoded[:tail]]), 128000)
            extra['loopCheckFiles'] = [f'loop-check/{theme}/{slot}-x2.ogg', f'loop-check/{theme}/{slot}-seam.ogg']
        elif loop:
            mono = decoded.astype(np.float64).mean(axis=1)
            extra['loopSeam'] = {'seam': boundary_metrics(mono, 0), 'sampleCountMatchesSource': len(decoded) == len(data)}
        loud = round(S.lufs(data.astype(np.float64)), 2)
        entry = {
            'theme': theme, 'slot': slot, 'kind': 'bgm' if is_bgm else 'sfx', 'path': rel,
            'container': 'ogg', 'codec': 'opus', 'sampleRate': SR, 'channels': 1 if data.ndim == 1 else data.shape[1],
            'bitrateTarget': bitrate, 'durationSec': round(len(data) / SR, 4), 'loop': loop,
            'reserved': slot in RESERVED_SFX,
            'reservedNote': ('保留槽：非 default 主題供檔會被程式忽略，僅 default 這份有效'
                             if slot in RESERVED_SFX and theme != 'default' else None),
            'sourcePeakDbfs': round(S.db(float(np.abs(data).max())), 2), 'sourceLufs': loud,
            'method': 'procedural-synthesis', 'seedKey': f'{theme}|{slot}|{GENERATOR_VERSION}',
            'params': params, 'verification': checked, 'problems': problems, **extra,
        }
        files.append(entry)
        if problems:
            failures.append((rel, problems))
        seam = extra.get('loopSeam', {}).get('seam', {})
        print(f"[{time.time() - t0:6.1f}s] {rel}  {len(data) / SR:7.2f}s  {checked['bytes'] / 1024:8.1f} KiB  LUFS {loud:6.1f}"
              + (f"  seam rms {seam['rmsDiffDb']} dB spec {seam['spectralDiffDb']} dB click {seam['clickRatio']}" if seam and is_bgm else '')
              + ('  OK' if not problems else '  FAIL ' + '; '.join(problems)), flush=True)
    total = sum(f['verification']['bytes'] for f in files)
    fragment = {'theme': theme, 'style': T['style'], 'files': files, 'totalBytes': total,
                'blender': bpy.app.version_string, 'numpy': np.__version__, 'python': sys.version.split()[0],
                'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'elapsedSec': round(time.time() - started)}
    os.makedirs(os.path.join(ROOT, '_fragments'), exist_ok=True)
    with open(os.path.join(ROOT, '_fragments', f'{theme}.json'), 'w', encoding='utf-8') as fh:
        json.dump(fragment, fh, ensure_ascii=False, indent=1)
    print(f"\n{theme}: {len(files)} 檔、{total / 1048576:.2f} MiB、失敗 {len(failures)}、耗時 {time.time() - started:.0f}s")
    for rel, problems in failures:
        print('  FAIL', rel, problems)
    if total > THEME_AUDIO_MAX_BYTES:
        print('  超過 20 MiB 上限')
    return not failures and total <= THEME_AUDIO_MAX_BYTES


def merge():
    themes, files, env = {}, [], {}
    for theme in THEMES:
        with open(os.path.join(ROOT, '_fragments', f'{theme}.json'), encoding='utf-8') as fh:
            frag = json.load(fh)
        mine = frag['files']
        themes[theme] = {'style': frag['style'], 'bgmCount': sum(f['kind'] == 'bgm' for f in mine),
                         'sfxCount': sum(f['kind'] == 'sfx' for f in mine), 'totalBytes': frag['totalBytes'],
                         'totalMiB': round(frag['totalBytes'] / 1048576, 2),
                         'withinThemeSizeLimit': frag['totalBytes'] <= THEME_AUDIO_MAX_BYTES,
                         'bgmDurationSec': round(sum(f['durationSec'] for f in mine if f['kind'] == 'bgm'), 1),
                         'omittedSlots': [] if theme == 'default' else DEFAULT_ONLY_SFX,
                         'omittedNote': None if theme == 'default' else DEFAULT_ONLY_NOTE,
                         'generatedAt': frag['generatedAt']}
        files += mine
        env = {'synthesis': f"numpy {frag['numpy']}", 'encoder': f"Blender {frag['blender']} aud (Ogg Opus)",
               'python': frag['python']}
    manifest = {
        'generator': {'script': 'generate.py', 'engine': 'synth.py', 'version': GENERATOR_VERSION,
                      'method': 'procedural-synthesis', **env},
        'styleGuide': '風格設定.md',
        'rights': '全部波形、旋律與節奏由 generate.py 與 synth.py 的演算法依固定種子產生；未取樣、未引用任何既有錄音、樂曲或遊戲音效。',
        'slotAuthority': 'open-4wd/src/audio-system/slots.ts',
        'reservedSfxSlots': RESERVED_SFX, 'loopSfxSlots': LOOP_SFX,
        'defaultOnlySfxSlots': DEFAULT_ONLY_SFX, 'defaultOnlyNote': DEFAULT_ONLY_NOTE,
        'themeAudioMaxBytes': THEME_AUDIO_MAX_BYTES, 'bitrates': {'bgm': BGM_BITRATE, 'sfx': SFX_BITRATE},
        'timbres': {k: {'name': v[0], 'method': v[1]} for k, v in S.TIMBRES.items()},
        'drums': S.DRUM_INFO, 'themes': themes, 'files': files,
    }
    with open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f'manifest.json：{len(files)} 檔')
    for theme, info in themes.items():
        print(f"  {theme}: BGM {info['bgmCount']}、SFX {info['sfxCount']}、{info['totalMiB']} MiB、BGM 合計 {info['bgmDurationSec']}s")


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--merge' in args:
        merge()
        return
    if '--only' not in args:
        raise SystemExit('請用 --only <主題 id> 逐主題產生，全部完成後再執行 --merge')
    theme = args[args.index('--only') + 1]
    if '--slot' in args:  # 單一槽位試跑，不寫片段
        slot = args[args.index('--slot') + 1]
        t0 = time.time()
        if slot == 'sfx':
            for s in SFX_SLOTS:
                x, loop, info = render_sfx(theme, s)
                print(f"{s:30s} {len(x) / SR:5.2f}s  {json.dumps(info['loudness'], ensure_ascii=False)}")
            return
        data, params, bar_sec = render_bgm(theme, slot)
        path = os.path.join(ROOT, '_trial', f'{theme}-{slot}.ogg')
        enc = S.encode_loop(path, data, BGM_BITRATE)
        decoded = S.decode(path)[0]
        print('loop encoding', enc, 'decoded', len(decoded), 'source', len(data))
        print(json.dumps({'sec': round(len(data) / SR, 2), 'elapsed': round(time.time() - t0, 1),
                          'sections': [(s['name'], s['phrases'], s['lead']) for s in params['sections']],
                          'gains': params['stemGainsDb'], 'mastering': params['mastering'],
                          'decodedPeak': round(S.db(float(np.abs(decoded).max())), 2), 'seam': seam_report(decoded, data, bar_sec * SR)},
                         ensure_ascii=False))
        return
    only_slots = args[args.index('--slots') + 1].split(',') if '--slots' in args else None
    if not generate_theme(theme, only_slots):
        sys.exit(1)


if __name__ == '__main__':
    main()
