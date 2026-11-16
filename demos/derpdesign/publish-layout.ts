import { layoutDemo } from './layout-declaration';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Register inactive through MCP. An existing desktop service is required.
const directory = await mkdtemp(join(tmpdir(), 'derpbird-layout-'));
try {
 const file = join(directory, 'demo.json');
 await Bun.write(file, JSON.stringify(layoutDemo));
 const process = Bun.spawn(['derpdesign', 'call', 'demo_put', '--file', file], { stdout: 'inherit', stderr: 'inherit' });
 if (await process.exited) throw Error('Could not register the inactive demo. Start DerpDesign and run this script again.');
} finally { await rm(directory, { recursive: true }); }
