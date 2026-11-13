# -*- coding: utf-8 -*-
"""Open4WD 主題音訊合成引擎：樂器、打擊、混音、響度。

全部以 numpy 計算，不讀任何外部音訊。樂器以聲學模型為主：
modal 合成（弦、金屬棒、木質、膜）、FM（電鋼琴）、非諧波加法（鐘、缽）、多聲部 detune pad。
每個樂器簽名：fn(f, dur, vel, rng) → 單聲道 (n,) 或立體聲 (n, 2)；vel 0–1，越大越亮。
"""
import hashlib
import math

import numpy as np

SR = 48000
NYQ = 0.45 * SR


# ───────────────────────── 基礎工具 ─────────────────────────

def rng_for(*keys):
    digest = hashlib.sha256('|'.join(str(k) for k in keys).encode('utf-8')).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], 'little'))


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tarr(n):
    return np.arange(n) / SR


def db(x):
    return 20 * math.log10(max(x, 1e-12))


def adsr(dur, a, d, s, r):
    n = max(1, int((dur + r) * SR))
    t = tarr(n)
    e = np.where(t < a, t / max(a, 1e-6), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-6), s))
    return e * np.where(t > dur, np.clip((dur + r - t) / max(r, 1e-6), 0, 1), 1.0)


def fft_filter(x, shape):
    n = len(x)
    spec = np.fft.rfft(x)
    spec *= shape(np.fft.rfftfreq(n, 1 / SR))
    return np.fft.irfft(spec, n)


def band_shape(lo, hi, soft=0.25):
    def shape(f):
        f = np.maximum(f, 1e-3)
        up = 1 / (1 + (lo / f) ** (2 / soft)) if lo > 0 else 1.0
        return up / (1 + (f / hi) ** (2 / soft))
    return shape


def noise_band(n, rng, lo, hi):
    return fft_filter(rng.standard_normal(n), band_shape(lo, hi))


def expenv(n, tau, attack=0.002):
    t = tarr(n)
    return np.minimum(t / attack, 1.0) * np.exp(-t / tau)


def hump(n, power=1.0, skew=1.0):
    u = (np.arange(n) / max(n - 1, 1)) ** skew
    return np.sin(np.pi * u) ** power


def norm(x, peak=1.0):
    return x * (peak / (np.abs(x).max() + 1e-12))


def sweep_phase(n, f0, f1, curve=1.0):
    u = (np.arange(n) / max(n - 1, 1)) ** curve
    return 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** u) / SR


def sweep_noise(n, rng, f0, f1, bw, curve=1.0):
    base = fft_filter(rng.standard_normal(n), band_shape(0, bw / 2)) + \
        1j * fft_filter(rng.standard_normal(n), band_shape(0, bw / 2))
    return norm(np.real(base * np.exp(1j * sweep_phase(n, f0, f1, curve))))


def mono(x):
    return x.mean(axis=1) if x.ndim == 2 else x


def partials(ph, f0, ratios, amps, decays, n):
    """modal 核心：每個模態 = 指數衰減的正弦；只算到該模態衰減至 −60 dB 為止。"""
    out = np.zeros(n)
    for r, a, d in zip(ratios, amps, decays):
        if a == 0 or r * f0 >= NYQ:
            continue
        m = min(n, int(6.9 / max(d, 1e-3) * SR) + 1)
        out[:m] += a * np.exp(-d * tarr(m)) * np.sin(r * ph[:m])
    return out


# ───────────────────────── 弦（modal 弦模型） ─────────────────────────

def string(f, dur, vel, rng, pluck=0.15, B=3e-4, d0=1.0, d1=0.1, ring=2.0, damp=0.07, nh=32, tilt=1.0,
           bend=0.0, vib=0.0, noise=0.5, lp=None, thump=0.0):
    """撥點 pluck（0–0.5）決定泛音分布；B 為非諧性；高泛音衰減較快；damp=None 表示放鍵後繼續餘響。"""
    held = min(dur, ring)
    total = ring if damp is None else held + 5 * damp
    n = int(total * SR)
    t = tarr(n)
    fm = f * (1 + bend * np.exp(-t / 0.05))
    if vib and dur > 0.45:
        fm = fm * (1 + vib * np.sin(2 * np.pi * 5.4 * t) * np.clip((t - 0.25) / 0.3, 0, 1))
    ph = 2 * np.pi * np.cumsum(fm) / SR
    k = np.arange(1, nh + 1)
    ratios = k * np.sqrt(1 + B * k * k)
    amps = np.sin(k * np.pi * pluck) / k ** (tilt + 0.9 * (1 - vel))
    if lp:
        amps = amps / np.sqrt(1 + (k * f / lp) ** 4)
    decays = (d0 + d1 * k ** 1.5) * (f / 220) ** 0.4
    out = partials(ph, f, ratios, amps, decays, n) / (np.sum(np.abs(amps)) * 0.45)
    nn = int(0.006 * SR)
    out[:nn] += noise * vel * 0.25 * norm(noise_band(nn, rng, 1200, 6500)) * expenv(nn, 0.0015, 0.0003)
    if thump:
        nt = int(0.04 * SR)
        out[:nt] += thump * vel * norm(noise_band(nt, rng, 60, 320)) * expenv(nt, 0.01)
    out *= np.minimum(t / 0.001, 1)
    if damp is not None:
        out *= np.where(t > held, np.exp(-(t - held) / damp), 1.0)
    else:
        out *= np.clip((total - t) / 0.05, 0, 1)
    return out * vel ** 1.2


def i_guitar_mute(f, dur, vel, rng):
    return string(f, dur, vel, rng, pluck=0.1, B=1e-4, d0=8.0, d1=0.4, ring=0.5, damp=0.03, nh=24, lp=5000, noise=0.9)


def i_ebass(f, dur, vel, rng):
    return string(f, dur, vel, rng, pluck=0.22, B=5e-5, d0=1.6, d1=0.12, ring=1.6, damp=0.05, nh=18, lp=2400,
                  tilt=1.0, noise=0.5, thump=0.2)


def i_upright(f, dur, vel, rng):
    return string(f, dur, vel, rng, pluck=0.3, B=8e-5, d0=2.6, d1=0.4, ring=1.3, damp=0.07, nh=14, lp=1800,
                  tilt=1.05, noise=0.5, thump=0.4)


def i_harpsi(f, dur, vel, rng):
    v = 0.6 + 0.3 * vel  # 大鍵琴力度變化小
    a = string(f, dur, v, rng, pluck=0.06, B=2e-4, d0=1.5, d1=0.05, ring=1.6, damp=0.05, nh=36, tilt=0.8, noise=0.9)
    b = string(f * 2.003, dur, v, rng, pluck=0.08, B=2e-4, d0=2.2, d1=0.07, ring=1.2, damp=0.05, nh=18, tilt=0.9, noise=0.5)
    out = a.copy()
    out[:len(b)] += 0.35 * b[:len(out)]
    i = int(min(dur, 1.6) * SR)
    nn = int(0.004 * SR)
    if i + nn < len(out):
        out[i:i + nn] += 0.05 * norm(noise_band(nn, rng, 2000, 8000)) * expenv(nn, 0.001, 0.0003)
    return out


def i_zheng(f, dur, vel, rng):
    bend = -0.056 if (dur > 0.4 and rng.random() < 0.3) else 0.008
    return string(f, dur, vel, rng, pluck=0.12, B=2e-4, d0=1.0, d1=0.085, ring=2.6, damp=None, nh=30, tilt=0.85,
                  bend=bend, vib=0.006, noise=0.8)


# ───────────────────────── 金屬棒、木質、鐘（modal／非諧波加法） ─────────────────────────

def bars(f, dur, vel, rng, ratios, amps, decays, hard=1.0, trem=0.0, click=0.3, cap=3.0, fscale=0.5):
    dec = np.array(decays, dtype=float) * (f / 440) ** fscale
    n = int(min(cap, 6.9 / dec.min() * 0.85 + 0.05) * SR)
    t = tarr(n)
    a = np.array([x * vel ** (i * 0.8 * hard) for i, x in enumerate(amps)])
    out = partials(2 * np.pi * f * t, f, ratios, a, dec, n) / np.sum(np.abs(amps))
    nn = int(0.004 * SR)
    out[:nn] += click * vel * 0.3 * norm(noise_band(nn, rng, 1500, 7000)) * expenv(nn, 0.001, 0.0003)
    if trem:
        out *= 1 + trem * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6.28))
    out *= np.minimum(t / 0.0008, 1) * np.clip((n / SR - t) / 0.03, 0, 1)
    return out * vel ** 1.1


def i_glock(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 2.756, 5.404, 8.933], [1, .45, .22, .1], [2.4, 3.6, 6, 11])


def i_celesta(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 2.756, 5.404], [1, .25, .1], [3.2, 7, 14], click=0.25)


def i_musicbox(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 6.27, 17.55], [1, .22, .06], [3.8, 9, 22], click=0.4)


def i_marimba(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 4.0, 9.9], [1, .25, .08], [7, 16, 35], click=0.5, fscale=0.7)


def i_vibes(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 4.0, 10.0], [1, .18, .04], [1.3, 4, 11], trem=0.22, click=0.2)


def i_handbell(f, dur, vel, rng, tierce=1.25):
    return bars(f, dur, vel, rng, [.5, 1, tierce, 1.5, 2, 2.5, 3, 4.07], [.25, 1, .45, .2, .6, .2, .22, .1],
                [.9, 1.3, 1.8, 2.4, 2.6, 3.6, 4.8, 6.5], hard=0.5, click=0.2, cap=3.5, fscale=0.3)


def i_tubular(f, dur, vel, rng):
    return i_handbell(f, dur, vel, rng, tierce=1.2)


def i_bowl(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 1.004, 2.71, 2.722, 5.15], [1, .8, .5, .4, .2], [1.0, 1.1, 1.8, 1.9, 3.2],
                hard=0.6, click=0.08, cap=3.5, fscale=0.3)


def i_ceramic(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 2.32, 4.25, 6.63], [1, .5, .3, .15], [9, 14, 22, 34], click=0.35)


def i_metal_tick(f, dur, vel, rng):
    return bars(f, dur, vel, rng, [1, 1.47, 2.09, 2.56, 3.9], [1, .7, .5, .4, .25], [28, 34, 45, 60, 80], click=0.5,
                fscale=0.2)


# ───────────────────────── 電鋼琴（FM）、風琴（加法）、特雷門 ─────────────────────────

def i_epiano(f, dur, vel, rng):
    n = int((dur + 0.3) * SR)
    t = tarr(n)
    ph = 2 * np.pi * f * t
    idx = (0.5 + 2.4 * vel ** 1.5) * np.exp(-t / 0.5) + 0.15
    x = np.sin(ph + idx * np.sin(ph))
    tine = 14 if 14 * f < NYQ else (7 if 7 * f < NYQ else 0)
    if tine:
        x += 0.4 * vel * np.sin(tine * ph + 0.5 * np.sin(ph)) * np.exp(-t / 0.07)
    x *= np.exp(-t / (1.8 * (220 / f) ** 0.5)) * np.minimum(t / 0.002, 1)
    x *= np.where(t > dur, np.exp(-(t - dur) / 0.07), 1.0) * vel ** 1.1
    pan = 0.2 * np.sin(2 * np.pi * 4.6 * t + rng.uniform(0, 6.28))
    return np.stack([x * (1 + pan), x * (1 - pan)], axis=1) * 0.8


def i_organ(f, dur, vel, rng, bars_=(.6, 1, .5, .7, .3, .35, .15, .2, .1)):
    e = adsr(dur, 0.03, 0.0, 1.0, 0.09)
    n = len(e)
    t = tarr(n)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 6.0 * t)
    vibr = 1 + 0.002 * np.sin(2 * np.pi * 6.0 * t + 1.0)
    base = 2 * np.pi * np.cumsum(f * vibr) / SR
    out = np.zeros(n)
    for r, a in zip((0.5, 1, 1.5, 2, 3, 4, 5, 6, 8), bars_):
        if r * f < NYQ:
            out += a * np.sin(r * 2 ** (rng.uniform(-1.5, 1.5) / 1200) * base + rng.uniform(0, 6.28))
    out /= sum(bars_)
    nn = min(n, int(0.05 * SR))
    out[:nn] += 0.12 * norm(noise_band(nn, rng, f * 2, f * 6)) * hump(nn, 1.0, 0.5)
    return out * e * trem * (0.6 + 0.4 * vel) * 1.6


def i_organ_pedal(f, dur, vel, rng):
    return i_organ(f, dur, vel, rng, bars_=(0, 1, .3, .6, .25, .3, .1, .1, 0))


def i_theremin(f, dur, vel, rng, prev=None):
    """特雷門：近乎正弦；滑音 90 ms 平滑過渡、顫音淺而延遲、高音自動收斂音量，避免刺耳。"""
    e = adsr(dur, 0.09, 0.0, 1.0, 0.2)
    n = len(e)
    t = tarr(n)
    start = prev if prev else f
    start = f * min(max(start / f, 2 ** (-5 / 12)), 2 ** (5 / 12))  # 滑音起點最多離目標四度
    u = np.clip(t / 0.09, 0, 1)
    glide = f * (start / f) ** (0.5 + 0.5 * np.cos(np.pi * u))
    vib = 1 + 0.008 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.2) / 0.35, 0, 1)
    ph = 2 * np.pi * np.cumsum(glide * vib) / SR
    x = np.sin(ph) + 0.1 * np.sin(2 * ph) + 0.025 * np.sin(3 * ph)
    swell = 0.85 + 0.15 * np.sin(np.pi * np.clip(t / max(dur, 0.1), 0, 1))
    return x * e * swell * (0.55 + 0.45 * vel) * min(1.0, (700 / f) ** 0.6) * 0.8


# ───────────────────────── Pad（多聲部 detune＋慢速濾波，立體聲） ─────────────────────────

def pad(f, dur, vel, rng, fc0, fc1, voices, K, attack, release, spread):
    e = adsr(dur, attack, 0.0, 1.0, release)
    n = len(e)
    t = tarr(n)
    fc = fc0 + (fc1 - fc0) * (0.5 - 0.5 * np.cos(2 * np.pi * t / (n / SR))) * (0.6 + 0.4 * vel)
    left = np.zeros(n)
    right = np.zeros(n)
    for i in range(voices):
        det = spread * (2 * i / max(voices - 1, 1) - 1)
        ff = f * 2 ** (det / 1200)
        drift = 1 + 0.0012 * np.sin(2 * np.pi * 0.31 * t + rng.uniform(0, 6.28))
        ph = 2 * np.pi * np.cumsum(ff * drift) / SR + rng.uniform(0, 6.28)
        v = np.zeros(n)
        for k in range(1, K + 1):
            if k * ff < NYQ:
                v += (1 / k) / np.sqrt(1 + (k * ff / fc) ** 4) * np.sin(k * ph)
        a = (i / max(voices - 1, 1)) * math.pi / 2
        left += v * math.cos(a)
        right += v * math.sin(a)
    return np.stack([left, right], axis=1) * e[:, None] / voices * 1.4


def i_pad_warm(f, dur, vel, rng):
    return pad(f, dur, vel, rng, 1100, 3800, 4, 14, 0.5, 0.7, 9)


def i_pad_soft(f, dur, vel, rng):
    return pad(f, dur, vel, rng, 800, 2600, 3, 9, 0.7, 0.9, 6)


INSTRUMENTS = {name[2:]: fn for name, fn in list(globals().items()) if name.startswith('i_')}

TIMBRES = {
    'epiano': ('電鋼琴（音叉式）', 'FM：載波與調變同頻、調變深度隨力度與時間衰減，另加高倍頻音叉擊音；左右自動擺動'),
    'guitar_mute': ('悶音撥弦', 'modal 弦模型：24 個泛音、撥點 0.10、高衰減'),
    'ebass': ('電貝斯', 'modal 弦模型：18 個泛音、拾音器低通 2.4 kHz、指撥低頻雜音'),
    'upright': ('撥弦低音', 'modal 弦模型：14 個泛音、快衰減、琴身低頻悶響'),
    'harpsi': ('大鍵琴', 'modal 弦模型：近琴橋撥弦、8 呎加 4 呎兩組弦、放鍵雜音'),
    'zheng': ('箏類撥弦', 'modal 弦模型：30 個泛音、長延音、部分音由下方滑入、長音按弦顫音'),
    'glock': ('鐘琴', 'modal 金屬棒：模態比 1 : 2.756 : 5.404 : 8.933'),
    'celesta': ('鋼片琴', 'modal 金屬棒：高模態弱、延音較短'),
    'musicbox': ('音樂盒', 'modal 懸臂簧片：模態比 1 : 6.27 : 17.55'),
    'marimba': ('馬林巴', 'modal 木質琴鍵：模態比 1 : 4 : 9.9、快衰減'),
    'vibes': ('顫音鐵琴', 'modal 金屬棒：模態比 1 : 4 : 10、5.2 Hz 馬達顫音'),
    'handbell': ('手鈴（大三度調音）', '非諧波加法：hum、prime、tierce、quint、nominal 等 8 個分音'),
    'tubular': ('管鐘（小三度調音）', '非諧波加法：同手鈴模型、tierce 改為小三度'),
    'bowl': ('缽', '非諧波加法：成對分音產生緩慢拍頻'),
    'ceramic': ('陶瓷敲擊', 'modal：4 個非諧波模態、短衰減'),
    'metal_tick': ('金屬工具敲擊', 'modal：5 個密集非諧波模態、極短衰減'),
    'organ': ('拉桿風琴', '加法：9 支拉桿各自微調音高、起音氣聲、6 Hz 顫音'),
    'organ_pedal': ('風琴腳鍵盤', '加法：以 8 呎拉桿為主並補二至四次泛音，不用 16 呎（避免 60 Hz 以下的超低頻）'),
    'theremin': ('特雷門', '正弦振盪加少量二三次泛音；90 ms 平滑滑音、延遲顫音、高音自動收斂音量'),
    'pad_warm': ('暖色 pad', '加法：4 聲部 detune ±9 cent、每聲部 14 個泛音、低通截止頻率 1.1–3.8 kHz 隨音符緩慢開合'),
    'pad_soft': ('柔和 pad', '加法：3 聲部 detune ±6 cent、每聲部 9 個泛音、低通截止頻率 0.8–2.6 kHz 慢速開合'),
}


# ───────────────────────── 打擊（膜模態、調變噪音） ─────────────────────────

def d_kick(rng, b, f0=62, sweep=80, tau=0.15):
    n = int(0.5 * SR)
    t = tarr(n)
    ph = 2 * np.pi * np.cumsum(f0 + (sweep * (0.6 + 0.6 * b)) * np.exp(-t / 0.03)) / SR
    out = np.sin(ph) * expenv(n, tau, 0.001) + 0.3 * np.sin(1.59 * ph) * expenv(n, 0.05, 0.001)
    nn = int(0.008 * SR)
    out[:nn] += (0.3 + 0.6 * b) * norm(noise_band(nn, rng, 1500, 7000)) * expenv(nn, 0.002, 0.0003)
    return out


def d_softkick(rng, b):
    return d_kick(rng, b * 0.5, f0=64, sweep=45, tau=0.12)


def d_snare(rng, b):
    n = int(0.32 * SR)
    t = tarr(n)
    drop = 1 + 0.08 * np.exp(-t / 0.02)
    tone = np.sin(2 * np.pi * np.cumsum(188 * drop) / SR) * expenv(n, 0.07) + \
        0.6 * np.sin(2 * np.pi * np.cumsum(332 * drop) / SR) * expenv(n, 0.045)
    wires = norm(noise_band(n, rng, 1300, 10000)) * expenv(n, 0.085 + 0.03 * b, 0.001) * (0.75 + 0.25 * np.abs(np.sin(2 * np.pi * 188 * t)))
    nn = int(0.004 * SR)
    out = 0.7 * tone + (0.55 + 0.45 * b) * wires
    out[:nn] += 0.5 * b * norm(noise_band(nn, rng, 3000, 9000)) * expenv(nn, 0.001, 0.0003)
    return out


def d_brush(rng, b):
    n = int(0.2 * SR)
    return norm(noise_band(n, rng, 1500, 7500)) * hump(n, 1.5, 0.45) * 0.6


def d_hat(rng, b, tau=0.03):
    n = int((tau * 6 + 0.03) * SR)
    t = tarr(n)
    metal = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) for f in (3120, 4350, 5410, 6630, 7870, 9230, 11200))
    x = fft_filter(0.25 * metal * (1 + 0.5 * np.sin(2 * np.pi * 1470 * t)) + norm(noise_band(n, rng, 6000, 16000)),
                   band_shape(5000 - 1500 * b, 17000))
    return norm(x) * expenv(n, tau * (0.8 + 0.4 * b), 0.0006)


def d_ohat(rng, b):
    return d_hat(rng, b, 0.1)


def d_sleigh(rng, b):
    n = int(0.24 * SR)
    out = np.zeros(n)
    for i in range(14):
        start = 0 if i == 0 else int(rng.uniform(0, 0.07) * SR)
        m = n - start
        t = tarr(m)
        tone = sum(np.sin(2 * np.pi * rng.uniform(2600, 9000) * t + rng.uniform(0, 6.28)) * np.exp(-t * rng.uniform(55, 120))
                   for _ in range(3))
        out[start:] += tone * rng.uniform(0.3, 1.0)
    return norm(out)


def d_timp(rng, b, f=73.4):
    n = int(1.1 * SR)
    t = tarr(n)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.03 * np.exp(-t / 0.04))) / SR
    out = partials(ph, f, [1, 1.5, 1.99, 2.44, 2.89], [1, .6, .35 * (0.5 + b), .2 * b + .05, .1 * b], [3, 4, 5.5, 7, 9], n)
    nn = int(0.03 * SR)
    out[:nn] += 0.3 * norm(noise_band(nn, rng, 60, 450)) * expenv(nn, 0.008)
    return out


def _block(rng, b, f, decays=(45, 80, 120)):
    n = int(0.14 * SR)
    t = tarr(n)
    out = partials(2 * np.pi * f * t, f, [1, 2.41, 4.3], [1, .4 + .3 * b, .2 * b + .05], decays, n)
    nn = int(0.003 * SR)
    out[:nn] += 0.25 * norm(noise_band(nn, rng, 1500, 6000)) * expenv(nn, 0.0008, 0.0003)
    return out


def d_bones(rng, b):
    return _block(rng, b, 1250, (60, 90, 140))


def d_wood(rng, b):
    return _block(rng, b, 820)


def d_woodlo(rng, b):
    return _block(rng, b, 540)


def d_frame(rng, b):
    n = int(0.55 * SR)
    t = tarr(n)
    ph = 2 * np.pi * np.cumsum(92 * (1 + 0.1 * np.exp(-t / 0.02))) / SR
    out = partials(ph, 92, [1, 1.59, 2.14, 2.3, 2.65], [1, .5, .3, .25, .1 + .2 * b], [9, 14, 18, 20, 25], n)
    nn = int(0.012 * SR)
    out[:nn] += (0.15 + 0.25 * b) * norm(noise_band(nn, rng, 300, 2500)) * expenv(nn, 0.004)
    return out


def d_shaker(rng, b):
    n = int(0.1 * SR)
    env = np.zeros(n)
    for _ in range(25):
        i = int(rng.uniform(0, 0.05) * SR)
        env[i:] += np.exp(-tarr(n - i) / 0.012) * rng.uniform(0.3, 1)
    return norm(noise_band(n, rng, 4000, 11000) * env)


def d_tri(rng, b):
    n = int(1.0 * SR)
    t = tarr(n)
    return partials(2 * np.pi * 4200 * t, 4200, [1, 1.62, 2.35, 3.05], [1, .6, .4, .2], [3, 4, 6, 8], n) * np.minimum(t / 0.0005, 1)


def d_ratchet(rng, b):
    n = int(0.22 * SR)
    out = np.zeros(n)
    for i in range(7):
        s = int(i * 0.028 * SR)
        tick = _block(rng, 0.8, 1900 + 60 * i, (150, 200, 260))
        m = min(len(tick), n - s)
        out[s:s + m] += tick[:m] * (0.6 + 0.06 * i)
    return out


DRUMS = {name[2:]: fn for name, fn in list(globals().items()) if name.startswith('d_')}
#            增益, 左右
DRUM_MIX = {
    'kick': (1.0, 0.0), 'softkick': (0.7, 0.0), 'snare': (0.6, 0.05), 'brush': (0.5, 0.15), 'hat': (0.32, 0.3),
    'ohat': (0.28, 0.3), 'sleigh': (0.32, -0.35), 'timp': (0.8, -0.1), 'bones': (0.4, 0.4), 'wood': (0.45, 0.35),
    'woodlo': (0.45, -0.35), 'frame': (0.8, 0.0), 'shaker': (0.3, -0.4), 'tri': (0.16, 0.45), 'ratchet': (0.3, 0.4),
}
DRUM_INFO = {
    'kick': '膜模態加音高下掃、鼓槌擊音噪音', 'softkick': '同 kick、掃頻較小', 'snare': '兩個膜模態加響弦調變噪音',
    'brush': '帶通噪音、刷擦包絡', 'hat': '七個非諧波金屬分音調幅加高頻噪音', 'ohat': '同 hat、長衰減',
    'sleigh': '14 顆小鈴的隨機微撞擊群', 'timp': '膜模態 1 : 1.5 : 1.99 : 2.44 : 2.89 加音高下滑',
    'bones': '木質 modal（高音）', 'wood': '木質 modal', 'woodlo': '木質 modal（低音）',
    'frame': '膜模態加手指拍擊噪音', 'shaker': '25 顆砂粒包絡的帶通噪音', 'tri': '鋼棒 modal、4 個非諧波模態',
    'ratchet': '7 個連續短木質脈衝',
}


# ───────────────────────── 混音 ─────────────────────────

class Bus:
    """固定長度的循環匯流排：超出尾端的聲音回捲到開頭（無縫循環的基礎）。"""

    def __init__(self, n):
        self.n = n
        self.l = np.zeros(n)
        self.r = np.zeros(n)
        self.send = np.zeros(n)

    def _wrap(self, buf, sig, start):
        start %= self.n
        while len(sig):
            m = min(len(sig), self.n - start)
            buf[start:start + m] += sig[:m]
            sig = sig[m:]
            start = 0

    def add(self, sig, start, gain=1.0, pan=0.0, send=0.2):
        if sig.ndim == 2:
            left, right = sig[:, 0] * min(1.0, 1 - pan), sig[:, 1] * min(1.0, 1 + pan)
        else:
            a = (pan + 1) * math.pi / 4
            left, right = sig * math.cos(a), sig * math.sin(a)
        self._wrap(self.l, left * gain, start)
        self._wrap(self.r, right * gain, start)
        if send:
            self._wrap(self.send, (left + right) * (0.5 * gain * send), start)


def reverb_ir(rng, tau, n_max):
    """三個頻段各自衰減（高頻較快）加 6 個早期反射；回傳 (L, R)。"""
    m = int(min(tau * 5, n_max / SR) * SR)
    t = tarr(m)
    out = []
    for _ in range(2):
        ir = np.zeros(m)
        for lo, hi, k in ((200, 1000, 1.0), (1000, 4000, 0.75), (4000, 9000, 0.4)):
            ir += noise_band(m, rng, lo, hi) * np.exp(-t / (tau * k))
        ir[:int(0.015 * SR)] = 0
        ir /= math.sqrt(np.sum(ir ** 2))
        for _ in range(6):
            ir[int(rng.uniform(0.008, 0.06) * SR)] += rng.uniform(0.15, 0.4) * rng.choice([-1, 1])
        ir *= np.clip((m - np.arange(m)) / (0.05 * SR), 0, 1)
        out.append(ir)
    return out


def mix_stems(stems, targets, rng, tau, wet, ir_max_sec=6.0):
    """stems: {名稱: Bus}；targets: {名稱: 相對響度 dB}。先依響度自動平衡各軌，再做循環卷積殘響。"""
    n = next(iter(stems.values())).n
    left = np.zeros(n)
    right = np.zeros(n)
    send = np.zeros(n)
    gains = {}
    for name, bus in stems.items():
        dry = np.stack([bus.l, bus.r], axis=1)
        if np.abs(dry).max() < 1e-9:
            continue
        g = 10 ** ((targets.get(name, -6.0) - lufs(dry)) / 20)
        gains[name] = round(db(g), 2)
        left += bus.l * g
        right += bus.r * g
        send += bus.send * g
    outs = []
    for dry, ir in zip((left, right), reverb_ir(rng, tau, ir_max_sec * SR)):
        folded = np.zeros(n)
        Bus(n)._wrap(folded, ir, 0)
        outs.append(dry + wet * np.fft.irfft(np.fft.rfft(send) * np.fft.rfft(folded), n))
    return np.stack(outs, axis=1), gains


# ───────────────────────── 響度（BS.1770 近似，頻域 K 加權） ─────────────────────────

def k_weight(x):
    n = len(x)
    w = np.exp(-2j * np.pi * np.fft.rfftfreq(n, 1 / SR) / SR)

    def h(b, a):
        return (b[0] + b[1] * w + b[2] * w * w) / (a[0] + a[1] * w + a[2] * w * w)

    hk = h([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]) * \
        h([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621])
    return np.fft.irfft(np.fft.rfft(x) * hk, n)


def lufs(x):
    if x.ndim == 1:
        x = x[:, None]
    k = np.stack([k_weight(x[:, c]) for c in range(x.shape[1])], axis=1)
    block, hop = int(0.4 * SR), int(0.1 * SR)
    if len(k) < block:
        ms = np.array([np.sum(np.mean(k ** 2, axis=0))])
    else:
        cs = np.concatenate([np.zeros((1, k.shape[1])), np.cumsum(k ** 2, axis=0)])
        starts = np.arange(0, len(k) - block + 1, hop)
        ms = np.sum((cs[starts + block] - cs[starts]) / block, axis=1)
    loud = -0.691 + 10 * np.log10(np.maximum(ms, 1e-12))
    keep = ms[loud > -70]
    if len(keep) == 0:
        return -120.0
    rel = -0.691 + 10 * math.log10(np.mean(keep)) - 10
    keep = ms[(loud > -70) & (loud > rel)]
    return -0.691 + 10 * math.log10(np.mean(keep))


def master(x, target_lufs=-16.0, ceiling_db=-1.0):
    """響度正規化；超過峰值上限的部分以無記憶的軟限幅處理（不破壞循環）。"""
    ceiling = 10 ** (ceiling_db / 20)
    knee = 0.75 * ceiling
    for _ in range(16):
        x = x * 10 ** ((target_lufs - lufs(x)) / 20)
        if np.abs(x).max() <= ceiling:
            return x
        over = np.abs(x) > knee
        y = x.copy()
        y[over] = np.sign(x[over]) * (knee + (ceiling - knee) * np.tanh((np.abs(x[over]) - knee) / (ceiling - knee)))
        x = y
    return x  # 最後一步是限幅：峰值必在上限內，響度可能略低於目標


# ───────────────────────── 編碼（Blender aud） ─────────────────────────

def encode(path, data, bitrate=96000, wav=False):
    import os
    import aud
    if data.ndim == 1:
        data = data[:, None]
    channels = aud.CHANNELS_STEREO if data.shape[1] == 2 else aud.CHANNELS_MONO
    os.makedirs(os.path.dirname(path), exist_ok=True)
    snd = aud.Sound.buffer(np.ascontiguousarray(data, dtype=np.float32), SR)
    if wav:
        snd.write(path, SR, channels, aud.FORMAT_S16, aud.CONTAINER_WAV, aud.CODEC_PCM, 0)
    else:
        snd.write(path, SR, channels, aud.FORMAT_FLOAT32, aud.CONTAINER_OGG, aud.CODEC_OPUS, bitrate)


# ───────────────────────── 無縫循環的 Ogg Opus 封裝 ─────────────────────────
# Opus 編碼器從靜止狀態起編，檔頭與檔尾各自收斂，直接循環時解碼後的接點會有不連續。
# 做法：編碼前在開頭墊上「循環結尾」、在結尾墊上「循環開頭」，讓編碼器在接點兩側都有真實的前後文；
# 再重寫 Ogg 分頁，把 OpusHead 的 pre-skip 加上前墊長度、最後一頁的 granule position 定在循環結束處，
# 解碼器依規格（RFC 7845）自動丟掉前後墊料，輸出恰好是一個循環。

LOOP_LEAD = 9600   # 前墊 200 ms
LOOP_TAIL = 4800   # 後墊 100 ms
_BITREV = bytes(int(f'{i:08b}'[::-1], 2) for i in range(256))


def _ogg_crc(page):
    import zlib
    return int(f'{(zlib.crc32(page.translate(_BITREV), 0xFFFFFFFF) ^ 0xFFFFFFFF) & 0xFFFFFFFF:032b}'[::-1], 2)


def _ogg_packets(raw):
    """回傳 (serial, [packet bytes…])，並順便驗證每一頁的 CRC 算法與原檔一致。"""
    import struct
    packets, cur, pos, serial = [], b'', 0, None
    while pos < len(raw):
        if raw[pos:pos + 4] != b'OggS':
            raise ValueError('Ogg 分頁損壞')
        serial, = struct.unpack_from('<I', raw, pos + 14)
        stored, = struct.unpack_from('<I', raw, pos + 22)
        nseg = raw[pos + 26]
        table = raw[pos + 27:pos + 27 + nseg]
        size = 27 + nseg + sum(table)
        page = raw[pos:pos + size]
        if _ogg_crc(page[:22] + b'\0\0\0\0' + page[26:]) != stored:
            raise ValueError('Ogg CRC 驗算不符')
        body = pos + 27 + nseg
        for lace in table:
            cur += raw[body:body + lace]
            body += lace
            if lace < 255:
                packets.append(cur)
                cur = b''
        pos += size
    return serial, packets


def _opus_samples(packet):
    toc = packet[0]
    cfg = toc >> 3
    size = (480, 960, 1920, 2880)[cfg & 3] if cfg < 12 else (480, 960)[cfg & 1] if cfg < 16 else (120, 240, 480, 960)[cfg & 3]
    frames = (1, 2, 2, packet[1] & 0x3F if len(packet) > 1 else 0)[toc & 3]
    return size * frames


def _ogg_page(serial, seq, flags, granule, packets):
    import struct
    table = b''
    for p in packets:
        table += b'\xff' * (len(p) // 255) + bytes([len(p) % 255])
    head = b'OggS\0' + bytes([flags]) + struct.pack('<qIII', granule, serial, seq, 0) + bytes([len(table)]) + table
    page = head + b''.join(packets)
    return page[:22] + struct.pack('<I', _ogg_crc(page)) + page[26:]


def encode_loop(path, data, bitrate=96000):
    """編碼一個可無縫循環的 Ogg Opus 檔；回傳墊料與 pre-skip 資訊。"""
    import struct
    if data.ndim == 1:
        data = data[:, None]
    n = len(data)
    lead = np.concatenate([data] * (LOOP_LEAD // n + 1))[-LOOP_LEAD:]
    tail = np.concatenate([data] * (LOOP_TAIL // n + 1))[:LOOP_TAIL]
    encode(path, np.concatenate([lead, data, tail]), bitrate)
    with open(path, 'rb') as fh:
        serial, packets = _ogg_packets(fh.read())
    head, tags, audio = packets[0], packets[1], packets[2:]
    if head[:8] != b'OpusHead':
        raise ValueError('不是 Opus')
    pre_skip0, = struct.unpack_from('<H', head, 10)
    pre_skip = pre_skip0 + LOOP_LEAD
    if pre_skip > 65535:
        raise ValueError('pre-skip 超出 16 位元')
    end = pre_skip + n
    head = head[:10] + struct.pack('<H', pre_skip) + head[12:]
    pages = [_ogg_page(serial, 0, 0x02, 0, [head]), _ogg_page(serial, 1, 0, 0, [tags])]
    total, batch, segs, seq = 0, [], 0, 2
    kept = []
    for p in audio:
        if total >= end:
            break  # 整包落在循環結束之後的封包不需要
        kept.append(p)
        total += _opus_samples(p)
    total = 0
    for i, p in enumerate(kept):
        batch.append(p)
        segs += len(p) // 255 + 1
        total += _opus_samples(p)
        last = i == len(kept) - 1
        if last or segs >= 200:
            pages.append(_ogg_page(serial, seq, 0x04 if last else 0, min(total, end) if last else total, batch))
            batch, segs, seq = [], 0, seq + 1
    if total < end:
        raise ValueError('編碼輸出短於循環長度')
    with open(path, 'wb') as fh:
        fh.write(b''.join(pages))
    return {'leadInSamples': LOOP_LEAD, 'leadOutSamples': LOOP_TAIL, 'encoderPreSkip': pre_skip0, 'preSkip': pre_skip,
            'finalGranule': end}


def decode(path):
    import aud
    snd = aud.Sound.file(path)
    rate, ch = snd.specs
    return snd.data(), int(rate), int(ch)
