import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('index.html',root),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('No inline script');
await mkdir(new URL('test/scratch/',root),{recursive:true});
const file=new URL('test/scratch/typecheck.js',root);
await writeFile(file,script);
// Use an externally installed TypeScript executable. It is development tooling, never a site dependency.
const tsc=process.env.SQUEEK_TSC || 'tsc';
const result=spawnSync(tsc,['--allowJs','--checkJs','--noEmit','--strict','--target','ES2022','--lib','ES2022,DOM','--skipLibCheck',file.pathname],{stdio:'inherit'});
if (result.error) {console.error('Install TypeScript outside this repository, then set SQUEEK_TSC to its tsc executable. See README.');process.exit(1);}
process.exit(result.status ?? 1);
