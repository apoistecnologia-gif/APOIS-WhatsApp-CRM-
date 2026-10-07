import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const base=path.resolve('dist/apois-crm'),manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json')));
if(manifest.manifest_version!==3 || manifest.name!=='APOIS CRM')throw new Error('Manifest inválido');
const refs=[manifest.background.service_worker,manifest.options_page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(s=>s.js || []),...manifest.web_accessible_resources.flatMap(r=>r.resources)];
for(const file of refs)await fs.access(path.join(base,file));
async function walk(dir){const result=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())result.push(...await walk(p));else result.push(p);}return result;}
const files=await walk(base);
for(const file of files.filter(p=>p.endsWith('.js')))execFileSync(process.execPath,['--check',file]);
for(const file of files.filter(p=>p.endsWith('.js')&&!p.includes('/vendor/'))) {
  const text=await fs.readFile(file,'utf8');
  if(/backend\.lotsofwms|wascript\.com|perfeittogroup|license_update|modal-userFree/.test(text))throw new Error('Dependência comercial na release');
  for(const m of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\.?\/[^'"]+)['"]/g))await fs.access(path.resolve(path.dirname(file),m[1]));
}
const vendor=await fs.readFile(path.join(base,'vendor/wppconnect-wa.js'));
const upstream=await fs.readFile('node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js');if(!vendor.equals(upstream))throw new Error('Vendor difere do pacote upstream');
console.log(`Manifest, ${refs.length} caminhos, sintaxe, imports e vendor upstream: OK (${files.length} arquivos)`);
