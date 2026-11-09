#!/usr/bin/env python3
"""Isolated live-site acceptance profile using hash-checked extension snapshots."""
import argparse,hashlib,json,subprocess,urllib.request,urllib.parse,concurrent.futures,re
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);a=p.parse_args();root=a.root.resolve();root.mkdir(parents=True,exist_ok=False)
repo=Path(__file__).resolve().parents[1];corpus=repo/'artifacts/compatibility-corpus';manifest={x['file']:x for x in json.loads((corpus/'manifest.json').read_text())}
def source(name):
 data=(corpus/name).read_bytes();assert hashlib.sha256(data).hexdigest()==manifest[name]['sha256'];return data.decode()
profile=root/'profile';config=profile/'config';data=profile/'data';config.mkdir(parents=True);lists=data/'ContentBlocking/Lists';lists.mkdir(parents=True)
(config/'Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False},'contentBlockers':{'enabled':True}}))
script=source('adguard-extra.user.js');metadata=json.loads(subprocess.check_output(['bun','-e',"import {parseUserScript} from './src/browser/user-scripts';console.log(JSON.stringify(parseUserScript(await Bun.stdin.text())));"],input=script.encode(),cwd=repo))
(data/'DerpBirdScripts.json').write_text(json.dumps({'version':1,'items':[{'id':'adguard-extra-corpus','name':'AdGuard Extra','source':script,'sourceURL':manifest['adguard-extra.user.js']['url'],'enabled':True,'fileAccessGranted':False,'metadata':metadata}]}))
compiled=json.loads((corpus/'github.user.less.compiled.json').read_text());style=source('github.user.less')
(data/'DerpBirdStyles.json').write_text(json.dumps({'version':1,'items':[{'id':'catppuccin-github-corpus','name':'GitHub Catppuccin','source':style,'sourceURL':manifest['github.user.less']['url'],'enabled':True,'sections':compiled['sections'],'imports':compiled['imports'],'usercss':{'values':compiled['values']}}]}))
records=[]
for identifier,name in [('easyList','easylist.txt'),('easyPrivacy','easyprivacy.txt')]:
 content=source(name).encode();(lists/(identifier+'.txt')).write_bytes(content);records.append({'identifier':identifier,**manifest[name]})
def download(name):
 identifier='ublock-'+name;url=f'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/{name}.txt'
 documents={};dependencies=[];total=0
 def expand(address,ancestors=()):
  nonlocal total
  if address in ancestors or len(ancestors)>=16:raise ValueError('Recursive filter include')
  if address not in documents:
   if len(documents)>=64:raise ValueError('Too many filter includes')
   with urllib.request.urlopen(address,timeout=30) as response:
    content=response.read(8*1024*1024+1);final=response.url
   if final!=address:raise ValueError('Unexpected filter source redirect')
   if len(content)>8*1024*1024:raise ValueError('Filter source exceeds size limit')
   total+=len(content)
   if total>64*1024*1024:raise ValueError('Combined filter sources exceed size limit')
   documents[address]=content.decode('utf-8')
   dependencies.append({'url':address,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
  output=[];size=0
  for line in documents[address].splitlines():
   match=re.match(r'^\s*!#include[ \t]+(\S+)',line)
   if match:
    relative=match[1];target=urllib.parse.urljoin(address,relative)
    base=urllib.parse.urlsplit(address);parsed=urllib.parse.urlsplit(target)
    if relative.startswith('/') or ':' in relative or '\\' in relative or parsed.fragment or parsed.netloc!=base.netloc or parsed.scheme!=base.scheme or not parsed.path.startswith(base.path.rsplit('/',1)[0]+'/'):
     raise ValueError('Filter include escapes its source directory')
    line=expand(target,(*ancestors,address))
   # Keep conditional directives for the browser's own capability preprocessor.
   size+=len(line.encode('utf-8'))+1
   if size>64*1024*1024:raise ValueError('Expanded filter list exceeds size limit')
   output.append(line)
  return '\n'.join(output)+'\n'
 content=expand(url).encode()
 if not content.startswith(b'[') and b'! Title:' not in content:raise ValueError('Unexpected filter response')
 (lists/(identifier+'.txt')).write_bytes(content)
 return {'identifier':identifier,'url':url,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'sourceDocuments':dependencies,'includesExpanded':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:records.extend(pool.map(download,['filters','privacy','badware','unbreak','quick-fixes']))
(root/'sources.json').write_text(json.dumps({'filters':records,'extensions':[manifest['adguard-extra.user.js'],manifest['github.user.less']]},indent=2)+'\n')
print(profile)
