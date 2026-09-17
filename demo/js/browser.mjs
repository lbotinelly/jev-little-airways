import {createWorld, mockAsk, VERSION, FAULTS, SCHEMA_VERSION} from './world.mjs';
import {createHUD} from './hud.mjs';
import {createJevProvider, KEY_STORAGE} from './jev-provider.mjs';
import {createJevMonitor} from './jev-monitor.mjs';

// The browser and native capture use exactly the same scene, simulation, and HUD.
// Only this module owns DOM events and the wall clock.
const canvas=document.getElementById('world');
const loading=document.getElementById('loading');
const status=document.getElementById('status');
const errors=[];
let world=null, busy=false, building=null, generation=0;
let seed=42042,size='medium',provider=mockAsk,providerName='archipelago-mock/1';
let last=0, frames=0, fpsWindow=0, hover=false, pointer=null, screenshotMode=false;
const parameters=new URLSearchParams(location.search);
if(['small','medium','large'].includes(parameters.get('size')))size=parameters.get('size');
if(parameters.has('seed')){const n=Number(parameters.get('seed'));if(Number.isFinite(n))seed=n>>>0;}

// Decision-engine panel (#api-panel in index.html). The in-scene HUD paints the
// dimmed backdrop; this real-DOM card owns the key field and mode switch.
const apiPanel=document.getElementById('api-panel'),apiKeyInput=document.getElementById('api-key'),apiError=document.getElementById('api-error'),apiStatus=document.getElementById('api-status');
let apiStatusTimer=0,jevProviderFn=null;
function refreshApiStatus(){
 const c=world?.sim?.client,s=jevProviderFn?.stats;
 const left=`provider / ${c?.model??'—'}`;
 const right=s?`${c?.calls??0} calls · ${c?.errors??0} errors · ${(s.inputTokens/1000).toFixed(1)}k in / ${(s.outputTokens/1000).toFixed(1)}k out tok · ${s.lastLatencyMs??'—'} ms`:`${c?.calls??0} calls · ${c?.errors??0} errors`;
 apiStatus.textContent='';apiStatus.append(Object.assign(document.createElement('span'),{textContent:left}),Object.assign(document.createElement('span'),{textContent:right}));
}
function toggleApiPanel(open){
 if(!apiPanel)return;
 apiPanel.hidden=!open;apiError.hidden=true;
 clearInterval(apiStatusTimer);
 if(open){apiKeyInput.value=localStorage.getItem(KEY_STORAGE)||'';refreshApiStatus();apiStatusTimer=setInterval(refreshApiStatus,1000);apiKeyInput.focus();}
 else apiKeyInput.blur();
}
document.getElementById('api-show').addEventListener('click',()=>{const reveal=apiKeyInput.type==='password';apiKeyInput.type=reveal?'text':'password';document.getElementById('api-show').textContent=reveal?'hide':'show';});
document.getElementById('api-connect').addEventListener('click',()=>{
 const key=apiKeyInput.value.trim();
 if(key.length<20){apiError.textContent='That does not look like a key — paste the full string from console.typesafe.ai/keys.';apiError.hidden=false;return;}
 localStorage.setItem(KEY_STORAGE,key);
 jevProviderFn=createJevProvider({key});
 setProvider(jevProviderFn,'jev-latest · live');
 apiError.hidden=true;refreshApiStatus();
});
document.getElementById('api-mock').addEventListener('click',()=>{jevProviderFn=null;setProvider(mockAsk,'archipelago-mock/1');refreshApiStatus();});
document.getElementById('api-export').addEventListener('click',()=>exportState());
document.getElementById('api-close').addEventListener('click',()=>{if(world)world.hud.handle('api');else toggleApiPanel(false);});
apiKeyInput.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.stopPropagation();document.getElementById('api-close').click();}
 else if(event.key==='Enter')document.getElementById('api-connect').click();
});

// Jev data monitor: decisions grid + every ask() exchange in Jev API format.
const jevMonitor=createJevMonitor({getWorld:()=>world});

function downloadJSON(name,value){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportState(){
 if(!world)return;
 const selected=world.sim.planes.find(p=>p.id===world.sim.selected)||world.sim.planes[0];
 downloadJSON('little-airways-state.json',{version:VERSION,snapshot:world.sim.snapshot(),schemaVersion:SCHEMA_VERSION,request:{state:world.sim.state(selected),questions:selected.questions||world.sim.questions(selected)},response:selected.packet,log:world.sim.log});
}
async function rebuild(nextSize=size,newSeed=false,explicitSeed=null){
 if(busy)return building;
 busy=true;size=nextSize;seed=explicitSeed??(newSeed?crypto.getRandomValues(new Uint32Array(1))[0]:seed);
 const revision=++generation;
 if(world){world.hud.busy=true;world.hud.invalidate();world.render();}
 loading.hidden=false;status.textContent='Growing the islands…';
 building=(async()=>{
  try{
   await new Promise(requestAnimationFrame);
   world?.dispose();world=null;
   const next=await createWorld({canvas,width:innerWidth,height:innerHeight,seed,size});
   if(revision!==generation){next.dispose();return;}
   next.sim.client.setProvider(provider,providerName);
   next.sim.client.onExchange=ex=>jevMonitor.push(ex);
   createHUD(next,innerWidth,innerHeight,{regenerate:(s,shuffle=false)=>{void rebuild(s,shuffle);},export:exportState,mock:()=>setProvider(mockAsk,'archipelago-mock/1'),apiPanel:toggleApiPanel,monitor:()=>jevMonitor.toggle()});
   world=next;world.render();loading.hidden=true;errors.length=0;
   globalThis.__chatDreamLoop.ready=true;last=performance.now();
  }catch(error){
   const message=String(error?.message||error);errors.push(message);console.error(error);
   status.textContent='The 3D renderer could not start. Try a recent browser with graphics acceleration enabled.';
   document.getElementById('error-details').textContent=message;
   globalThis.__chatDreamLoop.ready=false;
  }finally{busy=false;}
 })();return building;
}
function setProvider(fn,label='custom-provider'){
 if(typeof fn!=='function')throw new TypeError('The decision provider must be a function.');
 provider=fn;providerName=label;
 if(world){world.sim.client.setProvider(fn,label);for(const p of world.sim.planes){p.epoch++;p.nextThink=world.sim.time;}world.hud.invalidate();}
}
function localPoint(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*innerWidth/r.width,y:(event.clientY-r.top)*innerHeight/r.height};}
function revealSelected(id){if(!world)return;world.select(id);world.hud.hint=false;world.hud.invalidate();}
canvas.addEventListener('pointerdown',event=>{
 if(busy||!world||event.button!==0)return;
 const p=localPoint(event);pointer={id:event.pointerId,start:p,last:p,moved:false,onHUD:!world.hud.hidden&&!!world.hud.hit(p.x,p.y)};
 canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
 if(busy||!world)return;const p=localPoint(event);
 if(pointer&&pointer.id===event.pointerId){
  if(Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y)>5)pointer.moved=true;
  if(pointer.moved&&!pointer.onHUD){world.view.angle-=(p.x-pointer.last.x)*.004;world.view.pitch=Math.max(.40,Math.min(1.23,world.view.pitch+(p.y-pointer.last.y)*.003));world.updateCamera();}
  pointer.last=p;
 }else{
  hover=!world.hud.hidden&&world.hud.pointer(p.x,p.y);
  canvas.style.cursor=hover||world.pick(p.x/innerWidth*2-1,1-p.y/innerHeight*2)?'pointer':'grab';
 }
});
canvas.addEventListener('pointerup',event=>{
 if(!pointer||!world)return;const down=pointer;pointer=null;
 if(!down.moved&&!busy){const p=localPoint(event);if(!world.hud.hidden&&world.hud.click(p.x,p.y))return;const id=world.pick(p.x/innerWidth*2-1,1-p.y/innerHeight*2);if(id)revealSelected(id);}
});
canvas.addEventListener('pointercancel',()=>{pointer=null;});
canvas.addEventListener('wheel',event=>{
 if(busy||!world)return;event.preventDefault();const p=localPoint(event);if(!world.hud.hidden&&world.hud.hit(p.x,p.y))return;
 world.view.zoom=Math.max(.55,Math.min(2.1,world.view.zoom*Math.exp(-event.deltaY*.001)));world.updateCamera();
},{passive:false});
window.addEventListener('resize',()=>{if(world&&!busy)world.resize(innerWidth,innerHeight);});
window.addEventListener('keydown',event=>{
 if(busy||!world||event.ctrlKey||event.metaKey||event.altKey)return;
 if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;
 const h=world.hud,key=event.key.toLowerCase();
 if('12345'.includes(key)&&key.length===1){h.handle('fault',FAULTS[Number(key)-1]);event.preventDefault();}
 else if(key==='r')h.handle('repair');
 else if(key===' '){event.preventDefault();h.handle('pause');}
 else if(key==='h')h.handle('help');
 else if(key==='c'){h.hidden=!h.hidden;h.invalidate();}
 else if(key==='home'||key==='0'){event.preventDefault();h.handle('home');}
 else if(key==='tab'){event.preventDefault();const ps=world.sim.planes,i=ps.findIndex(p=>p.id===world.sim.selected);revealSelected(ps[(i+(event.shiftKey?-1:1)+ps.length)%ps.length].id);}
 else if(key==='j')jevMonitor.toggle();
 else if(key==='escape'){if(jevMonitor.isOpen())jevMonitor.close();else if(h.open==='api')h.handle('api');else h.open='';h.history=false;h.invalidate();}
});
// Accessible equivalents for keyboard / screen-reader use (the visible HUD is 3D).
for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{
 if(!world)return;const cmd=button.dataset.command;
 if(cmd==='next'){const ps=world.sim.planes,i=ps.findIndex(p=>p.id===world.sim.selected);revealSelected(ps[(i+1)%ps.length].id);}
 else if(cmd.startsWith('fault:'))world.hud.handle('fault',cmd.slice(6));else world.hud.handle(cmd);
});
function frame(now){
 requestAnimationFrame(frame);const elapsed=last?(now-last)/1000:0;last=now;
 if(!world||busy||document.hidden||screenshotMode)return;
 try{
  if(!world.sim.paused)void world.step(Math.min(.05,elapsed)*world.sim.speed,false);
  world.render();
  frames++;fpsWindow+=elapsed;
  if(fpsWindow>=.75){world.hud.fps=Math.round(frames/fpsWindow);frames=0;fpsWindow=0;world.hud.invalidate();}
 }catch(e){if(errors.length===0){errors.push(String(e?.message||e));console.error(e);}}
}
window.addEventListener('visibilitychange',()=>{last=performance.now();});
window.addEventListener('beforeunload',()=>{world?.dispose();});

globalThis.LittleAirways={
 version:VERSION,
 setDecisionProvider:setProvider,
 connectJev(key){
  if(!key||typeof key!=='string')throw new TypeError('connectJev(key) needs the key string');
  localStorage.setItem(KEY_STORAGE,key);jevProviderFn=createJevProvider({key});
  setProvider(jevProviderFn,'jev-latest · live');refreshApiStatus();return jevProviderFn.stats;
 },
 clearJevKey(){localStorage.removeItem(KEY_STORAGE);},
 restoreMock:()=>{jevProviderFn=null;setProvider(mockAsk,'archipelago-mock/1');refreshApiStatus();},
 captureState:()=>world?.sim.snapshot(),
 exportState,
 selectPlane:revealSelected,
 injectFault:(fault,id=world?.sim.selected)=>world?.sim.inject(id,fault),
 repair:(id=world?.sim.selected)=>world?.sim.repair(id),
 rebuild:(nextSize=size,nextSeed=seed)=>rebuild(nextSize,false,nextSeed),
 diagnostics:()=>({...world?.diagnostics(),browserErrors:[...errors],provider:providerName}),
 jevMonitor:{open:()=>jevMonitor.open(),close:()=>jevMonitor.close(),toggle:()=>jevMonitor.toggle(),isOpen:()=>jevMonitor.isOpen()},
 get world(){return world;}
};
globalThis.__chatDreamLoop={ready:false,
 async prepareCapture({time=5,seed:captureSeed=42042,size:captureSize='medium',fault='',selected='N42'}={}){
  screenshotMode=true;await rebuild(captureSize,false,captureSeed);if(!world)throw new Error('Renderer not ready');
  world.sim.paused=true;world.select(selected);if(fault)world.sim.inject(selected,fault);
  for(let t=0;t<time;t+=.1)await world.step(Math.min(.1,time-t),true);
  world.hud.fps=null;world.hud.invalidate();world.render();return {state:world.sim.snapshot(),diagnostics:world.diagnostics()};
 },
 resume(){screenshotMode=false;if(world)world.sim.paused=false;last=performance.now();},
};
requestAnimationFrame(frame);
await rebuild();
