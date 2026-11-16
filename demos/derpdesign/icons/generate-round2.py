from generate import render, path, line, circle, eye, ink, blue, mint, orange, coral
white='#fff7e8'; lilac='#c6a5ee'; yellow='#f6dc80'
def eyes(x1,y1,x2,y2):return circle(x1,y1,7,white)+circle(x2,y2,8,white)+eye(x1+2,y1+1,2.5)+eye(x2-2,y2+2,3)
items=[
('21','Buffering','One thought. Still loading.',circle(32,33,23,blue)+eyes(23,27,41,25)+path('M23 39h23l-8 8H23Z',orange)+line('M25 8l-3-5m14 5 3-5',blue,4)),
('22','Breadbird','Freshly toasted, lightly confused',path('M15 26C-1 8 27 3 32 13c12-14 34 0 18 14v28H15Z',orange)+path('M20 25q-8-11 6-9l6 5 7-5q13-1 6 10v23H20Z',white)+eye(26,31)+eye(40,29)+path('M27 38h14l-7 8Z',coral)),
('23','Long boi','More neck than necessary',path('M16 53V20q0-13 13-13h8q15 0 13 15L35 29v24Z',mint)+path('M36 19h26v9H36Z',orange)+eye(33,16)+path('M11 53h30v6H11Z',mint)),
('24','Splat','Aerodynamics were optional',path('M7 35l9-5-5-13 14 5 5-16 8 16 17-10-7 18 13 7-14 5 2 14-15-8-14 10-1-14-14-1Z',coral)+eyes(25,29,39,27)+path('M26 39h16l-8 7Z',orange)),
('25','Big bill','The beak has its own postcode',path('M8 51V25q1-17 20-14 14 3 13 22v18Z',blue)+path('M27 28h26q10 1 10 11v5H27Z',yellow)+line('M38 38h18',orange,2)+eye(27,22)),
('26','Peeker','Definitely watching your tabs',path('M5 52h54v8H5Z',blue)+path('M15 51V32q0-17 17-17 17 0 17 17v19Z',mint)+eyes(24,31,40,30)+path('M27 42h12l-6 8Z',orange)+line('M9 52h11m25 0h10',orange,5)),
('27','Upside down','A fresh perspective on the web','<g transform="rotate(180 32 32)">'+path('M14 47V29a18 18 0 0 1 36 0v18Z',lilac)+eyes(24,28,40,26)+path('M26 38h14l-7 9Z',orange)+line('M24 47v9m15-9v9',orange,4)+'</g>'),
('28','Two braincells','Both currently in use',circle(22,35,17,blue)+circle(43,30,16,mint)+circle(19,29,7,white)+eye(21,30)+circle(44,25,7,white)+eye(42,27)+path('M19 39l15-3-6 11Z',orange)+path('M42 35l16 3-13 8Z',orange)),
('29','Round trip','A rubber duck in a donut',circle(32,37,22,coral)+circle(32,37,11,ink)+path('M25 31V15q0-12 13-10 13 2 9 15l-8 11Z',yellow)+path('M41 14h20v9H41Z',orange)+eye(38,12,2.5)+path('M10 39l-7-8 14 3Z',coral)),
('30','Helmet head','Ready for a very small adventure',circle(32,32,24,blue)+path('M9 33h46v17q-24 13-46 0Z',blue)+path('M13 25q20-10 38 0v15q-20 8-38 0Z',ink)+circle(24,31,4,white)+circle(41,29,5,white)+path('M26 40h15l-7 9Z',orange)+line('M31 6v9',mint,4)),
('31','Grumpy','Blocks popups with its face',path('M9 15l10 5q15-10 31 0l6-5v28Q33 65 9 43Z',lilac)+path('M15 26l15 5-5 7H15Zm34 0-15 5 5 7h10Z',white)+eye(23,32,2)+eye(41,32,2)+path('M26 41h14l-7-7Z',orange)),
('32','Flamingo','A question mark with feathers',line('M29 52V40q-15 0-15-9 0-7 14-7h12V14q-1-6-8-6',coral,10)+path('M29 5h15v10H29Z',coral)+path('M40 8h15v9H42Z',ink)+eye(36,9,2)+line('M29 46v13h9',orange,3)),
('33','Speed bump','Very fast. Very horizontal.',path('M8 43q-2-19 20-19h15q16 0 16 19Z',mint)+eyes(35,27,48,24)+path('M45 36h18v7H45Z',orange)+line('M5 20h15M3 28h9M14 48h30',blue,3)),
('34','Satellite','Receiving questionable ideas',circle(32,35,20,blue)+line('M32 16V8m-3 0h6',blue,3)+circle(32,5,4,coral)+eyes(24,30,40,28)+path('M26 41h14l-7 8Z',orange)+path('M8 25L1 17v25l10 4Zm48 0 7-8v25l-10 4Z',mint)),
('35','Sneaky','Incognito, but not very subtle',path('M14 53V29a18 18 0 0 1 36 0v24Z',mint)+path('M9 24h47v9H9Zm10-3 5-15h18l6 15Z',lilac)+path('M16 34h14v9H16Zm19 0h14v9H35Z',ink)+line('M28 36h8',ink,3)+path('M28 45h13l-6 8Z',orange)),
('36','Wobble','Built like a friendly jellybean',path('M17 15Q33-1 46 15l11 27q1 16-17 16H17Q1 56 7 41Z',yellow)+eyes(24,25,39,29)+path('M24 40l18-3-7 12Z',orange)+path('M13 36l-9-7-1 18 10-3Zm38-4 11-6-2 19-8-3Z',yellow)),
('37','Origami goose','Folded once, escaped immediately',path('M5 43l22-13 4-23h13l-2 21 17 9-21 18Z',white)+path('M5 43l33 12-11-25Z',blue)+path('M42 9l17 7-17 4Z',orange)+eye(37,12,2)+path('M27 30l15-2-4 27Z',lilac)),
('38','Tab hoarder','Three tabs and one brain',path('M8 53V24h12V10h14v12h11V15h12v38Z',blue)+eyes(23,33,42,31)+path('M26 43h17l-9 9Z',orange)+path('M10 17h8v5h-8Zm13-14h8v5h-8Zm24 5h8v5h-8Z',mint)),
('39','Egg error','Successfully failed to hatch',path('M10 48Q8 24 30 7q25 14 24 41Z',white)+eyes(24,25,39,24)+path('M26 35h14l-7 8Z',orange)+path('M7 37l11 7 9-6 9 8 11-7 10 6-3 12H12Z',blue)),
('40','Royal derp','A tiny ruler of too many tabs',circle(32,36,22,mint)+path('M14 19 10 3l14 9L32 1l9 11 13-9-4 16Z',yellow)+eyes(23,31,40,28)+path('M22 43q12-8 25 0v6H22Z',orange)+circle(32,14,3,coral))]
render(items, 'round2', '20 more icon concepts')
