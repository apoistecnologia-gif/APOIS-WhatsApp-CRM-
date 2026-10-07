import {Manager,baseDiagnostic} from './manager.js';
const manager=new Manager(document.getElementById('manager'),{central:true,diagnostic:async()=>({...await baseDiagnostic(),central:true})});
await manager.start();window.addEventListener('pagehide',()=>manager.destroy(),{once:true});
