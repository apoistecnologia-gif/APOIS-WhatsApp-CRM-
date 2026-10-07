import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from '../bridge/node_modules/@ffmpeg-installer/ffmpeg/index.js';
test('bridge starts, protects local API and preserves credentials on restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apois-api-test-'));let proc;
  async function start(){proc=spawn(process.execPath,['bridge/server.mjs'],{env:{...process.env,APOIS_DATA_DIR:dir}});let output='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Bridge startup timeout')),10000);proc.stdout.on('data',d=>{output+=d;if(output.includes('Chave local')){clearTimeout(timer);resolve();}});proc.once('error',reject);proc.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`Bridge exit ${code}`));}});});}
  async function stop(){proc.kill('SIGTERM');await new Promise(r=>proc.once('exit',r));}
  try {
    await start();const token=(await fs.readFile(path.join(dir,'bridge-token'),'utf8')).trim();const headers={Authorization:`Bearer ${token}`};
    assert.equal((await fetch('http://127.0.0.1:3210/health',{headers})).status,200);
    assert.equal((await fetch('http://127.0.0.1:3210/health')).status,401);
    assert.equal((await fetch('http://127.0.0.1:3210/health',{headers:{...headers,Origin:'https://web.whatsapp.com'}})).status,403);
    assert.deepEqual(await(await fetch('http://127.0.0.1:3210/sessions',{headers})).json(),{sessions:[]});
    assert.equal((await fetch('http://127.0.0.1:3210/sessions/../../auth',{headers})).status,404);
    await stop();await start();assert.equal((await fs.readFile(path.join(dir,'bridge-token'),'utf8')).trim(),token);
  } finally{if(proc?.exitCode===null)await stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('packaged ffmpeg actually produces mono OGG Opus for PTT',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apois-ffmpeg-'));try {
    const file=path.join(dir,'tone.ogg');execFileSync(ffmpeg.path,['-nostdin','-y','-f','lavfi','-i','sine=frequency=440:duration=0.2','-vn','-ac','1','-ar','48000','-c:a','libopus','-b:a','32k','-f','ogg',file],{stdio:'ignore'});
    const data=await fs.readFile(file);assert.equal(data.subarray(0,4).toString(),'OggS');assert.ok(data.includes(Buffer.from('OpusHead')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
