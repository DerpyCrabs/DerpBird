#!/usr/bin/env python3
"""Run a fixture expression through an explicitly enabled local Ladybird DevTools server."""
import argparse,json,socket,sys
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',required=True,type=int);p.add_argument('--url',required=True);p.add_argument('--script',required=True,type=argparse.FileType('r'));a=p.parse_args()
with socket.create_connection(('127.0.0.1',a.port),5) as s:
 s.settimeout(10)
 def receive():
  size=b''
  while True:
   c=s.recv(1)
   if not c:raise RuntimeError('DevTools closed')
   if c==b':':break
   size+=c
   if len(size)>9:raise RuntimeError('Invalid packet')
  remaining=int(size)
  if remaining>4*1024*1024:raise RuntimeError('Packet exceeds fixture limit')
  data=b''
  while remaining:
   c=s.recv(remaining)
   if not c:raise RuntimeError('Truncated packet')
   data+=c;remaining-=len(c)
  return json.loads(data)
 def send(value):
  data=json.dumps(value).encode();s.sendall(str(len(data)).encode()+b':'+data)
 def until(predicate):
  for _ in range(128):
   value=receive()
   if value.get('error'):raise RuntimeError(value)
   if predicate(value):return value
  raise RuntimeError('Expected reply not received')
 receive();send({'to':'root','type':'listTabs'});tabs=until(lambda x:'tabs'in x)['tabs'];targets=[x for x in tabs if x['url']==a.url]
 if len(targets)!=1:raise RuntimeError(f'Expected one exact target: {tabs}')
 send({'to':targets[0]['actor'],'type':'getWatcher'});watcher=until(lambda x:'actor'in x)['actor']
 send({'to':watcher,'type':'watchTargets','targetType':'frame'});target=until(lambda x:x.get('type')=='target-available-form')['target']
 send({'to':target['consoleActor'],'type':'evaluateJSAsync','text':a.script.read()})
 result=until(lambda x:x.get('type')=='evaluationResult');print(json.dumps(result,ensure_ascii=False))
 if result.get('hasException'):sys.exit(1)
