"""Beyond the Signal — original 96-second Void Dominion music demonstrator.

This builds on the early map sketch, adapted to the game's A/E signal family.
All instruments are synthesized here: no recordings, external samples, or model APIs.
The arrangement has a deliberate ending; it is not a seamless gameplay loop.
Dependencies: Python 3, NumPy, SciPy. Run this file to recreate the WAV and metadata.
"""
from pathlib import Path
import json
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48_000
BPM = 90
BEAT = 60 / BPM
DURATION = 96.0
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'music' / 'void-dominion-beyond-the-signal.wav'
META = ROOT / 'music' / 'void-dominion-beyond-the-signal.json'
RNG = np.random.default_rng(20261023)
mix = np.zeros((round(DURATION * SR), 2), np.float64)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def timebase(seconds):
    return np.arange(round(seconds * SR), dtype=np.float64) / SR


def edges(t, seconds, attack=.02, release=.2):
    rise = np.sin(np.pi / 2 * np.clip(t / attack, 0, 1)) ** 2
    fall = np.sin(np.pi / 2 * np.clip((seconds - t) / release, 0, 1)) ** 2
    return rise * fall


def lowpass(data, cutoff, order=2):
    return sosfilt(butter(order, cutoff, fs=SR, output='sos'), data, axis=0)


def add(data, start, gain=1, pan=0, echo=0):
    if data.ndim == 1:
        angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        data = data[:, None] * np.array([np.cos(angle), np.sin(angle)])[None, :]
    offset = round(start * SR)
    size = min(len(data), len(mix) - offset)
    if size > 0:
        mix[offset:offset+size] += gain * data[:size]
    if echo:
        # Dark dual lines deliberately recall sound.ts, with a slower musical tail.
        filtered = lowpass(data, 1100)
        for delay, amount in [(.17,.24),(.29,.20),(.50,.19),(1.0,.10),(1.5,.055),(2.0,.028)]:
            add(filtered[:, ::-1], start + delay, gain * echo * amount)


def pad(notes, seconds=10.0, brightness=1.0, alien=0.0):
    t = timebase(seconds)
    result = np.zeros((len(t), 2))
    for j, note in enumerate(notes):
        f = hz(note)
        phase = RNG.uniform(0, 2*np.pi)
        core = 2*np.pi*f*t + phase
        slow = .035*np.sin(2*np.pi*(.09+j*.009)*t+j)
        for ch in range(2):
            cents = (-2.8 if ch == 0 else 2.8) + (j-2)*.22
            side = 2*np.pi*f*2**(cents/1200)*t + phase + slow
            voice = .66*np.sin(core+slow) + .34*np.sin(side)
            voice += brightness*.14*np.sin(2*side+.2) + brightness*.035*np.sin(3*side)
            if alien:
                # A faint beating sideband, tethered to the pitch rather than random FX.
                voice += alien*.08*np.sin(core + .9*np.sin(2*np.pi*7.3*t))
            result[:, ch] += voice*(.85 if j<2 else .65)
    env = edges(t, seconds, 2.0, 2.0)
    breath = .93 + .07*np.sin(2*np.pi*.065*t)
    return result / len(notes) * (env * breath)[:, None]


def key(note, seconds=4.5, long=False, shade=0):
    t = timebase(seconds)
    f = hz(note)
    carrier = 2*np.pi*f*t
    attack = .055 if long else .018
    decay = 2.0 if long else 1.35
    env = (1-np.exp(-t/attack))*np.exp(-t/decay)*edges(t, seconds, .006, .6)
    tone = np.sin(carrier + .09*np.sin(2*np.pi*2*f*t)*np.exp(-t/.35))
    tone += .17*np.sin(2*carrier)*np.exp(-t/1.0)
    tone += .035*np.sin(3*carrier)*np.exp(-t/.5)
    if shade:
        tone += shade*.08*np.sin(2*np.pi*(f+1.4)*t)*np.exp(-t/1.8)
    return tone * env


def bowed(note, seconds=5, alien=0):
    t = timebase(seconds)
    f = hz(note)
    p = 2*np.pi*f*t + .018*np.sin(2*np.pi*4.4*t)
    tone = np.sin(p)+.14*np.sin(2*p)+.035*np.sin(3*p)
    if alien:
        tone = tone*(.88+.12*np.sin(2*np.pi*6.7*t)) + .05*np.sin(p*1.007)
    return tone * edges(t, seconds, .7, 2.0)


def bass(note, seconds=1.16):
    t = timebase(seconds)
    p = 2*np.pi*hz(note)*t
    return (np.sin(p)+.28*np.sin(2*p)+.065*np.sin(3*p))*edges(t,seconds,.03,.5)*np.exp(-t/1.2)


def pulse(note, seconds=.55):
    t = timebase(seconds)
    p = 2*np.pi*hz(note)*t
    tone = np.sin(p) + .25*np.sin(2*p) + .075*np.sin(3*p)
    return tone * (1-np.exp(-t/.012))*np.exp(-t/.15)*edges(t,seconds,.005,.15)


def drum():
    t = timebase(.65)
    p = 2*np.pi*(48*t + 20*.028*(1-np.exp(-t/.028)))
    return np.sin(p)*np.exp(-t/.16)*edges(t,.65,.006,.1)


def brush(seconds=.25):
    t = timebase(seconds)
    x = sosfilt(butter(2,[550,2700],btype='bandpass',fs=SR,output='sos'),RNG.normal(size=len(t)))
    return x*np.exp(-t/.055)*edges(t,seconds,.008,.09)


def alien_breath(seconds=7.5):
    t = timebase(seconds)
    noise = sosfilt(butter(2,[180,1100],btype='bandpass',fs=SR,output='sos'),RNG.normal(size=len(t)))
    # Organic current under the A/E drone, not a loud sci-fi interruption.
    body = .60*np.sin(2*np.pi*110*t + .35*np.sin(2*np.pi*7*t))
    body += .22*np.sin(2*np.pi*165*t + .3*np.sin(2*np.pi*6.3*t))
    body += .20*noise
    return body*edges(t,seconds,2.5,3.0)*(.76+.24*np.sin(2*np.pi*.41*t)**2)


# Three 32-second acts; chord scenes last three bars at 90 BPM.
A = [45,52,57,59,60,64]       # Am(add9), A/E spine
F = [41,48,52,57,59,64]       # Fmaj7(#11), preserving A/E/B
D = [38,45,52,53,57,60]       # Dm9
E = [40,47,52,57,59,64]       # Esus4 with no dominant-third insistence
scenes = [A,F,D,E,A,F,D,E,A,F,E,A]
for i, chord in enumerate(scenes):
    start = i*8
    level = .25 if i<4 else (.29 if i<8 else .25)
    if i == 11:
        level = .27
    add(pad(chord,brightness=.7,alien=.8 if 8<=i<=10 else 0),start,level)

# Bare stable foundation opens the map before the harmony comes into focus.
add(bowed(33,10),0,.07)
add(bowed(40,10),.7,.035)

# Primary four-note identity: A - E - B - C, with answer C - B - A.
# Longer rests matter: this must leave attention available for map decisions.
phrases = [
    (8.0,  [69,76,71,72], .110, False),
    (24.0, [69,76,71,69], .100, False),
    (32.0, [69,76,71,72], .115, False),
    (48.0, [72,76,74,71], .118, False),
    (64.0, [69,76,70,71], .095, True),
    (80.0, [69,76,71,69], .098, True),
    (88.0, [69,76,71,69], .100, False),
]
for start, notes, gain, alien in phrases:
    for j,(beat,note) in enumerate(zip([0,2,5,6],notes)):
        add(key(note,4.8,long=True,shade=.7 if alien else 0),start+beat*BEAT,gain,
            pan=[-.15,.13,-.08,.10][j],echo=.7)

# Answers at a lower register keep the theme musical and conversational.
for start, notes, gain in [(17.33,[72,71,69],.065),(41.33,[72,71,69],.074),
                           (57.33,[74,72,71],.070),(90.66,[64,69],.060)]:
    for j,note in enumerate(notes):
        add(key(note,3.5,long=True),start+j*BEAT,gain,pan=.07,echo=.6)

# Subtle held countermelody enters as the expedition leaves safety.
for start,note,duration,gain in [(35.33,64,5,.035),(43.33,64,5,.035),
                                (51.33,65,5,.037),(59.33,64,5,.035),
                                (67.33,64,5,.03),(75.33,65,5,.03)]:
    add(bowed(note,duration,alien=start>64),start,gain,pan=-.22,echo=.35)

# Bass stays on roots; little pulse figures reinforce fifths rather than new melodies.
roots = [33,29,26,28]
pulse_sets = [[57,64,59,64],[57,64,59,60],[57,64,60,65],[59,64,57,64]]
for scene in range(4,11):
    start = scene*8
    idx = scene%4
    if scene == 10:
        idx = 3
    for k in range(6):
        at = start+k*2*BEAT
        lift = min(1,(at-28)/28)
        retreat = .80 if scene>=8 else 1
        add(bass(roots[idx]),at,(.085+.025*lift)*retreat)
        add(drum(),at,(.026+.020*lift)*retreat)
        add(brush(),at+BEAT,.013+.007*lift,pan=(-.25 if k%2 else .25))
    for k in range(12):
        at = start+k*BEAT
        lift = min(1,(at-28)/28)
        amp = (.019+.025*lift)*(.7 if scene>=8 else 1)
        add(pulse(pulse_sets[idx][k%4]),at+BEAT/2,amp,
            pan=(-.20 if k%2 else .20),echo=.3)

# Unfamiliar living modulation briefly inhabits the same A/E signal.
for at,pan,gain in [(64.0,-.28,.055),(71.5,.30,.05),(79.0,-.18,.04)]:
    add(alien_breath(),at,gain,pan=pan,echo=.8)

# Far-away A/E responses: dark upper registers, very sparse, not a busy radar imitation.
for at,note,gain,pan in [(3.33,76,.025,-.45),(20.0,76,.023,.40),
                        (45.33,81,.019,.40),(62.67,76,.019,-.45)]:
    add(key(note,5,long=True),at,gain,pan,echo=1.1)

# Final answer returns to an open A/E interval. Percussion ends before this point.
add(bowed(45,8),88,.065)
add(bowed(52,8),88.35,.038)

# A tiny air bed is band-limited and mostly disappears under the music.
t = timebase(DURATION)
air = sosfilt(butter(2,[250,1500],btype='bandpass',fs=SR,output='sos'),RNG.normal(size=len(t)))
air *= .003*edges(t,DURATION,8,12)*(.7+.3*np.sin(2*np.pi*.043*t)**2)
add(air,0,pan=.16)

# Common dark room. Feed-forward reflections cannot run away or extend past the fade.
dry = mix.copy()
for delay,gain in [(.073,.035),(.113,.030),(.197,.023),(.311,.018),(.487,.012)]:
    samples = round(delay*SR)
    tail = lowpass(dry[:-samples],1800)
    mix[samples:] += gain*tail[:,::-1]
del dry

mix = sosfilt(butter(2,25,btype='highpass',fs=SR,output='sos'),mix,axis=0)
mix = lowpass(mix,6200)
mix *= edges(t,DURATION,2.5,6.0)[:,None]

# Gentle saturation catches rare summed note peaks without a hard limiter.
pre_peak = float(np.max(np.abs(mix)))
mix = np.tanh(mix/pre_peak*.9)/np.tanh(.9)
mix *= 10**(-2.8/20)
pcm = np.round(np.clip(mix,-1,1)*32767).astype(np.int16)
OUT.parent.mkdir(parents=True,exist_ok=True)
wavfile.write(OUT,SR,pcm)

# Read the delivery bytes, not only the pre-write array.
read_sr,read_pcm = wavfile.read(OUT)
decoded = read_pcm.astype(np.float64)/32768
assert read_sr == SR and decoded.shape == (4_608_000,2)
assert np.isfinite(decoded).all()
assert np.max(np.abs(decoded)) <= 10**(-2.0/20)
assert np.all(read_pcm[0] == 0) and np.max(np.abs(read_pcm[-1])) <= 1

def rms_db(x):
    return float(20*np.log10(max(1e-12,np.sqrt(np.mean(x*x)))))

metadata = {
    'title':'Beyond the Signal / За пределами сигнала',
    'project':'Void Dominion / Sector Zero',
    'kind':'Original procedural electronic music demonstrator',
    'duration_seconds':DURATION,'bpm':BPM,'meter':'4/4',
    'tonal_center':'A; A/E fifth family shared with existing send/start UI signals',
    'theme_notes':'A - E - B - C; an altered B-flat shade in the alien section',
    'sample_rate':SR,'channels':2,'pcm_bits':16,
    'peak_dbfs':float(20*np.log10(np.max(np.abs(decoded)))),'rms_dbfs':rms_db(decoded),
    'stereo_correlation':float(np.corrcoef(decoded.T)[0,1]),
    'sections':[
        {'from':0,'to':32,'name':'Карта / спокойное исследование','rms_dbfs':rms_db(decoded[:32*SR])},
        {'from':32,'to':64,'name':'Нарастание напряжения / пульс','rms_dbfs':rms_db(decoded[32*SR:64*SR])},
        {'from':64,'to':88,'name':'Рой / изменение знакомого сигнала','rms_dbfs':rms_db(decoded[64*SR:88*SR])},
        {'from':88,'to':96,'name':'Возвращение A/E / затухание','rms_dbfs':rms_db(decoded[88*SR:])},
    ],
    'size_bytes':OUT.stat().st_size,
    'external_samples':False,'seamless_loop':False,
    'verification':'WAV decoded and checked for format, finite samples, headroom and near-zero endpoints. No subjective listening claimed.',
}
META.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(metadata,ensure_ascii=False,indent=2))
