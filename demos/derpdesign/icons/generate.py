"""Editable vector concepts; regenerate the gallery and individual SVGs."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent
ink='#152033'; blue='#adc6ff'; mint='#8be0c4'; orange='#ffbf78'; coral='#ff9695'
def eye(x,y,r=3):return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{ink}"/>'
def path(d,c=blue):return f'<path d="{d}" fill="{c}"/>'
def line(d,c=blue,w=5):return f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
def circle(x,y,r,c):return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>'
items=[
('01','Sidekick','A round bird with a bold beak',path('M12 44V32a20 20 0 0 1 40 0v12Q32 58 12 44Z')+path('M42 31h19L46 42Z',orange)+eye(38,25)+path('M16 34q19-3 16 15Q19 50 16 34Z','#7196e5')),
('02','Derpy duck','Uneven eyes, unmistakably a duck',circle(32,31,23,mint)+circle(23,25,7,'#fff')+circle(40,22,8,'#fff')+eye(25,26)+eye(38,24)+path('M19 36q14-7 28 0v7H19Z',orange)),
('03','Cockatiel','A crest and a cheek dot',path('M15 50V30Q15 14 34 17L26 5l13 8 7-8v16q11 10 3 29Z')+path('M44 29l13 6-13 5Z',orange)+eye(38,28)+circle(35,39,5,coral)),
('04','Puffin','A pale face and a bright beak',path('M12 52V29a20 20 0 0 1 40 0v23Z',blue)+path('M23 50V30q0-14 16-12 10 2 10 15v17Z','#f8f4e9')+path('M43 29l18 9-18 6Z',orange)+eye(38,28)),
('05','Kiwi','A tiny bird with a long beak',path('M9 40q-2-20 17-20 15-1 17 13 0 17-19 16Z',mint)+circle(40,26,10,mint)+path('M46 27l17 10-19-4Z',orange)+eye(43,24,2.5)+line('M20 48v7m13-8v8',mint,4)),
('06','Swift','One bold, fast silhouette',path('M4 15l26 11L51 9 43 28l17 8-19 5-17 17 1-20Z')+eye(42,31,2)),
('07','Paperbird','Folded wings, a playful angle',path('M5 18l54-8-21 46-9-21Z',mint)+path('M5 18l24 17 30-25Z','#d7fff1')+path('M29 35l9 21 3-29Z','#48ac91')),
('08','Hummingbird','A little precision and speed',path('M27 34L8 8q29 6 28 24L51 20l12 1-12 5-12 16-7 15-3-14-15 2Z',blue)+path('M27 34L7 30l15 13Z',mint)+eye(46,24,1.8)),
('09','Loopwing','A continuous ribbon in flight',line('M8 40C5 13 27 10 34 29S56 48 56 25C56 9 41 11 32 30S15 58 8 40',blue,8)+path('M51 17l11 6-10 4Z',orange)),
('10','Comet bird','A bird with a trailing wing',path('M7 47l14-16L6 30l25-12q25-12 25 11 0 23-31 23l10-11Z',coral)+path('M48 26l14 6-14 5Z',orange)+eye(44,23,2.5)),
('11','Worldbird','Bird face inside a globe',circle(32,32,25,blue)+line('M8 32h48M32 7c-17 14-17 36 0 50M32 7c17 14 17 36 0 50',ink,2.5)+circle(32,32,15,blue)+eye(26,29,2.5)+eye(38,29,2.5)+path('M27 36h10l-5 7Z',orange)),
('12','Tab perch','A bird perched on a browser tab',line('M8 49V24h18l5-7h25v32Z',blue,5)+circle(30,32,10,mint)+path('M23 38l-7 6h18l5-11Z',mint)+path('M38 29l9 4-9 3Z',orange)+eye(32,29,2)),
('13','Portal','A bright beak crossing an open ring',line('M48 13a24 24 0 1 0 7 28',blue,8)+path('M26 20q19-8 20 13v12H24Z',mint)+path('M40 27l21 8-21 6Z',orange)+eye(36,26,2.5)),
('14','Compass','A small bird with a sense of direction',circle(32,32,25,blue)+path('M16 45l13-27 20-2-10 21Z',ink)+path('M29 18l10 19-23 8Z',mint)+circle(40,22,2,'#fff')),
('15','Cursor chick','A cursor with a curious face',path('M13 7v47l13-11 8 15 9-5-8-15h20Z',blue)+circle(24,26,5,'#fff')+circle(37,31,5,'#fff')+eye(25,27,2)+eye(36,31,2)),
('16','Little d','A lowercase d turns into a bird',line('M43 9v28a16 16 0 1 1-16-16h16',blue,9)+path('M42 25l17 8-17 6Z',orange)+eye(43,18,2.5)),
('17','Wing B','A B built from two folded wings',path('M14 8h16q26 0 18 20 17 22-9 28H14Z',blue)+path('M24 18l18 5-18 9Zm0 19 22 7-22 4Z',ink)),
('18','Pixel pal','A deliberately goofy bitmap bird',path('M16 12h32v8h8v24h-8v8H16v-8H8V20h8Z',mint)+path('M16 20h8v8h-8Zm24 4h8v8h-8Z',ink)+path('M24 36h32v8H24Z',orange)+path('M16 52h8v8h-8Zm24 0h8v8h-8Z',mint)),
('19','Night owl','A compact, angular night bird',path('M9 9l13 9h20l13-9v29L32 57 9 38Z',blue)+path('M14 25l16 5-7 11Zm36 0-16 5 7 11Z','#fff')+eye(23,32,3)+eye(41,32,3)+path('M27 40h10l-5 7Z',orange)),
('20','Orbit egg','A hatchling peeking out of its orbit',path('M17 39Q13 20 32 7q20 14 15 32Z',mint)+eye(26,28,3)+eye(38,26,3)+path('M28 35h9l-5 6Z',orange)+line('M11 32C-3 47 30 63 52 44q13-12 1-17',blue,5))]
def render(items, stem='', title='20 icon concepts'):
    # Each SVG is independent and remains editable.
    (root/'svg').mkdir(exist_ok=True)
    cards=[]
    for number,name,desc,art in items:
     svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{name}">{art}</svg>'
     (root/'svg'/f'{number}-{name.lower().replace(" ","-")}.svg').write_text(svg)
     cards.append(f'<article><header><span>{number}</span><b>{name}</b></header><div class="hero">{svg}</div><div class="samples"><span class="small dark">{svg}</span><span class="small light">{svg}</span><span class="tiny">{svg}</span></div><p>{desc}</p></article>')
    css='''*{box-sizing:border-box}body{margin:0;color:var(--foreground,#edf0f8);font-family:var(--font-sans,Arial,sans-serif)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}article{border:1px solid var(--border,#343943);background:var(--card,#1b2029);border-radius:var(--radius,12px);padding:16px;min-width:0}header{display:flex;align-items:center;gap:9px;font-size:13px}header span{font-size:11px;color:var(--muted-foreground,#919aad);font-family:monospace}b{font-weight:600}.hero{height:114px;display:flex;align-items:center;justify-content:center}.hero svg{width:88px;height:88px}.samples{display:flex;align-items:center;gap:7px}.small{display:flex;padding:5px;border-radius:8px}.small svg{width:32px;height:32px}.dark{background:#11151d}.light{background:#f3eee5}.tiny svg{width:16px;height:16px}.sizes{font:9px monospace;color:var(--muted-foreground,#919aad);margin-left:auto}p{font-size:11px;line-height:1.4;color:var(--muted-foreground,#a5adbd);margin:12px 0 0;min-height:31px}@media(max-width:540px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sizes{display:none}}'''
    html=f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DerpBird — {title}</title><style>'+css+'</style><main class="grid">'+''.join(cards)+'</main>'
    (root/f'{stem}-gallery.html' if stem else root/'gallery.html').write_text(html)
    (root/f'{stem}.html' if stem else root/'index.html').write_text(html+'<script type="module">import {runScenario} from "@derpdesign/harness";runScenario(async()=>{});</script>')
    (root/'vite.config.ts').write_text("export default {root:import.meta.dirname,server:{host:'127.0.0.1',strictPort:true}};\n")
    print(f'Created {len(items)} SVGs and gallery')

if __name__ == '__main__':
    render(items)
