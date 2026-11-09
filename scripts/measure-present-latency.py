#!/usr/bin/env python3
"""QEMU virtual-key input to observed compositor framebuffer change.

Run on the VM host after focusing the fixture input. The selected pixel must be
inside its black/white presentation probe. Reports interval bounds, including
QMP/capture overhead; these are not physical display latency measurements.
"""
import argparse, json, socket, tempfile, time
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--socket', type=Path, required=True)
p.add_argument('--pixel', required=True, help='x,y in the QEMU framebuffer')
p.add_argument('--samples', type=int, default=20)
p.add_argument('--keys', default='a', help='Comma-separated QMP key chord; default a, e.g. ctrl,tab')
p.add_argument('--output', type=Path, required=True)
a=p.parse_args(); x,y=map(int,a.pixel.split(',')); keys=a.keys.split(',')
if not keys or any(not key for key in keys): p.error('keys must be a nonempty comma-separated chord')
if not 1<=a.samples<=100: p.error('samples must be 1..100')
s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(str(a.socket));stream=s.makefile('rwb');stream.readline()
def call(command,arguments=None):
 stream.write((json.dumps({'execute':command,**({'arguments':arguments} if arguments else {})})+'\n').encode());stream.flush()
 while True:
  response=json.loads(stream.readline())
  if 'error' in response:raise RuntimeError(response['error'])
  if 'return' in response:return response['return']
call('qmp_capabilities')
report={'scope':'virtual QEMU key injection to observed Wayland compositor framebuffer pixel','pixel':[x,y],'injected_keys':keys,'samples':[],'limitations':['Includes QMP dispatch, framebuffer capture and polling overhead.','Observed upper/lower bounds, not exact presentation timestamps.','Does not measure a physical display or general website responsiveness.']}
a.output.parent.mkdir(parents=True,exist_ok=True)
try:
 with tempfile.TemporaryDirectory(prefix='derpbird-presentation-') as directory:
  frame=Path(directory)/'frame.ppm'
  def capture():
   started=time.perf_counter_ns();call('screendump',{'filename':str(frame)})
   raw=frame.read_bytes();pos=0;tokens=[]
   while len(tokens)<4:
    while raw[pos:pos+1].isspace():pos+=1
    if raw[pos:pos+1]==b'#':pos=raw.index(b'\n',pos)+1;continue
    end=pos
    while not raw[end:end+1].isspace():end+=1
    tokens.append(raw[pos:end]);pos=end
   if tokens[0]!=b'P6' or tokens[3]!=b'255':raise ValueError('Expected 8-bit PPM framebuffer')
   width,height=map(int,tokens[1:3])
   if not 0<=x<width or not 0<=y<height:raise ValueError('Probe is outside framebuffer')
   pos+=2 if raw[pos:pos+2]==b'\r\n' else 1
   offset=pos+3*(y*width+x);pixel=tuple(raw[offset:offset+3])
   return pixel,started,time.perf_counter_ns()
  pixel,_,_=capture()
  if pixel not in ((0,0,0),(255,255,255)):raise ValueError(f'Probe is not black/white: {pixel}')
  for index in range(a.samples):
   expected=(255,255,255) if pixel==(0,0,0) else (0,0,0)
   begin=time.perf_counter_ns()
   call('input-send-event',{'events':[{'type':'key','data':{'down':down,'key':{'type':'qcode','data':key}}} for down, chord in ((True,keys),(False,reversed(keys))) for key in chord]})
   ack=time.perf_counter_ns();lower=begin;polls=0
   while True:
    observed,start,end=capture();polls+=1
    if observed==expected:
     report['samples'].append({'index':index,'lower_ms':(lower-begin)/1e6,'upper_ms':(end-begin)/1e6,'qmp_ack_ms':(ack-begin)/1e6,'last_capture_ms':(end-start)/1e6,'polls':polls});pixel=observed;break
    if end-begin>3_000_000_000:raise TimeoutError('No probe change: focus/input delivery or rendering failed')
    lower=start
   time.sleep(.15)
  bounds=sorted(v['upper_ms'] for v in report['samples'])
  report['upper_bound_ms']={'p50':bounds[len(bounds)//2],'p95':bounds[min(len(bounds)-1,int(len(bounds)*.95))],'max':max(bounds)}
except Exception as error:
 report['error']=str(error);raise
finally:
 a.output.write_text(json.dumps(report,indent=2)+'\n');s.close()
print(json.dumps(report['upper_bound_ms']))
