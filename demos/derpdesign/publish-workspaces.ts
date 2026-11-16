import { workspaceDemo } from './workspace-declaration';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'derpbird-workspaces-'));
try {
 const file = join(directory, 'demo.json');
 await Bun.write(file, JSON.stringify(workspaceDemo));
 const child = Bun.spawn(['derpdesign', 'call', 'demo_put', '--file', file], { stdout: 'inherit', stderr: 'inherit' });
 if (await child.exited) throw Error('Could not register workspace demo.');
} finally { await rm(directory, { recursive: true }); }
