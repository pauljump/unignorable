#!/usr/bin/env python3
"""Rebuild Curbnote's vector masters and PNG exports with rsvg-convert (no network)."""
from pathlib import Path
import subprocess
import json
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/brand'
OUT.mkdir(parents=True, exist_ok=True)
INK='#142722'; PAPER='#F6F3E9'; ACCENT='#72E2BD'; MUTED='#BBC9C0'
def svg(w,h,body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
def mark(x=0,y=0,size=1024):
    return f'<g transform="translate({x} {y}) scale({size/1024})"><path d="M710 300H422Q302 300 302 420V604Q302 724 422 724H710" fill="none" stroke="{ACCENT}" stroke-width="104" stroke-linecap="round"/><path d="M646 445H756Q778 445 778 467V541Q778 563 756 563H689L646 598V563Q624 563 624 541V467Q624 445 646 445Z" fill="{PAPER}"/><path d="M660 486H743M660 522H715" stroke="{INK}" stroke-width="13" stroke-linecap="round"/></g>'
def text(x,y,s,content,color=PAPER,weight=700,spacing=-1):
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="Helvetica Neue,Arial,sans-serif" font-size="{s}" font-weight="{weight}" letter-spacing="{spacing}">{content}</text>'
def save(name,w,h,body,png=True):
    path=OUT/(name+'.svg');path.write_text(svg(w,h,body))
    if png: subprocess.run(['rsvg-convert',str(path),'-o',str(OUT/(name+'.png'))],check=True)
icon=f'<path fill="{INK}" d="M0 0H1024V1024H0Z"/>'+mark()
save('curbnote-icon-v1',1024,1024,icon)
save('curbnote-mark-v1',1024,1024,mark(),False)
save('curbnote-wordmark-v1',610,160,mark(-24,-12,184)+text(142,103,72,'curbnote'),False)
for size in [32,180,192,512]:
    subprocess.run(['rsvg-convert','-w',str(size),'-h',str(size),str(OUT/'curbnote-icon-v1.svg'),'-o',str(OUT/f'curbnote-icon-{size}-v1.png')],check=True)
# Simplified favicon: the same C silhouette, without tiny note details.
save('curbnote-favicon-v1',64,64,f'<rect width="64" height="64" rx="14" fill="{INK}"/><path d="M45 18H27Q18 18 18 27V37Q18 46 27 46H45" fill="none" stroke="{ACCENT}" stroke-width="8" stroke-linecap="round"/><rect x="40" y="27" width="10" height="10" rx="3" fill="{PAPER}"/>',False)
def artwork():
    return '<g transform="translate(820 0)"><path d="M-16 0V630M104 0V630M224 0V630M344 0V630M-100 80H400M-100 210H400M-100 340H400M-100 470H400M-100 600H400" stroke="#365044" stroke-width="2"/><rect x="25" y="250" width="94" height="78" rx="16" fill="#254235"/><rect x="145" y="380" width="92" height="76" rx="16" fill="#254235"/></g>'+mark(660,72,620)
for name,lines,description in [
 ('curbnote-share-walk-v1',['Know your','walk.'],'A little local knowledge. A more considered walk.'),
 ('curbnote-share-record-v1',['Every block','has a story.'],'Read the evidence. Check what changed.')]:
    body=f'<rect width="1200" height="630" fill="{INK}"/>'+artwork()
    body+=mark(28,8,128)+text(144,98,42,'curbnote')
    body+=text(64,265,82,lines[0])+text(64,353,82,lines[1],ACCENT)
    body+=text(66,421,23,description,PAPER,400,0)
    body+=f'<path d="M64 506H642" stroke="#466050"/>'+text(66,554,18,'NYC  /  WALKING + BLOCK KNOWLEDGE',MUTED,500,1.4)
    save(name,1200,630,body)
save('curbnote-social-square-v1',1080,1080,f'<rect width="1080" height="1080" fill="{PAPER}"/>'+text(68,112,54,'curbnote',INK)+f'<rect x="624" y="48" width="388" height="388" rx="84" fill="{INK}"/>'+mark(624,48,388)+text(64,581,114,'Know your',INK)+text(64,701,114,'walk.',INK)+text(70,813,31,'Choose your route. Read the block.',INK,400,0)+f'<path d="M70 919H1010" stroke="#CDCFC1"/>'+text(70,978,23,'NYC  /  FREE EARLY ACCESS',INK,500,2))
# Native assets share exactly the same artwork; the OS applies the icon corner mask.
iconset=ROOT/'ios/Unignorable/Sources/Assets.xcassets/AppIcon.appiconset'
(iconset/'AppIcon-1024.png').write_bytes((OUT/'curbnote-icon-v1.png').read_bytes())
markset=ROOT/'ios/Unignorable/Sources/Assets.xcassets/CurbnoteMark.imageset';markset.mkdir(exist_ok=True)
subprocess.run(['rsvg-convert','-w','192','-h','192',str(OUT/'curbnote-mark-v1.svg'),'-o',str(markset/'CurbnoteMark.png')],check=True)
(markset/'Contents.json').write_text(json.dumps({'images':[{'filename':'CurbnoteMark.png','idiom':'universal'}],'info':{'author':'xcode','version':1}},indent=2)+'\n')
print('Built Curbnote vector masters, social cards, favicon, web icons and native assets.')
