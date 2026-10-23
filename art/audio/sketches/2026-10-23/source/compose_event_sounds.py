"""New event-sound sketches for Void Dominion, synthesized without external samples.

Shares the A/E interval, soft attacks and dark echoes of the existing WebAudio UI.
Does not modify or replace any of the game's six current interface sound patches.
"""
from pathlib import Path
import json
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'sfx'
OUT.mkdir(parents=True,exist_ok=True)
SR=48000
RNG=np.random.default_rng(231023)

def lowpass(x,hz):
    return sosfilt(butter(2,hz,fs=SR,output='sos'),x)

def envelope(t,at,attack,decay):
    u=np.maximum(t-at,0)
    return (t>=at)*np.minimum(u/attack,1)*np.exp(-np.maximum(u-attack,0)*6/decay)

def voice(t,f,at=0,attack=.018,decay=.65,level=.2,wave='sine',end=None,detune=0,lp=1800):
    u=np.maximum(t-at,0)
    if end is None:
        phase=f*u
    else:
        k=np.log(end/f)/(attack+decay)
        phase=f*np.expm1(k*u)/k
    osc=np.zeros_like(t)
    for shift in ([-detune,detune] if detune else [0]):
        p=2*np.pi*phase*2**(shift/1200)
        if wave=='triangle':
            y=sum((-1)**((h-1)//2)*np.sin(h*p)/(h*h) for h in range(1,12,2))
        elif wave=='softsaw':
            y=sum(np.sin(h*p)/h**1.55 for h in range(1,9))
        else:
            y=np.sin(p)+.025*np.sin(2*p)
        osc+=y/(2 if detune else 1)
    return lowpass(osc,lp)*envelope(t,at,attack,decay)*level

def echoes(x,wet=.25):
    z=np.column_stack([x,x])
    for channel,dt,feedback in [(0,.17,.34),(1,.29,.27)]:
        filtered=lowpass(x,1100)
        for repeat in range(1,9):
            n=round(dt*repeat*SR)
            if n>=len(x):break
            z[n:,channel]+=filtered[:-n]*wet*feedback**(repeat-1)
            z[n:,1-channel]+=filtered[:-n]*wet*.24*feedback**(repeat-1)
    return z

stats=[]
def finish(name,label,t,x,peak=-11,wet=.26):
    x=echoes(x,wet)
    x-=x.mean(axis=0)
    x*=np.minimum(t/.015,1)[:,None]
    x*=np.minimum((t[-1]-t)/.25,1)[:,None]
    x*=10**(peak/20)/max(1e-9,np.abs(x).max())
    assert np.isfinite(x).all() and np.abs(x).max()<1
    pcm=np.round(x*32767).astype(np.int16)
    wavfile.write(OUT/(name+'.wav'),SR,pcm)
    stats.append({'file':'sfx/'+name+'.wav','name':label,'duration':len(x)/SR,
                  'peak_dbfs':round(20*np.log10(np.abs(x).max()),2),
                  'rms_dbfs':round(20*np.log10(np.sqrt(np.mean(x*x))),2)})

t=np.arange(SR*3)/SR
x=sum(voice(t,f,at=a,attack=.015,decay=.62,level=v,wave='triangle') for f,a,v in [(220,0,.20),(330,.11,.17),(440,.23,.15),(659.255,.36,.085)])
x+=voice(t,110,attack=.12,decay=1.1,level=.055,wave='softsaw',detune=6,lp=550)
finish('01_research_complete','Исследование завершено',t,x,-11,.32)

t=np.arange(round(SR*3.2))/SR
x=np.zeros_like(t)
for at in [0,.46]:
    x+=voice(t,110,at,attack=.025,decay=.45,level=.18,end=103.83,lp=700)
    x+=voice(t,116.54,at,attack=.025,decay=.36,level=.055,wave='softsaw',lp=650)
    x+=voice(t,55,at,attack=.045,decay=.58,level=.095)
finish('02_territory_threat','Угроза территории',t,x,-9,.20)

t=np.arange(round(SR*4.2))/SR
x=np.zeros_like(t)
for f,at,level in [(110,0,.07),(164.81,.12,.075),(220,.3,.11),(261.63,.48,.055),(329.63,.65,.085),(440,.86,.075)]:
    x+=voice(t,f,at,attack=.09,decay=1.15,level=level,wave='softsaw' if f<200 else 'triangle',detune=5 if f<200 else 0,lp=950)
finish('03_objective_complete','Задача выполнена',t,x,-10,.38)

t=np.arange(round(SR*4.2))/SR
env=envelope(t,0,.32,2.6)
texture=np.sin(2*np.pi*110*t+1.35*np.sin(2*np.pi*41.2*t))
x=lowpass(texture,900)*env*.10
x+=voice(t,55,attack=.30,decay=2.7,level=.11)
x+=voice(t,164.81,at=.24,attack=.24,decay=1.8,level=.06,detune=9)
for at,f in [(.50,440),(1.04,415.30),(1.62,330)]:
    x+=voice(t,f,at,attack=.035,decay=.45,level=.045,wave='triangle',lp=1100)
grain=lowpass(RNG.normal(size=len(t)),1600)-lowpass(RNG.normal(size=len(t)),400)
x+=lowpass(grain,1800)*env*.014*(.45+.55*np.sin(2*np.pi*4.1*t)**2)
finish('04_swarm_contact','Контакт с Роем',t,x,-11,.44)

t=np.arange(round(SR*3.4))/SR
x=np.zeros_like(t)
for at,f,g in [(0,440,.16),(.18,330,.13),(.38,220,.1),(.61,110,.06)]:
    x+=voice(t,f,at,attack=.008,decay=.38,level=g,end=f*.94,lp=1300)
grain=lowpass(RNG.normal(size=len(t)),1100)
x+=grain*envelope(t,.22,.03,.38)*.045
finish('05_link_lost','Связь потеряна',t,x,-11,.18)

t=np.arange(round(SR*3.1))/SR
x=np.zeros_like(t)
for at,f,g in [(0,220,.13),(.16,330,.12),(.34,440,.11)]:
    x+=voice(t,f,at,attack=.025,decay=.65,level=g,wave='triangle',lp=1700)
x+=voice(t,110,at=.2,attack=.12,decay=1,level=.045,wave='softsaw',detune=5,lp=650)
finish('06_link_restored','Связь восстановлена',t,x,-11,.30)

sequence=[np.zeros((round(.7*SR),2),dtype=np.int16)]
timeline=[]
position=.7
for item in stats:
    sr,a=wavfile.read(ROOT/item['file'])
    timeline.append({'start':round(position,2),'name':item['name']})
    sequence.extend([a,np.zeros((round(.8*SR),2),dtype=np.int16)])
    position+=len(a)/SR+.8
preview=ROOT/'void-dominion-event-sounds.wav'
wavfile.write(preview,SR,np.concatenate(sequence))
meta={'sample_rate':SR,'channels':2,'effects':stats,'preview_timeline':timeline,'preview_duration':position}
(ROOT/'sfx_metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(meta,ensure_ascii=False,indent=2))
