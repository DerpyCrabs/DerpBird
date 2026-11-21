export function mountColorPicker(host: HTMLElement, hex: HTMLInputElement, preview: (value:string)=>void) {
  host.innerHTML = '<div class="color-plane" aria-hidden="true"><i></i></div><label class="color-hue">Hue<input type="range" min="0" max="359" step="1"></label>';
  const plane = host.querySelector<HTMLElement>('.color-plane')!;
  const marker = plane.querySelector('i')!;
  const hue = host.querySelector('input')!;
  let h = 0, s = 0, v = 0;
  function paint() {
    plane.style.backgroundColor = 'hsl(' + h + ' 100% 50%)';
    marker.style.left = s * 100 + '%';
    marker.style.top = (1 - v) * 100 + '%';
    hue.value = String(Math.round(h) % 360);
    hue.setAttribute('aria-valuetext', Math.round(h) + ' degrees');
  }
  function commit() {
    const channel = (offset:number) => {
      const k = (offset + h / 60) % 6;
      return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2,'0');
    };
    hex.value = '#' + [5,3,1].map(channel).join('');
    paint(); preview(hex.value);
  }
  function point(event:PointerEvent) {
    const rect = plane.getBoundingClientRect();
    s = Math.max(0, Math.min(1,(event.clientX - rect.left) / rect.width));
    v = 1 - Math.max(0, Math.min(1,(event.clientY - rect.top) / rect.height));
    commit();
  }
  plane.onpointerdown = event => { if(event.button !== 0)return; plane.setPointerCapture(event.pointerId); point(event); };
  plane.onpointermove = event => { if(plane.hasPointerCapture(event.pointerId))point(event); };
  hue.oninput = () => { h = Number(hue.value); commit(); };
  return () => {
    if(!/^#[\da-f]{6}$/i.test(hex.value))return;
    const [r,g,b] = [1,3,5].map(i=>parseInt(hex.value.slice(i,i+2),16)/255);
    v = Math.max(r,g,b);
    const delta = v - Math.min(r,g,b);
    s = v ? delta/v : 0;
    if(delta)h = (360 + 60 * (v===r ? (g-b)/delta : v===g ? (b-r)/delta+2 : (r-g)/delta+4))%360;
    paint(); preview(hex.value);
  };
}
