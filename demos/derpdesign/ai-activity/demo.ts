/** Visual prototype only. Production automation is not connected to this timeline. */
export function mountActivityDemo(host: HTMLElement, options: {time?:number} = {}) {
 const root=document.createElement('div');root.className='ai-demo';
 root.innerHTML=`<div class="ad-site"><div class="ad-brand"><span class="ad-mark">n</span> notebook <span class="ad-project">/ Website</span></div><span class="ad-avatar">М</span></div>
 <main class="ad-main"><div class="ad-eyebrow">ПРОЕКТ / СЛЕДУЮЩИЙ РЕЛИЗ</div><h1>Последние штрихи</h1><p class="ad-subtitle">Проверки перед публикацией обновлённого сайта.</p>
 <div class="ad-meta"><span class="ad-dot"></span> В работе <span class="ad-divider">/</span> 3 задачи <span class="ad-divider">/</span> Сегодня</div>
 <section class="ad-review"><div class="ad-heading">Проверка интерфейса <span>01</span></div><label class="ad-check"><input type="checkbox" aria-label="Проверить контраст"><span>Проверить контраст текста</span><small>WCAG AA</small></label><div class="ad-field"><label for="ad-note">Заметка к проверке</label><input id="ad-note" placeholder="Добавить наблюдение…" autocomplete="off"></div></section>
 <div class="ad-board"><section class="ad-column"><div class="ad-heading">В работе <span class="ad-count">1</span></div><div class="ad-slot"><article class="ad-task"><span class="ad-tag">Дизайн</span><h2>Проверить состояния кнопок</h2><p>Hover, focus и disabled</p><footer><span>WEB–128</span><span class="ad-person">М</span></footer></article></div></section><section class="ad-column ad-destination"><div class="ad-heading">Готово <span class="ad-done-count">0</span></div><div class="ad-drop">Перетащите готовую задачу</div></section></div>
 <section class="ad-log"><div class="ad-heading">История изменений</div><div class="ad-scroll"><p><span>Сегодня, 12:40</span>Обновлены состояния компонентов</p><p><span>Сегодня, 11:25</span>Согласованы цвета и типографика</p><p><span>Вчера, 17:10</span>Добавлены проверки доступности</p><p><span>Вчера, 15:30</span>Собрана первая версия страницы</p></div></section></main>
 <div class="ad-overlay" aria-hidden="true"><div class="ad-focus"></div><div class="ad-ripple"></div><div class="ad-pointer"><svg width="30" height="37" viewBox="0 0 25 31"><path d="M3 2L3 23L8 18L12 27L16 25L12 16L20 16Z" fill="var(--primary,#9cbaad)" stroke="#202124" stroke-width="2" stroke-linejoin="round"/></svg><span class="ad-pointer-label">ИИ</span></div><div class="ad-status"><span></span>ИИ проверяет страницу</div></div>`;
 host.append(root);
 const q=<T extends HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 const pointer=q('.ad-pointer'),label=q('.ad-pointer-label'),ripple=q('.ad-ripple'),focus=q('.ad-focus'),status=q('.ad-status');
 const check=q<HTMLInputElement>('.ad-check input'),note=q<HTMLInputElement>('#ad-note'),card=q('.ad-task'),drop=q('.ad-drop'),scroll=q('.ad-scroll');
 const duration=21000;let frame=0;const start=performance.now();
 const pos=(selector:string,rx=.5,ry=.5)=>{const b=q(selector).getBoundingClientRect(),r=root.getBoundingClientRect();return{x:b.left-r.left+b.width*rx,y:b.top-r.top+b.height*ry}};
 const mix=(a:{x:number,y:number},b:{x:number,y:number},v:number)=>{const t=Math.max(0,Math.min(1,v)),u=t*t*(3-2*t);return{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u}};
 function paint(ms:number){
  const t=ms%duration;
  root.dataset.phase=t<1000?'idle':t<3600?'click':t<7400?'type':t<11200?'drag':t<15000?'scroll':t<18200?'evaluate':'idle';
  const visible=t>=1000&&t<15000;pointer.style.opacity=visible?'1':'0';
  const a=pos('.ad-check input'),b=pos('#ad-note',.23),c=pos('.ad-slot',.45,.35),d=pos('.ad-drop',.45,.35),e=pos('.ad-scroll',.83,.4);
  let p=a;
  if(t<2400)p=mix({x:a.x+170,y:a.y+90},a,(t-1000)/1400);
  else if(t<3600)p=a;
  else if(t<4600)p=mix(a,b,(t-3600)/1000);
  else if(t<7400)p=b;
  else if(t<8300)p=mix(b,c,(t-7400)/900);
  else if(t<10800)p=mix(c,d,(t-8800)/1900);
  else if(t<12000)p=mix(d,e,(t-11200)/800);
  else p=e;
  pointer.style.transform=`translate(${p.x-3}px,${p.y-2}px)`;
  label.textContent=t>=4600&&t<7400?'ИИ · ввод':t>=8800&&t<10800?'ИИ · перенос':t>=12000&&t<15000?'ИИ · прокрутка':'ИИ';
  const clickAge=t-2500;const clicked=clickAge>=0&&clickAge<750;
  ripple.style.opacity=clicked?String(1-clickAge/750):'0';ripple.style.transform=`translate(${a.x-18}px,${a.y-18}px) scale(${.5+Math.max(0,clickAge)/650})`;
  check.checked=t>=2500&&t<19500;
  const message='Контраст проверен, замечаний нет.';
  note.value=t<4800||t>=19500?'':message.slice(0,Math.floor((t-4800)/65));
  const box=note.getBoundingClientRect(),base=root.getBoundingClientRect();
  focus.style.cssText=`left:${box.left-base.left-3}px;top:${box.top-base.top-3}px;width:${box.width+6}px;height:${box.height+6}px;opacity:${t>=4600&&t<7400?1:0}`;
  const drag=t>=8800&&t<10800,done=t>=10800&&t<19500;
  const delta=drag?mix({x:0,y:0},{x:d.x-c.x,y:d.y-c.y},(t-8800)/1900):done?{x:d.x-c.x,y:d.y-c.y}:{x:0,y:0};
  card.style.transform=`translate(${delta.x}px,${delta.y}px) rotate(${drag?-2:0}deg)`;card.classList.toggle('ad-lift',drag);
  drop.classList.toggle('ad-over',drag);drop.style.color=done?'transparent':'';
  q('.ad-count').textContent=done?'0':'1';q('.ad-done-count').textContent=done?'1':'0';
  scroll.scrollTop=t>=12500&&t<19500?Math.min(150,(t-12500)/10):0;
  status.style.opacity=t>=15500&&t<18200?'1':'0';
  status.style.transform=`translateY(${t>=15500&&t<18200?0:-6}px)`;
 }
 const tick=()=>{paint(options.time??performance.now()-start);if(options.time===undefined)frame=requestAnimationFrame(tick)};
 tick();const resize=()=>paint(options.time??performance.now()-start);window.addEventListener('resize',resize);
 return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);root.remove()};
}
