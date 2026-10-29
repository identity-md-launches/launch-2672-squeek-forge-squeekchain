import { mkdir, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(join(root,'dist/assets'),{recursive:true});
await copyFile(join(root,'index.html'),join(root,'dist/index.html'));
await copyFile(join(root,'assets/social.png'),join(root,'dist/assets/social.png'));
const size=(await stat(join(root,'dist/index.html'))).size+(await stat(join(root,'dist/assets/social.png'))).size;
console.log(`Static production export: dist/index.html + assets/social.png (${size.toLocaleString('en-US')} bytes). No compilation or dependencies.`);
