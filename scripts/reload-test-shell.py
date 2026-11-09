#!/usr/bin/env python3
"""Reload only about:derpbird using an explicitly enabled local Ladybird DevTools server."""
import argparse,json,socket
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--port',required=True,type=int)
p.add_argument('--fixture',required=True,type=Path)
p.add_argument('--case',required=True)
p.add_argument('--slow',choices=['script','style'],action='append',default=[])
a=p.parse_args()
with socket.create_connection(('127.0.0.1',a.port),5) as connection:
 connection.settimeout(5)
 def receive():
  size=b''
  while True:
   c=connection.recv(1)
   if not c:raise RuntimeError('DevTools connection closed')
   if c==b':':break
   size+=c
   if len(size)>9:raise RuntimeError('Invalid packet length')
  remaining=int(size)
  if remaining>4*1024*1024:raise RuntimeError('DevTools packet exceeds fixture limit')
  body=b''
  while remaining:
   chunk=connection.recv(remaining)
   if not chunk:raise RuntimeError('Truncated DevTools packet')
   body+=chunk;remaining-=len(chunk)
  return json.loads(body)
 def send(obj):
  body=json.dumps(obj).encode();connection.sendall(str(len(body)).encode()+b':'+body)
 receive();send({'to':'root','type':'listTabs'})
 while True:
  result=receive()
  if 'tabs' in result:break
 targets=[x for x in result['tabs'] if x['url']=='about:derpbird']
 if len(targets)!=1:raise RuntimeError('Expected exactly one test shell')
 # Control the next response before the new shell begins its source checks.
 (a.fixture/'mode.json').write_text(json.dumps({'slow':a.slow,'case':a.case}))
 send({'to':targets[0]['actor'],'type':'reloadDescriptor'})
 print(json.dumps({'targets':result,'response':receive(),'case':a.case}))
