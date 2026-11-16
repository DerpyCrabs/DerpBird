from generate import render, path, line, circle, eye, orange, blue, mint, coral, ink, root
Y='#f6dc80'; W='#fff7e8'; O='#ef9a51'; wing='#e9bc58'
def ellipse(x,y,rx,ry,c):return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{c}"/>'
def group(art,transform):return f'<g transform="{transform}">{art}</g>'
def bill():return path('M43 19h12q6 0 6 5v3H42Z',orange)
def side():return path('M10 31l12 5q11-8 22 0 9 7 1 16H20Q8 48 10 31Z',Y)+circle(39,22,12,Y)+bill()+eye(39,19,2.6)+path('M20 38q13-4 15 6-9 9-15-6Z',wing)
def front():return ellipse(32,38,18,17,Y)+circle(32,24,17,Y)+circle(25,22,6,W)+circle(40,20,7,W)+eye(27,23,2.7)+eye(38,22,2.7)+path('M19 30q14-5 28 0v7H19Z',orange)
items=[
('41','Trip hazard','One foot. Two problems.',group(side(),'rotate(24 32 35)')+line('M26 48l-7 7h-9m28-6 9 3 8-7',O,4)+line('M7 16l5 5m2-12 3 5',blue,2.5)),
('42','Wrong feet','Left, right… wait.',front()+line('M25 50l13 8h9M39 50l-13 8H16',O,4)+path('M14 31 3 21q-5 17 13 21Zm35-2 10-9q7 16-10 20Z',Y)),
('43','Face first','The landing needs work.',ellipse(33,54,26,4,blue)+group(side(),'rotate(58 32 35) translate(-2 -5)')+line('M20 41 9 32l-4 5m25 9-8-17-6 3',O,4)+line('M52 43l5-5m-5 11 8-1',coral,2.5)),
('44','Slippery','Waterfowl. Bad at water.',ellipse(32,55,27,5,blue)+group(side(),'rotate(-26 32 36)')+line('M25 47 14 49l-8-4m31 6 10-2 7-6',O,4)+line('M5 40 2 36m55 17 5-4',blue,3)),
('45','Dizzy duck','Circling back. Literally.',front()+path('M19 53h12v6H15Zm18 0h12l5 6H37Z',orange)+line('M18 20l8 4-8 2m24-7-8 4 8 2',ink,2.5)+ellipse(32,6,20,4,blue)+path('M49 3 58 7l-9 3Z',blue)),
('46','Big flippers','Still growing into them.',ellipse(32,35,13,16,Y)+circle(32,21,13,Y)+eye(26,19,2.5)+eye(39,17,2.5)+path('M22 26h24v8H22Z',orange)+path('M25 46l-15 2L2 59h27V47Zm12 0 16 2 9 11H34V47Z',orange)+line('M8 56h13m22 0h12',O,2)),
('47','Wing panic','No idea what these do.',front()+path('M17 35Q1 28 3 11l8 9 2-12q12 14 4 27Zm31 0q16-7 13-24l-7 10-3-13q-12 13-3 27Z',Y)+line('M25 52l-5 6h-7m26-6 5 6h7',O,4)),
('48','Oops','A small bump. A brave face.',group(front(),'rotate(-12 32 32)')+path('M18 53h14v6H14Zm20-1h12l5 7H37Z',orange)+group('<rect x="18" y="9" width="20" height="8" rx="3" fill="#e7ad8a"/>'+line('M27 11v4',W,2),'rotate(20 28 13)')+path('M52 18q9 7 1 10-7-3-1-10Z',blue)),
('49','Tailspin','Duck.exe has rotated.',group(side(),'rotate(155 32 32)')+group(line('M22 49v9h-8m23-9 5 9h8',O,4),'rotate(155 32 32)')+line('M45 48q-4 11-19 9m-6-1 5-3m-5 3 4 4',blue,3)),
('50','Beak brake','Stopping distance: one beak.',path('M5 40l12-5q9-11 22-1 7 5 1 16H19Q9 49 5 40Z',Y)+circle(41,29,12,Y)+path('M47 27h11v-7h5v18H47Z',orange)+circle(43,25,6,W)+eye(46,25,2.6)+path('M16 38q12-2 13 5-9 8-13-5Z',wing)+line('M19 50l-7 6h-5m27-6-5 6h-7',O,3)+line('M4 25h13M2 31h8',blue,2.5))]
render(items,'ducks','10 clumsy ducks')
# A two-column sheet gives each pose room at conversation width.
for filename in ('ducks.html','ducks-gallery.html'):
 p=root/filename;s=p.read_text().replace('repeat(4,minmax(0,1fr))','repeat(2,minmax(0,1fr))');p.write_text(s)
