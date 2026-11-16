from generate import render, path, line, circle, ink, blue, mint, orange, coral, root
V='#bba8ff'; W='#eef3ff'; T='#54cbbd'
def ring(x=32,y=32,r=23,c=blue,w=5):return f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c}" stroke-width="{w}"/>'
def rect(x,y,w,h,c=blue,r=5):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}"/>'
def box(x,y,w,h,c=blue,r=5,s=4):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="none" stroke="{c}" stroke-width="{s}"/>'
def globe(c=blue):return ring(c=c)+f'<ellipse cx="32" cy="32" rx="11" ry="23" fill="none" stroke="{c}" stroke-width="3"/>'+line('M10 25h44M10 39h44',c,3)
items=[
('01','Meridian','A precise, open web',globe()),
('02','Horizon','A new view, every day',circle(32,32,25,blue)+path('M8 36h48v7H8Z',ink)+path('M11 47h42v5H11Z',ink)+path('M17 30a15 15 0 0 1 30 0Z',W)),
('03','Open orbit','A clear path beyond the frame',line('M31 9a23 23 0 1 0 23 23',V,7)+line('M35 29 54 10m-15 0h15v15',mint,6)),
('04','Latitude','Three bands, one world',line('M12 18Q32 5 52 18M8 32h48M12 46q20 13 40 0',blue,7)+line('M30 10q-15 22 0 44m4-44q15 22 0 44',mint,3)),
('05','Globe cut','A globe carved from a solid disc',circle(32,32,25,T)+line('M7 32h50M32 7q-20 25 0 50M32 7q20 25 0 50',ink,5)),
('06','World window','The internet, framed',box(7,11,50,42)+line('M8 22h48',blue,4)+circle(15,17,2,mint)+circle(22,17,2,mint)+ring(32,37,11,mint,3)+line('M21 37h22M32 26v22',mint,2)),
('07','Single tab','One familiar, confident shape',path('M7 53V18q0-7 7-7h15l7 9h16q5 0 5 6v27Z',blue)+rect(14,28,36,18,ink,3)+line('M21 36h15',mint,4)),
('08','Stack','A browser built for many views',box(19,6,38,36,V,5,4)+rect(8,20,39,37,blue,6)+rect(14,31,27,19,ink,3)+circle(16,26,2,ink)+circle(23,26,2,ink)),
('09','Split','Two spaces, one browser',rect(6,9,52,46,blue,8)+rect(12,21,18,28,ink,3)+rect(34,21,18,28,mint,3)+circle(15,15,2,ink)+circle(22,15,2,ink)),
('10','Cornerstone','A window drawn with four corners',line('M24 9H10v15m30-15h14v15M10 40v14h14m16 0h14V40',blue,7)+rect(25,25,14,14,mint,3)),
('11','Overlook','A panoramic window',box(5,13,54,38,blue,8,5)+line('M6 25h52M39 26v24',blue,4)+path('M12 44l9-11 11 11Z',mint)),
('12','Tab weave','Interlocking browsing spaces',path('M6 16h33v10H16v22H6Z',blue)+path('M25 6h33v32H48V16H25Z',mint)+path('M25 38h13v10h20v10H25Z',V)),
('13','North','A restrained compass mark',ring(c=blue,w=4)+path('M42 14 38 38 17 50 24 26Z',mint)+path('M42 14 24 26 38 38Z',W)),
('14','Forward','Navigation reduced to one gesture',rect(7,7,50,50,blue,13)+line('M19 32h26M33 20l12 12-12 12',ink,6)),
('15','Waypoint','A path into the open web',line('M12 49V17h30',V,8)+path('M33 6l22 11-22 11Z',mint)+circle(12,49,6,mint)),
('16','Traverse','A route through two portals',box(7,11,22,42,blue,11,5)+box(35,11,22,42,mint,11,5)+line('M20 32h24',W,5)),
('17','Launch','A diagonal opening',rect(8,8,48,48,V,10)+path('M20 19h25v25h-7V31L21 48l-6-6 17-16H20Z',ink)),
('18','Flow','Continuous, effortless navigation',line('M10 40q0-23 16-23 13 0 13 15T54 47',blue,8)+path('M44 34l15 14-18 7Z',mint)),
('19','Portal D','A doorway inside the initial',path('M11 7h20q27 0 27 25T31 57H11Z',blue)+path('M23 19h8q15 0 15 13T31 45h-8Z',ink)+path('M23 19h7v26h-7Z',mint)),
('20','Bracket D','The web, without a literal globe',line('M22 12H10v40h12',blue,6)+path('M31 9q25 0 25 23T31 55V44q14 0 14-12T31 20Z',mint)),
('21','Ribbon B','Two folded browsing surfaces',path('M12 7h24l16 13-15 12 18 13-17 12H12Z',V)+path('M23 17v10l16-5Zm0 22v10l17-5Z',ink)),
('22','Double pane','A geometric db monogram',line('M27 9v31',blue,7)+ring(16,40,11,blue,7)+line('M38 9v31',mint,7)+ring(49,40,11,mint,7)),
('23','Arch','An opening, rather than a container',path('M8 56V29Q8 7 32 7t24 22v27H44V30q0-12-12-12T20 30v26Z',blue)+rect(28,39,8,17,mint,2)),
('24','Keystone','A compact architectural mark',path('M10 12h44l-8 43H18Z',V)+path('M24 23h16l-3 21H27Z',ink)),
('25','Prism','A change of perspective',path('M32 5 58 20v25L32 59 6 44V20Z',blue)+path('M32 5v27L6 44V20Z',mint)+path('M32 32 58 20v25L32 59Z',V)+path('M32 20 44 27l-12 7-12-7Z',ink)),
('26','Aperture','A window onto everything',ring(c=V,w=8)+path('M32 8 47 34H32L19 12Zm24 27L26 51V35h30ZM15 50 15 19l14 8v30Z',blue)),
('27','Nexus','Four routes, a common center',rect(7,7,21,21,blue,6)+rect(36,7,21,21,mint,6)+rect(7,36,21,21,V,6)+rect(36,36,21,21,blue,6)+path('M26 26h12v12H26Z',W)),
('28','Focus','A single point in an open frame',line('M23 8H8v15m33-15h15v15M8 41v15h15m18 0h15V41',mint,5)+ring(r=11,c=blue,w=6)),
('29','Current','Three moving layers',path('M7 16q12-12 25 0t25 0v10q-12 12-25 0T7 26Z',blue)+path('M7 33q12-12 25 0t25 0v10q-12 12-25 0T7 43Z',mint)+path('M7 50q12-12 25 0t25 0v6H7Z',V)),
('30','Continuum','An unbroken connection',line('M27 21C10 2-5 39 14 48c12 7 22-12 26-23 8-21 28-2 16 17-8 13-19 2-25-5',blue,8)+line('M28 23l8 16',mint,8))]
render(items,'browser','DerpBrowser / 30 browser marks')
for name in ('browser.html','browser-gallery.html'):
 p=root/name;s=p.read_text().replace('DerpBird — DerpBrowser / 30 browser marks','DerpBrowser — 30 browser marks').replace('height:114px','height:82px').replace('width:88px;height:88px','width:72px;height:72px').replace('min-height:31px','min-height:28px').replace('padding:16px;min-width','padding:12px;min-width');p.write_text(s)
