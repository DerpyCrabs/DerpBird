#!/usr/bin/env python3
"""Compare chrome text/SVG presentation with the same content in a GPU page.

Run only in an isolated wlroots test session. Requires Pillow, grim and
wlr-randr. The output scale itself is changed, not QT_SCALE_FACTOR. Never accepts new goldens:
the reference is independently rendered by the content view in the same run.
"""
import argparse
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from PIL import Image, ImageChops, ImageStat

PROBE = r'''(() => {
 const dpr = devicePixelRatio;
 const font = getComputedStyle(document.getElementById("location")).font;
 document.getElementById('render-quality-probe')?.remove();
 const root = document.createElement('div');
 root.id = 'render-quality-probe';
 root.style.cssText = `position:fixed!important;left:${Math.round(260*dpr)/dpr}px!important;top:0!important;width:360px!important;height:32px!important;box-sizing:border-box!important;border:${2/dpr}px solid #ff00ff!important;background:#242629!important;color:#dddddd!important;z-index:2147483647!important;overflow:hidden!important;opacity:1!important;transform:none!important`;
 root.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="position:absolute;left:8px;top:4px" fill="none" stroke="#dddddd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14"/></svg><span style="position:absolute;left:38px;top:4px;white-space:pre;font:${font};line-height:20px">https://www.google.com/  Google</span>`;
 document.documentElement.append(root);
 return JSON.stringify({dpr, html:root.outerHTML});
})()'''


def compare(path, scale):
    image = Image.open(path).convert('RGB')
    pixels = image.load()
    marked = {(x, y) for y in range(image.height) for x in range(image.width)
              if pixels[x, y][0] > 170 and pixels[x, y][1] < 80 and pixels[x, y][2] > 170}
    boxes = []
    while marked:
        seed = marked.pop(); pending = [seed]; component = [seed]
        while pending:
            x, y = pending.pop()
            for point in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if point in marked:
                    marked.remove(point);pending.append(point);component.append(point)
        xs, ys = zip(*component)
        box = (min(xs), min(ys), max(xs)+1, max(ys)+1)
        if box[2]-box[0] > 300:
            boxes.append(box)
    assert len(boxes) == 2, f'Expected two unobscured probes, found {boxes}'
    boxes.sort(key=lambda box: box[1])
    expected = (round(360*scale), round(32*scale))
    for left, top, right, bottom in boxes:
        assert abs(right-left-expected[0]) <= 1 and abs(bottom-top-expected[1]) <= 1, f'Wrong physical resolution: {boxes}'
    # Fractional output positions can antialias one edge of the marker. Exclude
    # its border and register the crops by integer translation only. Rescaling
    # would hide precisely the undersampling regression this test must detect.
    width = min(box[2]-box[0] for box in boxes)-12
    height = min(box[3]-box[1] for box in boxes)-12
    x, y = boxes[0][:2]
    shell = image.crop((x+6, y+6, x+6+width, y+6+height))
    x, y = boxes[1][:2]
    candidates = []
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            page = image.crop((x+6+dx, y+6+dy, x+6+dx+width, y+6+dy+height))
            diff = ImageChops.difference(shell, page)
            mean = sum(ImageStat.Stat(diff).mean)/3
            candidates.append((mean, dx, dy, page, diff))
    mean, dx, dy, page, diff = min(candidates, key=lambda item: item[0])
    shell.save(path.with_name(path.stem+'-shell.png'))
    page.save(path.with_name(path.stem+'-page.png'))
    diff.save(path.with_name(path.stem+'-difference.png'))
    # Small differences in antialiasing are tolerated. Do not regenerate a
    # golden from the shell: the independent page is the reference every time.
    difference_pixels = diff.load()
    bad = sum(max(difference_pixels[x, y]) > 24
              for y in range(diff.height) for x in range(diff.width)) / (diff.width * diff.height)
    result = {'scale':scale, 'mean_absolute_error':mean, 'changed_pixel_fraction':bad,
              'registration_pixels':[dx,dy], 'boxes':boxes}
    path.with_name('comparison.json').write_text(json.dumps(result, indent=2)+'\n')
    assert mean <= 1.5 and bad <= .025, f'Chrome/content raster mismatch: MAE={mean:.3f}, changed={bad:.2%}'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--helper', type=Path, default=Path(__file__).with_name('ladybird-devtools-eval.py'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--environment', type=Path)
    parser.add_argument('--scales', type=float, nargs='+', default=[1,1.25,1.5,1.6,2])
    parser.add_argument('--transition-from', type=float, help='Change output scale after the browser has rendered its first frame')
    parser.add_argument('--layout', choices=['horizontal','vertical'], default='horizontal')
    parser.add_argument('--wayland-output', default='HEADLESS-1')
    parser.add_argument('--port', type=int, default=18994)
    args = parser.parse_args()
    assert args.wayland_output.startswith('HEADLESS-'), 'Use a dedicated headless test output, never a desktop monitor'
    env = json.loads(args.environment.read_text()) if args.environment else dict(os.environ)
    assert env.get('WAYLAND_DISPLAY') and env.get('XDG_RUNTIME_DIR'), 'An isolated Wayland session is required'
    capture_env = dict(os.environ, XDG_RUNTIME_DIR=env['XDG_RUNTIME_DIR'], WAYLAND_DISPLAY=env['WAYLAND_DISPLAY'])
    args.output.mkdir(parents=True, exist_ok=True)
    results=[]
    for scale in args.scales:
        directory=args.output/str(scale);directory.mkdir(exist_ok=True)
        subprocess.run(['wlr-randr','--output',args.wayland_output,'--scale',str(args.transition_from if args.transition_from is not None else scale)],env=capture_env,check=True,timeout=5)
        def evaluate(code, url='about:derpbird'):
            script=directory/'evaluate.js';script.write_text(code)
            process=subprocess.run(['python3',str(args.helper),'--port',str(args.port),'--url',url,'--script',str(script)],capture_output=True,text=True,timeout=15)
            if process.returncode:raise RuntimeError(process.stderr[-1200:])
            value=json.loads(process.stdout)
            if value.get('hasException'):raise RuntimeError(str(value))
            return value.get('result')
        with tempfile.TemporaryDirectory(prefix='derpbird-quality-profile-') as profile, (directory/'browser.log').open('w') as log:
            process=subprocess.Popen([str(args.browser),'--profile-path',profile,f'--devtools={args.port}','about:blank'],env=dict(env,DERPBIRD_UI='1',QT_SCALE_FACTOR='1',QT_SCALE_FACTOR_ROUNDING_POLICY='PassThrough',WAYLAND_DEBUG='client'),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                deadline=time.monotonic()+20
                while True:
                    try:
                        data=json.loads(evaluate(PROBE));break
                    except (RuntimeError,ValueError):
                        if process.poll() is not None or time.monotonic()>deadline:raise
                        time.sleep(.1)
                if args.transition_from is not None:
                    assert abs(data['dpr']-args.transition_from)<.001, 'Incorrect initial shell DPR'
                    subprocess.run(['wlr-randr','--output',args.wayland_output,'--scale',str(scale)],env=capture_env,check=True,timeout=5)
                    deadline=time.monotonic()+5
                    while True:
                        data=json.loads(evaluate(PROBE))
                        if abs(data['dpr']-scale)<.001:break
                        assert time.monotonic()<deadline, 'Shell did not follow output scale change'
                        time.sleep(.05)
                if args.layout == 'vertical':
                    evaluate('document.querySelector("[aria-label=Menu]").click();"open"')
                    evaluate('Array.from(document.querySelectorAll(".browser-menu button")).find(b=>b.textContent==="Vertical tabs").click();"vertical"')
                    evaluate('document.querySelector("[aria-label=Menu]").click();"close"')
                    deadline = time.monotonic()+5
                    while not evaluate('document.querySelector("[role=tablist]").getAttribute("aria-orientation")==="vertical"'):
                        assert time.monotonic()<deadline, 'Vertical layout was not applied'
                        time.sleep(.05)
                assert abs(data['dpr']-scale)<.001, f'Shell DPR {data["dpr"]}, expected {scale}'
                # First-run welcome is the foreground content page in a new profile.
                code=f'''document.getElementById('render-quality-probe')?.remove();document.documentElement.insertAdjacentHTML('beforeend',{json.dumps(data['html'])});document.getElementById('render-quality-probe').style.setProperty('top','60px','important');JSON.stringify({{dpr:devicePixelRatio}})'''
                reference=json.loads(evaluate(code,'about:welcome'))
                assert abs(reference['dpr']-scale)<.001, f'Content DPR differs: {reference}'
                time.sleep(.2)
                path=directory/'capture.png'
                subprocess.run(['grim','-o',args.wayland_output,str(path)],env=capture_env,check=True,timeout=10)
                log.flush()
                protocol=(directory/'browser.log').read_text(errors='replace')
                assert re.search(r'zwp_linux_buffer_params_v1[#@]\d+\.created\(', protocol), 'GPU page presentation was not exercised'
                result=compare(path,scale)
                result['layout'] = args.layout
                evaluate('document.querySelector("[aria-label=Menu]").click();"open"')
                time.sleep(.15)
                menu_path=directory/'menu.png'
                subprocess.run(['grim','-o',args.wayland_output,str(menu_path)],env=capture_env,check=True,timeout=10)
                left,top,right,bottom=result['boxes'][1]
                stable=(left+3,top+3,min(right-3,left+round(100*scale)),bottom-3)
                menu_difference=ImageChops.difference(Image.open(path).convert('RGB').crop(stable),Image.open(menu_path).convert('RGB').crop(stable))
                assert menu_difference.getbbox() is None, 'Opening a menu changed the reference page pixels'
                result['page_stable_under_menu'] = True
                results.append(result);print(json.dumps(result),flush=True)
            except (AssertionError, RuntimeError) as error:
                result={'scale':scale,'error':str(error)};results.append(result);print(json.dumps(result),flush=True)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid,signal.SIGTERM)
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
    (args.output/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    if any('error' in result for result in results):raise SystemExit(1)

if __name__=='__main__':main()
