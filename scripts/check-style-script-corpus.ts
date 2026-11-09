/** Offline compiler/metadata qualification; deliberately does not execute downloaded JS. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { compileStyle } from '../src/browser/style-compile';
import { parseUserScript } from '../src/browser/user-scripts';
const directory = resolve(process.argv[2] ?? 'artifacts/compatibility-corpus');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as {file:string;url:string;finalURL:string;sha256:string;error?:string}[];
const sources = new Map<string, {url:string;source:string}>();
for (const entry of manifest) {
  if (entry.error || basename(entry.file) !== entry.file) throw new Error(`Unavailable corpus source: ${entry.file}`);
  const bytes = await readFile(resolve(directory, entry.file));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Changed corpus source: ${entry.file}`);
  sources.set(entry.url, {url:entry.finalURL,source:bytes.toString('utf8')});
}
const report: unknown[] = [];
let failures = 0;
for (const entry of manifest.filter(entry=>/\.user\.(less|css|js)$/.test(entry.file))) {
  const started = performance.now();
  try {
    const input = sources.get(entry.url)!;
    if (entry.file.endsWith('.js')) {
      const metadata = parseUserScript(input.source, input.url);
      report.push({file:entry.file,passed:true,scope:'metadata parsing only; runtime not qualified',name:metadata.name,grants:metadata.grants,elapsedMs:performance.now()-started});
    } else {
      const compiled = await compileStyle(input.source, {}, {sourceURL:input.url}, async url=> {
        const imported=sources.get(url);
        if (!imported) throw new Error(`Dependency missing from pinned corpus: ${url}`);
        return imported;
      });
      const offline = await compileStyle(input.source, {}, {sourceURL:input.url,imports:compiled.imports});
      if (JSON.stringify(compiled.sections)!==JSON.stringify(offline.sections)) throw new Error('Offline compilation changed CSS');
      await writeFile(resolve(directory,entry.file+'.compiled.json'),JSON.stringify(compiled));
      report.push({file:entry.file,passed:true,scope:'compilation/default configuration and offline imports; native rendering not qualified',sections:compiled.sections.length,imports:Object.keys(compiled.imports??{}).length,elapsedMs:performance.now()-started});
    }
  } catch(error) {failures++;report.push({file:entry.file,passed:false,error:String(error)});}
}
await writeFile(resolve(directory,'compiler-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=failures?1:0;
