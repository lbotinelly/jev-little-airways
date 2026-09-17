import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { FONT } from './font-atlas.mjs';

export const VERSION = '1.1.0';
const TAU=Math.PI*2, clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function rng(seed){return ()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z), color=x=>new THREE.Color(x), choose=(r,a)=>a[Math.floor(r()*a.length)], dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const SETS={small:{major:2,minor:4,planes:5,radius:62,view:80},medium:{major:3,minor:8,planes:9,radius:78,view:85},large:{major:5,minor:14,planes:17,radius:101,view:114}};
const AIRPORT_NAMES=['ALPINE','BEXLEY','CAPE MIRA','NORTHWICK','SOLSTICE','FERN BAY','PIPER COVE','MOSS POINT','LITTLE PALM','BRAMBLE','GULL ROCK','WILLOW','TIDELIGHT','ASTER','SUNSPUR','CORAL POST','SALTWATER','HONEY HARBOUR','STARLING'];
export const FAULTS=['engine','radio','radar','fuel','hydraulics'];
export const FAULT_NAMES={engine:'Engine power loss',radio:'Radio blackout',radar:'Radar dropout',fuel:'Fuel leak',hydraulics:'Hydraulic pressure loss'};
export const SCHEMA_VERSION='little-airways.ask.v1';

/** @typedef {{id:string,type:'categorical',prompt:string,options:Array<{value:string,label:string}>}|{id:string,type:'boolean',prompt:string}} Question */
/** @typedef {{questionId:string,type:'categorical'|'boolean',probabilities:Array<{value:string,probability:number}>,confidence:number,factors:string[]}} Answer */
/**
 * API-shaped asynchronous decision boundary. All discretionary aircraft choices use ask().
 * Inputs and outputs are JSON, versioned, validated, and free of Three.js objects.
 * Replace the provider using world.sim.client.setProvider(async (state, questions) => ...).
 * Confidence is a mock heuristic, NOT a calibrated safety or aviation estimate.
 */
export class DecisionClient {
 constructor(){this.calls=0;this.errors=0;this.provider=mockAsk;this.model='archipelago-mock/1';this.lastError=null;this.timeoutMs=5000;}
 setProvider(provider,label='custom decision provider'){if(typeof provider!=='function')throw new TypeError('Provider must be a function');this.provider=provider;this.model=label;}
 async ask(state,questions){
  if(!state||!Array.isArray(questions)||!questions.length)throw new TypeError('ask requires a state and typed questions');
  const expected=JSON.parse(JSON.stringify(questions));
  const ids=new Set();for(const q of expected){if(!q||typeof q.id!=='string'||ids.has(q.id)||!['categorical','boolean'].includes(q.type))throw new TypeError('Questions need unique IDs and categorical or boolean types');ids.add(q.id);if(q.type==='categorical'&&(!Array.isArray(q.options)||!q.options.length||q.options.some(o=>typeof o.value!=='string'||typeof o.label!=='string')||new Set(q.options.map(o=>o.value)).size!==q.options.length))throw new TypeError('Categorical choices must be unique labeled strings');}
  this.calls++;const before=performance.now();let timer;
  try{
   const response=await Promise.race([Promise.resolve(this.provider(JSON.parse(JSON.stringify(state)),JSON.parse(JSON.stringify(expected)))),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('Decision provider timed out')),this.timeoutMs);})]);
   if(response.schemaVersion!==SCHEMA_VERSION||!Array.isArray(response.answers))throw new Error('Wrong decision schema');
   if(response.answers.length!==expected.length||new Set(response.answers.map(a=>a.questionId)).size!==expected.length)throw new Error('Answers must correspond one-to-one to questions');
   for(const q of expected){
    const a=response.answers.find(x=>x.questionId===q.id);if(!a||a.type!==q.type||!Array.isArray(a.probabilities))throw new Error(`Missing or mistyped answer: ${q.id}`);
    const allowed=q.type==='boolean'?['true','false']:q.options.map(o=>o.value);
    if(a.probabilities.length!==allowed.length||new Set(a.probabilities.map(p=>p.value)).size!==allowed.length||a.probabilities.some(p=>!allowed.includes(p.value)||!Number.isFinite(p.probability)||p.probability<0||p.probability>1))throw new Error(`Invalid probabilities: ${q.id}`);
    const sum=a.probabilities.reduce((s,p)=>s+p.probability,0);if(Math.abs(sum-1)>.001)throw new Error(`Probabilities must sum to one: ${q.id}`);
    if(!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw new Error('Confidence must be in [0,1]');
    if(!Array.isArray(a.factors)||a.factors.some(v=>typeof v!=='string'))throw new Error('Factors must be an array of strings');
   }
   this.lastError=null;const packet={...response,latencyMs:performance.now()-before};
   try{this.onExchange?.({aircraftId:state?.aircraft?.id??null,state,questions:expected,model:this.model,response:packet});}catch(_){/* monitor must never break the sim */}
   return packet;
  }catch(e){this.errors++;this.lastError=e.message;try{this.onExchange?.({aircraftId:state?.aircraft?.id??null,state,questions:expected,model:this.model,error:e.message});}catch(_){/* ignore */}
   throw e;}finally{clearTimeout(timer);}
 }
}
function softmax(scores){const max=Math.max(...scores);const e=scores.map(s=>Math.exp(s-max)),sum=e.reduce((a,b)=>a+b,0);return e.map(x=>x/sum);}
const top=a=>a.probabilities.reduce((x,y)=>y.probability>x.probability?y:x);
export async function mockAsk(state,questions){
 const ac=state.aircraft||{}, f=ac.faults||{}, endurance=ac.fuelMinutesRemaining??999, etaDest=ac.destinationMinutesRemaining??null, leak=f.fuel>0;
 const cutting=etaDest!=null&&endurance<etaDest+3, emergency=f.engine*.9+f.fuel*.8+f.hydraulics*.66+(ac.fuel<.16?.9:0)+(leak&&endurance<8?.6:0)+(cutting?.7:0);
 const near=state.nearbyEmergencies||[], affected=near.length>0, sameArrival=near.some(e=>e.destination===ac.destination), radio=f.radio>.5;
 const factors=[];
 if(state.role==='tower')factors.push(`${(state.candidates||[]).length} aircraft are waiting for one runway; emergencies and low fuel land first.`);
 if(f.engine)factors.push('Power is falling; favour a reachable runway.');
 if(leak)factors.push(`Fuel is escaping — about ${Math.round(endurance)} minutes left; land soon.`);
 if(cutting)factors.push(`Cutting it close: ${Math.round(endurance)} min of fuel vs ${Math.round(etaDest)} min to destination.`);
 if(ac.runwayOccupiedBy)factors.push(`Runway currently occupied by ${ac.runwayOccupiedBy}; expect a hold.`);
 if(f.hydraulics)factors.push('Limited control authority; favour a long runway.');
 if(f.radio)factors.push('Radio is unavailable; rely on beacon and visual separation.');
 if(f.radar)factors.push('Radar picture is incomplete; give traffic more room.');
 if(affected)factors.push('A nearby aircraft needs priority and a clear approach.');
 if(!factors.length)factors.push('All systems healthy; maintain the filed route.');
 factors.push(`Wind ${state.weather.windKt} kt · ${ac.kind==='jet'?'paved runways only':'small airstrips available'}.`);
 if(!emergency&&!affected)factors.push('Fuel reserve and arrival spacing look comfortable.');
 const answers=questions.map(q=>{
  const opts=q.type==='boolean'?['true','false']:q.options.map(o=>o.value);
  const scores=opts.map(value=>{
   if(q.id==='landing_order'){const c=(state.candidates||[]).find(c=>c.id===value);if(!c)return -20;return (c.emergency?3.2:0)+(c.announced?1.2:0)-c.fuel*.4-(c.fuelMinutesRemaining??60)*.015+(c.kind==='jet'?.25:0);}
   if(q.id==='broadcast')return value==='true'?(emergency>.28?4.2:radio?2.2:-3.8):1.1;
   if(q.id==='response'){
    if(!affected)return value==='maintain'?4:-1.5;
    if(value==='maintain')return -1;
    if(value==='give_way')return sameArrival?2.1:3.2+(state.aircraft.index%3===0?.7:0);
    if(value==='relay')return radio?-8:state.nearbyEmergencies.some(e=>e.radioSilent)?4.1:1.2;
    if(value==='hold')return sameArrival?3.8:1;
    if(value==='divert')return sameArrival&&state.aircraft.index%2===0?4.15:.2;
   }
   if(q.id==='destination'){
    const a=state.airports.find(a=>a.id===value);if(!a)return -20;
    const maxD=Math.max(...state.airports.map(x=>x.distance)),ideal=maxD*(state.aircraft.kind==='jet'?.8:.25);
    return 1.8-Math.abs(a.distance-ideal)*.05+Math.sin(state.aircraft.index*4.1+a.index*3.13+state.leg)*.65-(a.reserved?6:0)+(a.id===state.preferredDestination?2:0);
   }
   if(q.id==='clearance'){
    const dest=state.airports.find(a=>a.id===state.aircraft.destination);const blocked=dest?.reserved&&dest.reserved!==state.aircraft.id;
    return value==='approach'?(blocked?-2.5:3.5):blocked?3.7:-.5;
   }
   if(q.id==='route'){
    if(value==='continue')return (emergency>.3?-1.3:affected&&sameArrival?0.3:f.radar?2.35:4.1+(state.aircraft.currentDecision==='continue'?.3:0))-(leak?2.6:0)-(cutting?3.2:0);
    if(value==='hold')return (emergency>.3?-1.6:f.radar?3.55:affected&&sameArrival?3.3:.65)-(leak?2.1:0)-(cutting?2.2:0);
    if(value.startsWith('divert:')){
     const a=state.airports.find(a=>a.id===value.slice(7));if(!a)return -20;
     const reach=a.minutesToReach<endurance-1?Math.min(1.5,(endurance-a.minutesToReach)*.25):-(a.minutesToReach-endurance)*1.2;
     return (emergency>.3?4.5:affected&&sameArrival?2.8:.3)-a.distance*.055+(f.hydraulics?a.runwayMeters/1800:0)+(leak?1.4:0)+reach+(a.reserved&&a.reserved!==state.aircraft.id?-4:0)+(state.aircraft.destination===a.id&&emergency>.3?.45:0)+Math.sin(state.aircraft.index+a.index)*.11;
    }
   }
   return 0;
  });
  const probs=softmax(scores);const confidence=clamp(.94-(f.radar?.20:0)-(f.radio?.12:0)-(affected?.04:0)-(ac.fuel<.10?.06:0),.45,.96);
  return {questionId:q.id,type:q.type,probabilities:opts.map((value,i)=>({value,probability:probs[i]})),confidence,factors:factors.slice(0,3)};
 });
 return {schemaVersion:SCHEMA_VERSION,model:'archipelago-mock/1',answers};
}

export class Simulation{
 constructor(seed,size,airports){this.seed=seed;this.size=size;this.airports=airports;this.time=0;this.leg=0;this.client=new DecisionClient();this.planes=[];this.events=[];this.log=[];this.listeners=[];this.disposed=false;this.epoch=0;this.speed=1;this.paused=false;this.selected='N42';this.lastNetwork=0;this.delivered=0;this.interventions=0;this.weather={windKt:7,direction:245};}
 emit(event){this.events.push({...event,time:this.time});if(this.events.length>100)this.events.shift();for(const l of this.listeners)l(event);}
 say(id,text,tone='normal'){this.log.unshift({id,text,tone,time:this.time,key:`${this.time.toFixed(3)}-${this.log.length}`});if(this.log.length>100)this.log.pop();this.emit({type:'log',id,text,tone});}
 async init(){
  const r=rng(this.seed+97), names=['N42','AB123','DL901','N16','N77','SK208','N21','N85','AM404','N08','BA603','N91','PW102','N37','N65','LA707','N53'];
  const positions=[[-3,4],[-9,-25],[7,15],[-26,22],[27,2],[-34,-4],[9,-8],[-8,30],[34,20],[-43,24],[40,-25],[-34,-25],[0,-47],[49,5],[5,46],[-45,-9],[44,36]];
  for(let i=0;i<SETS[this.size].planes;i++){
   const kind=(i===1||i===2||i===5||i===8||i===10||i===12||i===15)?'jet':'prop';const xy=positions[i];
   const plane={id:names[i],index:i,kind,model:kind==='jet'?'Islandliner 72':'Cessna 172',color:kind==='jet'?'#ed8474':choose(r,['#f5c958','#b4dcb3','#f3d66e','#e8a589']),pos:V(xy[0],i===0?6.3:6+i%3*1.1,xy[1]),heading:i*.9,bank:0,fuel:i===0?.62:.66+r()*.28,faults:Object.fromEntries(FAULTS.map(f=>[f,0])),destination:null,origin:null,phase:'cruise',progress:0,curve:null,baseSpeed:kind==='jet'?1.25:.93,velocity:0,targetAltitude:6+i%3*1.1,nextThink:0,pending:false,packet:null,error:null,currentDecision:'continue',reaction:'maintain',lastReactionAt:-99,announced:false,landedAt:null,bubble:null,holdCenter:null,holdUntil:0,emergencyUntil:0,appliedDecision:null,trail:[],epoch:0,leg:0};
   this.planes.push(plane);
   const eligible=this.eligible(plane);const maxD=Math.max(...eligible.map(a=>dist(plane.pos,a)));const ideal=maxD*(plane.kind==='jet'?.8:.25);const preferred=eligible.slice().sort((a,b)=>Math.abs(dist(plane.pos,a)-ideal)-Math.abs(dist(plane.pos,b)-ideal))[0]?.id;
   const q={id:'destination',type:'categorical',prompt:plane.kind==='jet'?'Choose the arrival airport; this airliner flies the long legs between major airports.':'Choose the arrival airport; this light aircraft hops between nearby fields.',options:eligible.map(a=>({value:a.id,label:a.name}))};
   const state=this.state(plane);state.preferredDestination=preferred;
   const packet=await this.client.ask(state,[q]);const chosen=top(packet.answers[0]).value;this.setRoute(plane,chosen);
   plane.nextThink=i*.17;
  }
  this.say('ARCHIPELAGO','Good evening, little airways. Clear skies and a gentle westerly.','tower');
  this.say('N42','A pocketful of sunshine, bound for Alpine.','normal');
  await this.step(.01);
 }
 eligible(p){return this.airports.filter(a=>p.kind==='prop'||a.runwayMeters>=1500);}
 state(p){const sp=this.speedOf(p)||.01,dest=this.airports.find(a=>a.id===p.destination);return {schemaVersion:SCHEMA_VERSION,simulationTime:this.time,seed:this.seed,leg:p.leg,aircraft:{id:p.id,index:p.index,kind:p.kind,fuel:p.fuel,fuelMinutesRemaining:+((Math.max(0,p.fuel-.015)/((p.burnRate||.00013)*60)).toFixed(1)),destinationMinutesRemaining:dest?+((dist(p.pos,dest)/sp/60).toFixed(1)):null,runwayOccupiedBy:dest&&dest.occupiedBy&&dest.occupiedBy!==p.id?dest.occupiedBy:null,faults:{...p.faults},destination:p.destination,phase:p.phase,currentDecision:p.currentDecision,position:{x:p.pos.x,y:p.pos.y,z:p.pos.z}},weather:{...this.weather},airports:this.eligible(p).map(a=>({id:a.id,index:a.index,name:a.name,distance:dist(p.pos,a),minutesToReach:+((dist(p.pos,a)/sp/60).toFixed(1)),runwayMeters:a.runwayMeters,reserved:a.reserved||null})),nearbyEmergencies:this.planes.filter(o=>o!==p&&o.announced&&o.phase!=='landed'&&dist(p.pos,o.pos)<38).map(o=>({id:o.id,destination:o.destination,distance:dist(p.pos,o.pos),radioSilent:!!o.faults.radio}))};}
 setRoute(p,id){
  if(p.destination&&p.destination!==id){const old=this.airports.find(x=>x.id===p.destination);if(old&&old.occupiedBy===p.id){old.occupiedBy=null;void this.assignNext(old);}}
  const a=this.airports.find(a=>a.id===id);if(!a)return;
  const rw=this.landingRunway(a,p.pos);p.landingRunway={heading:rw.heading,dir:rw.dir.clone(),len:rw.len,threshold:rw.threshold.clone()};
  const end=rw.threshold.clone();let delta=end.clone().sub(p.pos);delta.y=0;const distance=delta.length();if(distance<.1)delta.set(0,0,1);delta.normalize();
  const climbing=!!p.takeoffDir;const along=climbing?p.takeoffDir.clone():delta.clone();
  const c1=p.pos.clone().add(along.multiplyScalar(distance*(climbing?.3:.32)));c1.y=climbing?p.pos.y+1.4:p.targetAltitude;const bend=V(-delta.z,0,delta.x).multiplyScalar(distance*.12*(p.index%2?1:-1));c1.add(bend);
  const c2=end.clone().sub(rw.dir.clone().multiplyScalar(Math.min(16,distance*.38)));c2.y=a.y+2.4;c2.add(bend.clone().multiplyScalar(.4));
  p.curve=new THREE.CubicBezierCurve3(p.pos.clone(),c1,c2,end);p.length=Math.max(3,p.curve.getLength());p.progress=0;p.destination=id;p.phase='cruise';p.holdCenter=null;p.landingGranted=false;p.takeoffDir=null;
 }
 landingRunway(a,pos){
  const cx=a.x,cz=a.z+(a.major?a.r*.13:0),toWind=this.weather.direction*Math.PI/180,bearing=Math.atan2(a.x-pos.x,a.z-pos.z);
  let best=null;
  for(const [angle,len] of a.runways)for(const h of [angle,angle+Math.PI]){
   const dir=V(Math.sin(h),0,Math.cos(h)),score=Math.cos(h-toWind)*.55+Math.cos(h-bearing)*.45;
   if(!best||score>best.score)best={score,heading:h,dir,len,threshold:V(cx-dir.x*len*.42,a.y+.14,cz-dir.z*len*.42)};
  }
  return best;
 }
 requestSlot(p){
  const a=this.airports.find(x=>x.id===p.destination);if(!a||p.landingGranted)return;
  a.queue=a.queue.filter(id=>{const q=this.planes.find(x=>x.id===id);return q&&q.destination===a.id&&q.phase!=='landed'&&q.phase!=='rollout'&&q.phase!=='takeoff';});
  if(a.occupiedBy===p.id){p.landingGranted=true;return;}
  if(a.occupiedBy===null&&!a.queue.length){a.occupiedBy=p.id;p.landingGranted=true;return;}
  if(!a.queue.includes(p.id)){a.queue.push(p.id);this.say(p.id,`No runway free at ${a.name}; joining the hold.`,'notice');p.bubble={text:'HOLDING FOR TRAFFIC',until:this.time+6,tone:'notice'};this.hold(p,16);}
 }
 releaseRunway(airportId){const a=this.airports.find(x=>x.id===airportId);if(!a||a.occupiedBy===null)return;a.occupiedBy=null;void this.assignNext(a);}
 async assignNext(a){
  if(this.disposed||a.occupiedBy)return;
  const waiting=a.queue.map(id=>this.planes.find(p=>p.id===id)).filter(p=>p&&p.destination===a.id&&p.phase!=='landed'&&p.phase!=='rollout'&&p.phase!=='takeoff');
  if(!waiting.length){a.queue=[];return;}
  const generation=this.epoch;let chosen=waiting[0];
  if(waiting.length>1){try{chosen=await this.towerDecide(a,waiting);if(this.disposed||generation!==this.epoch)return;}catch(e){chosen=waiting.slice().sort((x,y)=>x.fuel-y.fuel)[0];}}
  a.queue=a.queue.filter(id=>id!==chosen.id);a.occupiedBy=chosen.id;chosen.landingGranted=true;
  if(chosen.phase==='holding')chosen.holdUntil=this.time-.01;
  this.say(`${a.name} TWR`,`${chosen.id}, you're number one; the runway is yours next.`,'tower');
 }
 async towerDecide(a,waiting){
  const state={schemaVersion:SCHEMA_VERSION,simulationTime:this.time,role:'tower',airport:{id:a.id,name:a.name},candidates:waiting.map(p=>({id:p.id,kind:p.kind,note:p.kind==='jet'?'airliner — needs the long runway':'light aircraft',fuel:+p.fuel.toFixed(2),fuelMinutesRemaining:+((Math.max(0,p.fuel-.015)/((p.burnRate||.00013)*60)).toFixed(1)),emergency:this.hasEmergency(p),announced:p.announced})),weather:{...this.weather}};
  const q=[{id:'landing_order',type:'categorical',prompt:'Several aircraft want this runway; only one may use it at a time. Which should land first?',options:waiting.map(p=>({value:p.id,label:`${p.id} — ${p.kind==='jet'?'airliner':'light aircraft'}`}))}];
  const packet=await this.client.ask(state,q);
  return waiting.find(p=>p.id===top(packet.answers[0]).value)||waiting[0];
 }
 questions(p){
  const eligible=this.eligible(p).map(a=>({...a,distance:dist(p.pos,a)})).sort((a,b)=>a.distance-b.distance);
  const alts=eligible.filter(a=>a.id!==p.destination||this.hasEmergency(p)).slice(0,2);
  const maydayNearby=this.planes.some(o=>o!==p&&o.announced&&o.phase!=='landed'&&dist(p.pos,o.pos)<38);
  const responseQuestion=maydayNearby?{id:'response',type:'categorical',prompt:'Another aircraft has declared an emergency and has priority. How should this aircraft respond?',options:[
   {value:'maintain',label:'Maintain course',description:'Maintain course and speed — fine if your arrival airport differs from the emergency\u2019s or you are far from it'},
   {value:'give_way',label:'Give way',description:'Give way: climb or offset now so the emergency aircraft has a clear approach and runway'},
   {value:'relay',label:'Relay the mayday',description:'Act as radio relay between the emergency aircraft and the tower (it cannot transmit)'},
   {value:'hold',label:'Hold clear',description:'Enter a holding pattern clear of the arrival airport until the emergency lands'},
   {value:'divert',label:'Divert to an alternate',description:'Divert to an alternate airport so the arrival airport is entirely theirs'}
  ]}:{id:'response',type:'categorical',prompt:'How should this aircraft respond to nearby traffic?',options:[{value:'maintain',label:'Maintain course'},{value:'give_way',label:'Give way'},{value:'relay',label:'Relay the mayday'},{value:'hold',label:'Hold clear'},{value:'divert',label:'Divert to an alternate'}]};
  return [{id:'route',type:'categorical',prompt:'What should this aircraft do next?',options:[{value:'continue',label:this.hasEmergency(p)?'Keep cruising':`Continue to ${this.airports.find(a=>a.id===p.destination)?.name||'arrival'}`},...alts.map(a=>({value:`divert:${a.id}`,label:`${a.id===p.destination?'Land at':'Divert to'} ${a.name}`})),{value:'hold',label:'Enter a holding pattern'}]},{id:'broadcast',type:'boolean',prompt:'Should this aircraft declare an emergency?'},responseQuestion,{id:'clearance',type:'categorical',prompt:'Is the intended approach available?',options:[{value:'approach',label:'Approach'},{value:'go_around',label:'Go around'}]}];
 }
 hasEmergency(p){return p.faults.engine+p.faults.fuel+p.faults.hydraulics>0||p.fuel<.16;}
 async think(p){
  if(p.pending||this.disposed)return;p.pending=true;const generation=this.epoch,version=p.epoch;const questions=this.questions(p);p.questions=questions;
  try{
   const packet=await this.client.ask(this.state(p),questions);
   if(this.disposed||generation!==this.epoch||version!==p.epoch)return;
   p.packet=packet;p.error=null;
   const by=id=>packet.answers.find(a=>a.questionId===id);p.currentDecision=top(by('route')).value;
   const declare=top(by('broadcast')).value==='true';
   if(declare&&!p.announced&&p.phase!=='landed'){
    p.announced=true;p.emergencyUntil=this.time+80;p.bubble={text:p.faults.radio?'RADIO SILENT':'MAYDAY',until:this.time+8,tone:'danger'};
    const fault=FAULTS.find(f=>p.faults[f])||'fuel';
    this.say(p.id,p.faults.radio?'Radio silent. Emergency beacon active; requesting a relay.':`MAYDAY — ${FAULT_NAMES[fault]?.toLowerCase()||'low fuel'}. Requesting priority.`, 'danger');
    this.emit({type:'mayday',id:p.id,x:p.pos.x,z:p.pos.z});
   }
   if(p.currentDecision.startsWith('divert:')){
    const dest=p.currentDecision.slice(7);
    if(dest!==p.destination||p.phase==='holding'){
     this.setRoute(p,dest);const a=this.airports.find(a=>a.id===dest);
     this.say(p.id,`Diverting to ${a.name}. Confidence ${Math.round(by('route').confidence*100)}%.`,this.hasEmergency(p)?'danger':'notice');
     p.bubble={text:`→ ${a.name}`,until:this.time+5,tone:this.hasEmergency(p)?'danger':'notice'};
    }
   }
   if(p.announced&&this.hasEmergency(p)){
    const a=this.airports.find(a=>a.id===p.destination);
    if(a&&!a.reserved){a.reserved=p.id;this.say(`${a.name} TWR`,`${p.id}, priority approach is yours. Other traffic, make a little room.`, 'tower');this.emit({type:'reserve',id:p.id,airport:a.id});}
   }
   const reaction=top(by('response')).value;
   if(!this.hasEmergency(p)&&reaction!=='maintain'&&(p.reaction!==reaction||this.time-p.lastReactionAt>18)){
    p.reaction=reaction;p.lastReactionAt=this.time;const casualty=this.state(p).nearbyEmergencies[0];
    if(casualty){
     if(reaction==='give_way'){p.targetAltitude=7.7+p.index%3;p.bubble={text:'MAKING ROOM',until:this.time+6,tone:'notice'};this.say(p.id,`Giving ${casualty.id} some room. Climbing clear.`, 'notice');}
     if(reaction==='relay'){p.bubble={text:'RELAYING',until:this.time+6,tone:'notice'};this.say(p.id,`Relaying ${casualty.id}'s emergency to the tower. We hear you.`, 'notice');}
     if(reaction==='hold'){this.hold(p,12);p.bubble={text:'HOLDING CLEAR',until:this.time+6,tone:'notice'};this.say(p.id,`Holding clear for ${casualty.id}. No hurry on our end.`, 'notice');}
     if(reaction==='divert'){
      const alternatives=this.eligible(p).filter(a=>a.id!==p.destination&&!a.reserved);
      if(alternatives.length){const qs=[{id:'destination',type:'categorical',prompt:'Choose an alternate to free the emergency approach.',options:alternatives.map(a=>({value:a.id,label:a.name}))}];const answer=await this.client.ask(this.state(p),qs);if(!this.disposed&&generation===this.epoch&&version===p.epoch){const dest=top(answer.answers[0]).value;this.setRoute(p,dest);this.say(p.id,`Diverting to ${this.airports.find(a=>a.id===dest).name}, leaving the approach clear.`, 'notice');p.bubble={text:'DIVERTING',until:this.time+6,tone:'notice'};}}
     }
     this.emit({type:'response',id:p.id,to:casualty.id,reaction});
    }
   }else if(reaction==='maintain'&&p.reaction!=='maintain'&&!this.state(p).nearbyEmergencies.length){p.reaction='maintain';p.targetAltitude=6+p.index%3*1.1;}
   if(!this.hasEmergency(p)&&p.currentDecision==='hold'&&p.phase!=='holding')this.hold(p,10);
   p.clearance=top(by('clearance')).value;
  }catch(e){p.error=e.message;if(!p.errorLogged){this.say('MODEL',`${p.id}: ${e.message}. Keeping the last valid plan.`, 'warning');p.errorLogged=true;}}
  finally{p.pending=false;}
 }
 hold(p,duration){if(p.phase==='holding')return;p.phase='holding';p.holdCenter=p.pos.clone().add(V(4,0,0));p.holdAngle=Math.PI;p.holdUntil=this.time+duration;}
 inject(id,fault){const p=this.planes.find(p=>p.id===id);if(!p||!FAULTS.includes(fault)||p.phase==='landed')return false;p.faults[fault]=p.faults[fault]?0:.83;p.epoch++;p.nextThink=this.time;p.errorLogged=false;this.interventions++;this.say('CONTROL',`${p.id} · ${FAULT_NAMES[fault]} ${p.faults[fault]?'injected':'cleared'}.`,p.faults[fault]?'warning':'tower');this.emit({type:'fault',id,fault,active:!!p.faults[fault]});if(!this.hasEmergency(p)&&!p.faults.radio)this.clearIncident(p);return true;}
 clearIncident(p){p.announced=false;for(const a of this.airports)if(a.reserved===p.id)a.reserved=null;}
 repair(id){const p=this.planes.find(p=>p.id===id);if(!p)return;for(const f of FAULTS)p.faults[f]=0;p.fuel=Math.max(p.fuel,.6);p.epoch++;p.nextThink=this.time;p.currentDecision='continue';this.clearIncident(p);this.say('MAINTENANCE',`${p.id}, all systems restored. Blue skies ahead.`, 'tower');this.emit({type:'repair',id});}
 async departure(p){const generation=this.epoch;p.pending=true;const opts=this.eligible(p).filter(a=>a.id!==p.destination&&!a.reserved);if(!opts.length){p.pending=false;return;}try{const packet=await this.client.ask(this.state(p),[{id:'destination',type:'categorical',prompt:p.kind==='jet'?'Choose the next destination; airliners fly the long legs between major airports.':'Choose the next destination; light aircraft hop between nearby fields.',options:opts.map(a=>({value:a.id,label:a.name}))}]);if(this.disposed||generation!==this.epoch)return;p.origin=p.destination;p.leg++;p.fuel=.9;for(const f of FAULTS)p.faults[f]=0;this.clearIncident(p);p.targetAltitude=6+p.index%3*1.1;const dest=top(packet.answers[0]).value;const hereA=this.airports.find(x=>x.id===p.origin);if(hereA){hereA.occupiedBy=p.id;const rw=this.landingRunway(hereA,p.pos);const d=rw.dir.clone().negate();p.takeoffDir=d;p.toDir=d;p.toAvail=Math.max(3,rw.len-(p.rollDist||0)-.5);p.occupying=hereA.id;p.phase='turn';p.turnT=0;p.turnFrom=p.heading;p.turnStart={x:p.pos.x,z:p.pos.z};}p.pendingDest=dest;p.velocity=.08;p.curve=null;p.currentDecision='continue';p.reaction='maintain';this.say(p.id,`Turning around at ${hereA?hereA.name:'the field'}; departing the far end for ${this.airports.find(a=>a.id===dest).name}.`,'normal');}catch(e){p.error=e.message;}finally{p.pending=false;}}
 speedOf(p){return p.baseSpeed*(p.faults.engine?.51:1)*(p.faults.hydraulics?.78:1)*(p.fuel<.07?.7:1);}
 async step(dt,awaitDecisions=true){
  if(this.disposed)return;this.time+=dt;const promises=[];
  for(const p of this.planes){
   if(p.phase==='landed'){
    if(this.time-p.landedAt>8&&!p.pending)promises.push(this.departure(p));continue;
   }
   p.burnRate=.00013+(p.faults.fuel?p.faults.fuel*.009:0);p.fuel=Math.max(.015,p.fuel-dt*p.burnRate);
   const speed=this.speedOf(p);if(p.phase!=='turn'&&p.phase!=='takeoff')p.velocity=speed;
   const prev=p.pos.clone();
   if(p.phase==='holding'){
    p.holdAngle-=dt*speed/4;p.pos.set(p.holdCenter.x+Math.cos(p.holdAngle)*4,p.targetAltitude,p.holdCenter.z+Math.sin(p.holdAngle)*4);
    if(this.time>p.holdUntil)this.setRoute(p,p.destination);
   }else if(p.phase==='rollout'){
    const rw=p.landingRunway;
    if(!rw){p.phase='landed';p.landedAt=this.time;p.velocity=0;}
    else{
     p.velocity=Math.max(0,p.velocity-dt*(p.kind==='jet'?.34:.26));p.rollDist=(p.rollDist||0)+p.velocity*dt;
     const roll=Math.min(p.rollDist,rw.len*.8);
     p.pos.set(rw.threshold.x+rw.dir.x*roll,rw.threshold.y,rw.threshold.z+rw.dir.z*roll);
     if(p.velocity<=.045||p.rollDist>=rw.len*.8){p.phase='landed';p.landedAt=this.time;p.velocity=0;this.delivered++;this.say(p.id,p.announced?'Safe on the ground. Thank you, everyone. Kettle on.':'Touchdown. Another small journey, safely home.',p.announced?'tower':'normal');this.clearIncident(p);p.bubble={text:'HOME SAFE',until:this.time+7,tone:'safe'};}
    }
   }else if(p.phase==='turn'){
    p.turnT=Math.min(1,p.turnT+dt/2.2);const t=p.turnT*Math.PI,r=.95;
    const f0=V(Math.sin(p.turnFrom),0,Math.cos(p.turnFrom)),l0=V(Math.cos(p.turnFrom),0,-Math.sin(p.turnFrom));
    p.pos.x=p.turnStart.x+r*(Math.sin(t)*f0.x+(1-Math.cos(t))*l0.x);
    p.pos.z=p.turnStart.z+r*(Math.sin(t)*f0.z+(1-Math.cos(t))*l0.z);
    p.heading=p.turnFrom+t;
    if(p.turnT>=1){
     p.phase='takeoff';p.velocity=.1;p.toRoll=0;
     const d=p.toDir,h=Math.atan2(d.x,d.z),right=V(-Math.cos(h),0,Math.sin(h));
     const a=this.airports.find(x=>x.id===(p.origin||p.destination));
     const cx=a?a.x:p.pos.x,cz=a?(a.z+(a.major?a.r*.13:0)):p.pos.z;
     p.toLat0=(p.pos.x-cx)*right.x+(p.pos.z-cz)*right.z;
     p.toLine0={x:p.pos.x-right.x*p.toLat0,z:p.pos.z-right.z*p.toLat0};
     p.toRight=right;
    }
   }else if(p.phase==='takeoff'){
    p.velocity=Math.min(p.baseSpeed,p.velocity+dt*(p.kind==='jet'?.17:.24));
    p.toRoll=(p.toRoll||0)+p.velocity*dt;
    const fade=Math.max(0,1-p.toRoll/4),lat=(p.toLat0||0)*fade;
    if(p.toLine0){p.pos.x=p.toLine0.x+p.toDir.x*p.toRoll+p.toRight.x*lat;p.pos.z=p.toLine0.z+p.toDir.z*p.toRoll+p.toRight.z*lat;}
    if(p.toRoll>=(p.toAvail||8)*.55&&p.pendingDest){const dest=p.pendingDest;p.pendingDest=null;this.setRoute(p,dest);if(p.occupying){this.releaseRunway(p.occupying);p.occupying=null;}}
   }else if(p.curve){
    p.progress=Math.min(1,p.progress+dt*speed/p.length);p.curve.getPoint(p.progress,p.pos);
    if(p.progress<.77){const cruise=smooth(0,.13,p.progress)*(1-smooth(.65,.96,p.progress));p.pos.y=lerp(p.pos.y,p.targetAltitude,cruise);}
    p.phase=p.progress>.8?'approach':'cruise';
    if(p.progress>.55&&p.progress<1)this.requestSlot(p);
    if(p.progress>.85&&p.clearance==='go_around'&&!this.hasEmergency(p)&&!this.airports.find(x=>x.id===p.destination)?.queue.includes(p.id)){this.say(p.id,'Going around; keeping the priority runway clear.','notice');this.hold(p,12);}
    if(p.progress>=1){
     const destA=this.airports.find(x=>x.id===p.destination);
     if(destA&&destA.occupiedBy!==p.id){this.say(p.id,'Going around; the runway changed hands on short final.','notice');p.bubble={text:'GO AROUND',until:this.time+5,tone:'notice'};this.hold(p,12);}
     else{p.phase='rollout';p.rollDist=0;}
    }
   }
   const dx=p.pos.x-prev.x,dz=p.pos.z-prev.z;if(Math.abs(dx)+Math.abs(dz)>1e-6){const heading=Math.atan2(dx,dz);let delta=((heading-p.heading+Math.PI*3)%TAU)-Math.PI;p.bank=lerp(p.bank,clamp(-delta*2.5,-.32,.32),1-Math.exp(-dt*3));p.heading+=delta*(1-Math.exp(-dt*8));}
   if(this.time>=p.nextThink&&!p.pending&&p.phase!=='landed'){p.nextThink=this.time+1.6;promises.push(this.think(p));}
  }
  if(awaitDecisions)await Promise.all(promises);else void Promise.all(promises);
 }
 dispose(){this.disposed=true;this.epoch++;this.listeners.length=0;}
 snapshot(){return {seed:this.seed,size:this.size,time:this.time,calls:this.client.calls,errors:this.client.errors,delivered:this.delivered,selected:this.selected,planes:this.planes.map(p=>({id:p.id,kind:p.kind,position:{x:p.pos.x,y:p.pos.y,z:p.pos.z},destination:p.destination,phase:p.phase,fuel:p.fuel,faults:{...p.faults},decision:p.currentDecision,reaction:p.reaction,announced:p.announced,packet:p.packet})),airports:this.airports.map(a=>({id:a.id,name:a.name,reserved:a.reserved||null})),log:this.log.slice(0,20)};}
}

function roofGeometry(){const pts=[[-.5,0,-.5],[.5,0,-.5],[0,.5,-.5],[-.5,0,.5],[.5,0,.5],[0,.5,.5]],indices=[0,2,1,3,4,5,0,3,5,0,5,2,1,2,5,1,5,4,0,1,4,0,4,3];const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>pts[i]),3));g.computeVertexNormals();return g;}
function polygonPrism(points,height){const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p[0],p[1])));const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);g.translate(0,height/2,0);return g;}
function mergeGeometry(parts){const positions=[],normals=[],colors=[];const nmat=new THREE.Matrix3();for(const {geometry,matrix=new THREE.Matrix4(),tint='#ffffff'} of parts){const g=geometry.index?geometry.toNonIndexed():geometry;const p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color;const col=color(tint);nmat.getNormalMatrix(matrix);for(let i=0;i<p.count;i++){const v=V().fromBufferAttribute(p,i).applyMatrix4(matrix),nn=V().fromBufferAttribute(n,i).applyMatrix3(nmat).normalize();positions.push(v.x,v.y,v.z);normals.push(nn.x,nn.y,nn.z);if(c)colors.push(c.getX(i)*col.r,c.getY(i)*col.g,c.getZ(i)*col.b);else colors.push(col.r,col.g,col.b);}if(g!==geometry)g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeBoundingSphere();return g;}
const matrix=(pos,scale=V(1,1,1),rot=V())=>new THREE.Matrix4().compose(pos,new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x,rot.y,rot.z)),scale);
class Batches{
 constructor(scene){this.scene=scene;this.items=new Map();this.geometries={box:new THREE.BoxGeometry(1,1,1),cone:new THREE.ConeGeometry(1,1,7),cylinder:new THREE.CylinderGeometry(1,1,1,9),taper:new THREE.CylinderGeometry(.65,1,1,9),rock:new THREE.DodecahedronGeometry(1,0),sphere:new THREE.SphereGeometry(1,10,7),roof:roofGeometry(),disc:new THREE.CircleGeometry(1,16),leaf:polygonPrism([[0,0],[.35,.55],[.17,1.45],[0,2],[-.17,1.45],[-.35,.55]],.025)};this.mats={solid:new THREE.MeshStandardMaterial({roughness:.9,metalness:0,color:'white'}),gloss:new THREE.MeshStandardMaterial({roughness:.34,metalness:.13,color:'white'}),light:new THREE.MeshBasicMaterial({color:new THREE.Color(2.15,1.94,1.55),toneMapped:false}),shadow:new THREE.MeshBasicMaterial({color:'white',transparent:true,opacity:.13,depthWrite:false}),cloud:new THREE.MeshStandardMaterial({color:'white',roughness:1,transparent:true,opacity:.37,depthWrite:false})};this.meshes=[];this.custom=[];}
 add(type,tint,x,y,z,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0,mat='solid'){
  const key=type+':'+mat;if(!this.items.has(key))this.items.set(key,[]);this.items.get(key).push({matrix:matrix(V(x,y,z),V(sx,sy,sz),V(rx,ry,rz)),color:color(tint)});
 }
 flush(){if(this.custom.length){const m=new THREE.Mesh(mergeGeometry(this.custom),new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));m.castShadow=true;m.receiveShadow=true;this.scene.add(m);this.meshes.push(m);for(const p of this.custom)p.geometry.dispose();}for(const [key,items]of this.items){const [type,mat]=key.split(':');const m=new THREE.InstancedMesh(this.geometries[type],this.mats[mat],items.length);for(let i=0;i<items.length;i++){m.setMatrixAt(i,items[i].matrix);m.setColorAt(i,items[i].color);}m.castShadow=mat==='solid'||mat==='gloss';m.receiveShadow=mat==='solid'||mat==='gloss';m.frustumCulled=false;if(mat==='shadow')m.renderOrder=1;this.scene.add(m);this.meshes.push(m);}this.items.clear();}
 dispose(){for(const g of Object.values(this.geometries))g.dispose();for(const m of Object.values(this.mats))m.dispose();}
}
function coastline(a,theta){return a.r*(1+.095*Math.sin(theta*3+a.phase)+.065*Math.sin(theta*5-a.phase*.7)+.029*Math.sin(theta*9+1)+.13*Math.max(0,Math.cos(theta-a.phase))**6);}
function localHeight(a,x,z){
 const rr=Math.hypot(x,z/.86)/coastline(a,Math.atan2(z/.86,x)),edge=1-smooth(.76+.055*Math.sin(Math.atan2(z,x)*3+a.phase),.94,rr);let h=a.y*edge;
 if(a.major){
  const peaks=a.index===2?[[-.37,-.36,.24,3.1],[.33,-.45,.25,3.8]]:[[-.46,-.40,.30,6.3],[.09,-.55,.34,7.5],[.51,-.36,.26,5.5]];
  let rock=0;for(const [px,pz,rad,rise]of peaks){const dx=(x/a.r-px),dz=(z/a.r-pz),theta=Math.atan2(dz,dx),d=Math.hypot(dx,dz)/(rad*(1+.1*Math.sin(theta*3+a.phase)));rock=Math.max(rock,Math.max(0,1-d**1.6)**.9*rise);}
  // The runway and apron are engineered level even where the ridge approaches them.
  const angles=[Math.PI/4,-Math.PI/4];let nearest=99;for(const angle of angles){const zz=z-a.r*.13,side=x*Math.cos(angle)-zz*Math.sin(angle),along=x*Math.sin(angle)+zz*Math.cos(angle);nearest=Math.min(nearest,Math.max(Math.abs(side)-1.35,Math.abs(along)-a.r*.69));}h+=Math.min(rock,.72)*smooth(0,1.55,nearest);
 }else h+=Math.exp(-((x+a.r*.32)**2+(z+a.r*.29)**2)/(a.r*a.r*.09))*.65;
 return h;
}
function ground(a,x,z){return localHeight(a,x,z);}
function terrainGeometry(a,rnd){const N=76,R=15,verts=[];for(let j=0;j<=R;j++){const k=j/R;for(let i=0;i<N;i++){const theta=i/N*TAU,rad=coastline(a,theta)*k;let x=Math.cos(theta)*rad,z=Math.sin(theta)*rad*.86;if(j>0&&j<R){x+=(rnd()-.5)*.35;z+=(rnd()-.5)*.35;}verts.push(V(a.x+x,ground(a,x,z),a.z+z));}}
 const pos=[],cols=[];for(let j=0;j<R;j++)for(let i=0;i<N;i++){const n=(i+1)%N;for(const ids of [[j*N+i,(j+1)*N+i,(j+1)*N+n],[j*N+i,(j+1)*N+n,j*N+n]]){const vv=[...ids].reverse().map(k=>verts[k]),mid=vv.reduce((s,v)=>s.add(v),V()).multiplyScalar(1/3);const normal=vv[1].clone().sub(vv[0]).cross(vv[2].clone().sub(vv[0])).normalize();const ring=(j+.5)/R;let palette=mid.y>a.y+5.8&&a.index===0?['#efe6d3','#e8dfcd','#e5dfd0']:mid.y>a.y+2.6?['#b9aea4','#c8b6a6','#aaa0a0']:ring>.86?['#ead4b2','#edd8b7','#e1c9a8']:Math.abs(normal.y)<.6&&ring>.65?['#a6a0a6','#b7aca5','#9b939a']:['#839957','#899c5b','#819655','#8c9e5f'];const cc=color(choose(rnd,palette)).multiplyScalar(.99+rnd()*.02);for(const v of vv){pos.push(v.x,v.y+.04,v.z);cols.push(cc.r,cc.g,cc.b);}}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));g.computeVertexNormals();return g;
}
function shoreGeometry(a,mul1,mul2,yy,tint){const pos=[],cols=[],cc=color(tint),N=80;for(let i=0;i<N;i++){const points=[];for(const [k,m]of[[i,mul1],[i,mul2],[i+1,mul2],[i+1,mul1]]){const ang=k/N*TAU,rr=coastline(a,ang)*m;points.push(V(a.x+Math.cos(ang)*rr,yy,a.z+Math.sin(ang)*rr*.86));}for(const k of[0,2,1,0,3,2]){const p=points[k];pos.push(p.x,p.y,p.z);cols.push(cc.r,cc.g,cc.b);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));g.computeVertexNormals();return g;}
function inRunway(a,x,z,padding=1.8){const angles=a.major?[Math.PI/4,-Math.PI/4]:[a.angle];return angles.some(t=>{const zz=z-(a.major?a.r*.13:0),side=x*Math.cos(t)-zz*Math.sin(t),along=x*Math.sin(t)+zz*Math.cos(t);return Math.abs(side)<padding&&Math.abs(along)<a.r*(a.major?.73:.67)+1;});}

let atlasBytes;
function textTexture(text,kind='airport',tone='normal'){
 if(!atlasBytes){const decode=typeof atob==='function'?atob(FONT.data):Buffer.from(FONT.data,'base64').toString('binary');atlasBytes=Uint8Array.from(decode,c=>c.charCodeAt(0));}
 const pad=13,h=46,letterSpacing=1,widths=[...text].map(c=>FONT.widths[clamp(c.charCodeAt(0)-32,0,94)]||18),w=widths.reduce((a,b)=>a+b,0)+text.length*letterSpacing+pad*2,rgba=new Uint8Array(w*h*4);
 const bg=tone==='danger'?[119,58,48]:tone==='notice'?[42,87,101]:tone==='safe'?[58,100,80]:[41,60,68],fg=tone==='danger'?[255,224,191]:[255,246,218];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const radius=10,dx=Math.max(radius-x,0,x-(w-radius-1)),dy=Math.max(radius-y,0,y-(h-radius-1));if(dx*dx+dy*dy>radius*radius)continue;const i=(y*w+x)*4;rgba[i]=bg[0];rgba[i+1]=bg[1];rgba[i+2]=bg[2];rgba[i+3]=kind==='airport'?224:213;if(y===0||y===h-1||x===0||x===w-1){rgba[i]=205;rgba[i+1]=191;rgba[i+2]=156;rgba[i+3]=120;}}
 let cx=pad;for(let k=0;k<text.length;k++){const idx=clamp(text.charCodeAt(k)-32,0,94),cw=widths[k];for(let y=0;y<FONT.h;y++)for(let x=0;x<Math.min(FONT.w,cw);x++){const alpha=atlasBytes[y*FONT.w*95+idx*FONT.w+x]/255;if(!alpha)continue;const xx=cx+x,yy=y+2;if(xx>=w||yy>=h)continue;const at=(yy*w+xx)*4;for(let j=0;j<3;j++)rgba[at+j]=Math.round(lerp(rgba[at+j],fg[j],alpha));rgba[at+3]=Math.max(rgba[at+3],Math.round(alpha*255));}cx+=cw+letterSpacing;}
 const flipped=new Uint8Array(rgba.length);for(let y=0;y<h;y++)flipped.set(rgba.subarray(y*w*4,(y+1)*w*4),(h-y-1)*w*4);const tx=new THREE.DataTexture(flipped,w,h,THREE.RGBAFormat);tx.colorSpace=THREE.SRGBColorSpace;tx.magFilter=THREE.LinearFilter;tx.minFilter=THREE.LinearFilter;tx.needsUpdate=true;return {tx,ratio:w/h};
}
function label(text,height=1.6,tone='normal',kind='airport'){const {tx,ratio}=textTexture(text,kind,tone);const mat=new THREE.SpriteMaterial({map:tx,depthTest:false,depthWrite:false,toneMapped:false});const s=new THREE.Sprite(mat);s.scale.set(height*ratio,height,1);s.renderOrder=20;s.userData.texture=tx;return s;}
function softTexture(){const n=64,data=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const d=Math.hypot((x-n/2)/(n/2),(y-n/2)/(n/2)),i=(y*n+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(Math.max(0,1-d)**2*255);}const tx=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);tx.needsUpdate=true;return tx;}

function sunsetEnvironment(){
 const w=192,h=96,data=new Float32Array(w*h*4),sunDir=V(.68,.38,-.63).normalize();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const theta=(x+.5)/w*TAU,phi=(y+.5)/h*Math.PI,dir=V(Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta));
  const top=clamp(dir.y*.8+.18),bottom=dir.y<0?.24:1,nearSun=Math.max(0,dir.dot(sunDir)),halo=nearSun**10*.7,disc=nearSun**170*6;
  const idx=(y*w+x)*4;data[idx]=(lerp(.66,.28,top)+halo+disc)*bottom;data[idx+1]=(lerp(.64,.44,top)+halo*.57+disc*.61)*bottom;data[idx+2]=(lerp(.75,.82,top)+halo*.22+disc*.25)*bottom;data[idx+3]=1;
 }
 const env=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;return env;
}

function cloudTexture(){
 // Analytic, softly edged sphere unions: a procedural lit cloud sprite, not artwork.
 const w=192,h=128,data=new Uint8Array(w*h*4);
 const puffs=[[-.69,.06,-.08,.28],[-.41,-.08,.015,.35],[-.05,-.20,0,.43],[.30,-.10,-.055,.40],[.64,.06,-.035,.28],[-.20,.13,.10,.31],[.23,.14,.095,.31]];
 const light=V(.50,-.62,.77).normalize();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=x/w*2-1,v=(y/h*2-1)*.78;let front=-99,normal=V(),edge=0;
  for(const [cx,cy,cz,r]of puffs){const dx=u-cx,dy=v-cy,d=dx*dx+dy*dy;if(d<r*r){const dz=Math.sqrt(r*r-d),z=cz+dz;if(z>front){front=z;normal.set(dx/r,dy/r,dz/r);}edge=Math.max(edge,clamp((r-Math.sqrt(d))/.047));}}
  if(front===-99)continue;
  let weight=0;const blend=V();for(const [cx,cy,cz,r]of puffs){const dx=u-cx,dy=v-cy,d=dx*dx+dy*dy;if(d<r*r){const dz=Math.sqrt(r*r-d),ww=Math.exp((cz+dz-front)*15);blend.addScaledVector(V(dx/r,dy/r,dz/r),ww);weight+=ww;}}if(weight)normal.copy(blend).normalize();
  const illumination=clamp(normal.dot(light)*.72+.28),at=(y*w+x)*4;
  data[at]=lerp(149,255,illumination);data[at+1]=lerp(161,229,illumination);data[at+2]=lerp(199,195,illumination);data[at+3]=Math.round(edge*.96*255);
 }
 const flip=new Uint8Array(data.length);for(let y=0;y<h;y++)flip.set(data.subarray(y*w*4,(y+1)*w*4),(h-y-1)*w*4);
 const tx=new THREE.DataTexture(flip,w,h,THREE.RGBAFormat);tx.colorSpace=THREE.SRGBColorSpace;tx.needsUpdate=true;tx.magFilter=tx.minFilter=THREE.LinearFilter;return tx;
}

export async function createWorld({canvas,width=1600,height=900,seed=42042,size='medium',renderer:givenRenderer=null,quality='high'}={}){
 const config=SETS[size]||SETS.medium,rnd=rng(seed),scene=new THREE.Scene();scene.background=color('#c5bdcb');scene.fog=new THREE.Fog('#d8c8c5',155,290);
 const renderer=givenRenderer||new THREE.WebGPURenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#000000',0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;await renderer.init();
 const errors=[];renderer.onError=e=>{errors.push(e.message);console.error(e.message);};
 const env=sunsetEnvironment();scene.environment=env;scene.environmentIntensity=.24;
 const camera=new THREE.PerspectiveCamera(2*Math.atan(config.view/300)*180/Math.PI,width/height,.1,500);const view={angle:0,pitch:.71,zoom:1.07,target:V(7,0,1)};const updateCamera=()=>{const d=150;camera.position.set(view.target.x+Math.sin(view.angle)*Math.cos(view.pitch)*d,Math.sin(view.pitch)*d,view.target.z+Math.cos(view.angle)*Math.cos(view.pitch)*d);camera.lookAt(view.target);camera.zoom=view.zoom;camera.updateProjectionMatrix();};updateCamera();
 const hemi=new THREE.HemisphereLight('#c1d7f4','#79675a',1.35);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#ffd5a5',3.6);sun.position.set(55,70,30);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);const shadowRange=config.radius*.95;Object.assign(sun.shadow.camera,{left:-shadowRange,right:shadowRange,top:shadowRange,bottom:-shadowRange,near:1,far:260});sun.shadow.bias=-.00015;sun.shadow.normalBias=.10;sun.shadow.radius=3;sun.shadow.intensity=.68;scene.add(sun);
 const fill=new THREE.DirectionalLight('#b0c8ed',.50);fill.position.set(50,22,30);scene.add(fill);
 const clock=TSL.uniform(0),water=new THREE.MeshStandardNodeMaterial({roughness:.30,metalness:.12});
 const wp=TSL.positionWorld;
 const windUV=wp.xz.mul(.14).add(TSL.vec2(clock.mul(.045),clock.mul(.026)));
 const swell=TSL.mx_noise_float(windUV).mul(.06).add(TSL.mx_noise_float(windUV.mul(3.6)).mul(.018));
 const farWater=TSL.smoothstep(14,80,wp.z.negate());
 const waterBase=TSL.mix(TSL.color('#387d9e'),TSL.color('#b6b9c9'),farWater.mul(.65));
 const sunny=TSL.exp(wp.x.sub(43).pow(2).div(-490).add(wp.z.add(47).pow(2).div(-720)));
 const rippleUV=wp.xz.mul(TSL.vec2(.48,1.8)).add(TSL.vec2(clock.mul(.08),clock.mul(.13)));
 const smallWave=TSL.mx_noise_float(rippleUV);
 water.colorNode=waterBase.mul(swell.add(1)).add(TSL.color('#ffdcb2').mul(TSL.smoothstep(.29,.53,smallWave)).mul(sunny).mul(.10));
 water.normalNode=TSL.transformNormalByViewMatrix(TSL.vec3(TSL.mx_noise_float(rippleUV).mul(.06),TSL.float(1),TSL.mx_noise_float(rippleUV.add(TSL.vec2(4.2,1.9))).mul(.055)).normalize(), TSL.cameraViewMatrix);
 const ocean=new THREE.Mesh(new THREE.CircleGeometry(config.radius,192),water);ocean.rotation.x=-Math.PI/2;ocean.position.y=-.23;ocean.receiveShadow=true;scene.add(ocean);
 const base=new THREE.Mesh(new THREE.CylinderGeometry(config.radius,config.radius*.992,2.8,160),new THREE.MeshStandardMaterial({color:'#709caf',roughness:.36,metalness:.12}));base.position.y=-1.72;scene.add(base);
 const rimMat=new THREE.MeshStandardMaterial({color:'#eddbb7',roughness:.2,metalness:.38,transparent:true,opacity:.42});const rim=new THREE.Mesh(new THREE.TorusGeometry(config.radius,.28,8,200),rimMat);rim.rotation.x=Math.PI/2;rim.position.y=-.22;scene.add(rim);
 const backdrop=new THREE.MeshBasicNodeMaterial({fog:false});
 const skyU=TSL.screenUV;const sunlight=TSL.exp(skyU.x.sub(.93).pow(2).div(-.31).add(skyU.y.sub(.02).pow(2).div(-.15)));
 backdrop.colorNode=TSL.mix(TSL.color('#8f9cba'),TSL.color('#ffd2a5'),sunlight);
 const groundPlane=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),backdrop);groundPlane.rotation.x=-Math.PI/2;groundPlane.position.y=-5;scene.add(groundPlane);
 const B=new Batches(scene),staticGeos=[],shoreParts=[[],[],[]],airports=[],majorLocs=[[-28,-17,17],[25,-26,15],[24,24,15.8],[-42,32,14],[36,-47,13]],minorLocs=[[-49,10,6.0],[-20,8,6.6],[-27,33,6.7],[0,36,6.0],[23,0,5.7],[40,2,5.4],[-8,-42,6.4],[-48,-34,5.7],[47,34,5.7],[-10,55,6.2],[-59,-8,5.5],[7,-62,5.6],[60,-17,5.6],[-59,42,6.1]];
 const packed=Array.from({length:config.major+config.minor},(_,i)=>{
  const raw=i<config.major?majorLocs[i]:minorLocs[i-config.major];return {x:raw[0],z:raw[1],r:raw[2],major:i<config.major};
 });
 if(size==='small'){const mini=[[-25,-15],[22,-20],[-43,12],[-10,12],[-24,34],[8,32]];packed.forEach((a,i)=>{a.x=mini[i][0];a.z=mini[i][1];});}
 if(size==='large')for(let iteration=0;iteration<90;iteration++){
  for(let i=0;i<packed.length;i++)for(let j=i+1;j<packed.length;j++){
   const a=packed[i],b=packed[j],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz)||.01,min=(a.r+b.r)*1.12+3.8;
   if(d<min){const amount=(min-d)*.51,wa=a.major?.25:1,wb=b.major?.25:1,scale=2/(wa+wb);a.x-=dx/d*amount*wa*scale;a.z-=dz/d*amount*wa*scale;b.x+=dx/d*amount*wb*scale;b.z+=dz/d*amount*wb*scale;}
  }
  for(const a of packed){const d=Math.hypot(a.x,a.z),max=config.radius-a.r*1.15-3;if(d>max){a.x*=max/d;a.z*=max/d;}}
 }
 const angleJitter=(seed===42042?0:(rnd()-.5)*.18);
 for(let i=0;i<config.major+config.minor;i++){
  const major=i<config.major,raw=major?majorLocs[i]:minorLocs[i-config.major];const jitter=seed===42042?0:1;const x=packed[i].x+(rnd()-.5)*4*jitter,z=packed[i].z+(rnd()-.5)*4*jitter;
  const a={id:`AP${i}`,index:i,name:AIRPORT_NAMES[i],x,z,r:raw[2]*(.97+rnd()*.06),y:major?3.3:2.15,major,phase:rnd()*TAU,angle:(rnd()-.5)*.85,runwayMeters:major?1900+i*220:550+(i%4)*140,reserved:null,lightMeshes:[],occupiedBy:null,queue:[]};a.runways=major?[[Math.PI/4,a.r*1.36],[-Math.PI/4,a.r*1.36]]:[[a.angle,a.r*1.30]];airports.push(a);
  staticGeos.push({geometry:terrainGeometry(a,rnd)});
  shoreParts[0].push({geometry:shoreGeometry(a,.99,1.22,-.18,'#81ccc5')});shoreParts[1].push({geometry:shoreGeometry(a,1.003,1.044,-.17,'#c6e2d6')});shoreParts[2].push({geometry:shoreGeometry(a,.993,1.008,-.155,'#e7ecd7')});
  dressIsland(a,B,rnd);
 }
 const terrain=mergeGeometry(staticGeos);for(const p of staticGeos)p.geometry.dispose();const terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});const land=new THREE.Mesh(terrain,terrainMat);land.castShadow=true;land.receiveShadow=true;scene.add(land);
 const shores=[];for(let i=0;i<3;i++){const g=mergeGeometry(shoreParts[i]);for(const p of shoreParts[i])p.geometry.dispose();const sm=new THREE.MeshBasicNodeMaterial({vertexColors:true,transparent:true,opacity:[.60,.25,.63][i],depthWrite:false,side:THREE.DoubleSide});
 if(i===0){const vals=[],p=g.attributes.position;for(let k=0;k<p.count;k++){let nr=10;for(const a of airports){const x=p.getX(k)-a.x,z=p.getZ(k)-a.z;nr=Math.min(nr,Math.hypot(x,z/.86)/coastline(a,Math.atan2(z/.86,x)));}vals.push(clamp((1.22-nr)/.23));}g.setAttribute('shoreAlpha',new THREE.Float32BufferAttribute(vals,1));sm.opacityNode=TSL.attribute('shoreAlpha','float').mul(.44);}
 const m=new THREE.Mesh(g,sm);m.renderOrder=1;scene.add(m);shores.push(m);}
 // Distant forest islands extend the archipelago toward the soft horizon.
 const remoteParts=[];
 for(let k=0;k<6;k++){
  const a={x:-36+k*13+(rnd()-.5)*3,z:-58-(k%2)*5,r:3.5+rnd()*2.6,y:1.6,major:false,index:40+k,phase:rnd()*TAU};
  if(Math.hypot(a.x,a.z)+a.r>config.radius-2||airports.some(b=>Math.hypot(a.x-b.x,a.z-b.z)<a.r+b.r*1.1+2))continue;
  remoteParts.push({geometry:terrainGeometry(a,rnd)});
  for(let j=0;j<21;j++){const th=rnd()*TAU,rr=Math.sqrt(rnd())*a.r*.68,x=Math.cos(th)*rr,z=Math.sin(th)*rr*.84;pine(B,a.x+x,ground(a,x,z),a.z+z,.55+rnd()*.65,rnd);}
  if(k===1){B.custom.push({geometry:mountainGeometry(a.x,a.y,a.z-1,a.r*.42,4.8,false,rnd)});house(B,a.x+2,a.y,a.z+1,.65,0,rnd);}
 }
 const distantLand=new THREE.Mesh(mergeGeometry(remoteParts),terrainMat);distantLand.castShadow=true;distantLand.receiveShadow=true;if(remoteParts.length)scene.add(distantLand);for(const part of remoteParts)part.geometry.dispose();
 // Tiny uninhabited skerries punctuate the water; never masquerade as airports.
 for(const [x,z,s]of[[-10,-16,2.6],[2,19,2],[40,20,2],[-37,24,1.4],[-18,-31,1.2],[3,-29,2.1],[-39,-1,1.1],[37,-10,1.2]]){
  if(airports.some(a=>Math.hypot(x-a.x,z-a.z)<a.r+2))continue;
  B.add('rock','#b1ad99',x,.2,z,s,s*.7,s*.85,0,rnd()*TAU);B.add('rock','#c1b39a',x+1,.1,z+.4,s*.6,s*.6,s*.65);if(s>2){B.add('disc','#adb980',x,.95,z,s*.78,s*.75,1,-Math.PI/2);if(z<-20)lighthouse(B,x,.7,z,1.02);else pine(B,x,.7,z,1.1,rnd);}
 }
 // Soft procedural cloud banks around the bowl; the airways stay unobscured.
 const cloudMap=cloudTexture(),clouds=[];
 for(let i=0;i<21;i++){
  const a=i/21*TAU+.31,rr=config.radius*(.92+rnd()*.09),cx=Math.cos(a)*rr,cz=Math.sin(a)*rr;
  const mat=new THREE.SpriteMaterial({map:cloudMap,transparent:true,opacity:.86,depthWrite:false,fog:false});
  const c=new THREE.Sprite(mat);c.position.set(cx,6+rnd()*6,cz);c.scale.set(20+rnd()*13,10+rnd()*6,1);c.userData.phase=rnd()*TAU;c.userData.base=c.position.clone();scene.add(c);clouds.push(c);
 }
 for(const [cx,cz,cy,sz]of[[-63,28,9,31],[-57,42,12,27],[-39,59,13,23],[56,42,13,30],[66,8,8,25],[53,-48,10,25],[-68,-22,5,24]]){
  const f=config.radius/78;for(let k=0;k<2;k++){
   const mat=new THREE.SpriteMaterial({map:cloudMap,transparent:true,opacity:k?.72:.88,depthWrite:false,fog:false});
   const c=new THREE.Sprite(mat);c.position.set(cx*f+k*3,cy+k*1.4,cz*f+k*2);c.scale.set(sz*(k?.72:1),sz*(k?.32:.48),1);c.userData.phase=rnd()*TAU;c.userData.base=c.position.clone();scene.add(c);clouds.push(c);
  }
 }
 B.flush();
 const airportLabels=[];for(const a of airports){if(!a.major)continue;const l=label(a.name,2.15);l.position.set(a.x-(a.index===2?3:0),a.y+6.8,a.z-2.8);l.userData.airport=a.id;scene.add(l);airportLabels.push(l);}
 const sim=new Simulation(seed,size,airports);await sim.init();
 const soft=softTexture(),flightViews=new Map();const routeMat=new THREE.LineDashedMaterial({color:'#e5e9dc',transparent:true,opacity:.65,dashSize:.66,gapSize:.66});const hitTargets=[];
 for(const p of sim.planes){
  const model=planeModel(p.color,p.kind);model.scale.setScalar(1.22);scene.add(model);model.userData.planeId=p.id;model.traverse(o=>{o.userData.planeId=p.id;});hitTargets.push(model);
  const tag=label(p.id,1.52,'normal','plane');tag.userData.planeId=p.id;scene.add(tag);hitTargets.push(tag);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshBasicMaterial({map:soft,color:'#244f59',transparent:true,opacity:.24,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.11;scene.add(shadow);
  const route=new THREE.Line(new THREE.BufferGeometry(),routeMat.clone());scene.add(route);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(2.2,.045,5,64),new THREE.MeshBasicMaterial({color:'#ffe4a9',transparent:true,opacity:.95}));ring.rotation.x=Math.PI/2;scene.add(ring);
  const glow=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial({map:soft,color:'#ffbd79',transparent:true,opacity:.28,depthWrite:false,blending:THREE.AdditiveBlending}));glow.rotation.x=-Math.PI/2;scene.add(glow);
  const smoke=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:'#77736b',transparent:true,opacity:.34,depthWrite:false,roughness:1}),24);smoke.frustumCulled=false;scene.add(smoke);
  const fuelDrops=new THREE.InstancedMesh(new THREE.SphereGeometry(1,5,4),new THREE.MeshBasicMaterial({color:'#ffd98b',transparent:true,opacity:.62}),12);fuelDrops.frustumCulled=false;scene.add(fuelDrops);
  flightViews.set(p.id,{model,tag,shadow,route,ring,glow,smoke,fuelDrops,lastCurve:null,lastPhase:null,bubble:null,lastBubble:'',trail:[]});
 }
 const boats=[];for(let i=0;i<9;i++){const x=[-41,-38,-15,0,42,38,12,-31,7][i],z=[22,2,42,8,36,-6,-33,-29,50][i];if(airports.some(a=>Math.hypot(x-a.x,z-a.z)<a.r+1))continue;const model=boatModel(i%3===0?'#db8c6b':'#f4e8c7');model.position.set(x,.12,z);model.rotation.y=rnd()*TAU;scene.add(model);boats.push({model,x,z,phase:rnd()*TAU});}
 const pulses=[],links=[];sim.listeners.push(e=>{if(e.type==='mayday'||e.type==='fault'&&e.active){const p=sim.planes.find(p=>p.id===e.id);if(p){const g=new THREE.BufferGeometry().setFromPoints(Array.from({length:101},(_,i)=>V(Math.cos(i/100*TAU),0,Math.sin(i/100*TAU))));const m=new THREE.Line(g,new THREE.LineDashedMaterial({color:'#ffbc95',dashSize:.4,gapSize:.25,transparent:true,opacity:.8}));m.computeLineDistances();m.position.set(p.pos.x,.08,p.pos.z);scene.add(m);pulses.push({mesh:m,start:sim.time});}}if(e.type==='response'){const p=sim.planes.find(p=>p.id===e.id),other=sim.planes.find(p=>p.id===e.to);if(p&&other){const curve=new THREE.QuadraticBezierCurve3(p.pos.clone(),p.pos.clone().add(other.pos).multiplyScalar(.5).add(V(0,4,0)),other.pos.clone());const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)),new THREE.LineDashedMaterial({color:'#a9e2e5',transparent:true,opacity:.6,dashSize:.25,gapSize:.4}));line.computeLineDistances();scene.add(line);links.push({mesh:line,start:sim.time});}}});
 // A small bird flock above the northern cliffs, one batched dynamic mesh.
 const birdG=mergeGeometry([{geometry:new THREE.BoxGeometry(.48,.04,.085),matrix:matrix(V(-.18,0,0),V(1,1,1),V(0,0,-.3)),tint:'#4b6260'},{geometry:new THREE.BoxGeometry(.48,.04,.085),matrix:matrix(V(.18,0,0),V(1,1,1),V(0,0,.3)),tint:'#4b6260'}]);const birds=new THREE.InstancedMesh(birdG,new THREE.MeshBasicMaterial({vertexColors:true}),22);birds.frustumCulled=false;scene.add(birds);
 const pipeline=new THREE.RenderPipeline(renderer),scenePass=TSL.pass(scene,camera),image=scenePass.getTextureNode('output');
 const depth=scenePass.getTextureNode('depth');
 const pixel=TSL.uniform(new THREE.Vector2(1/width,1/height)),screen=TSL.screenUV;
 const focus=TSL.smoothstep(.27,.49,TSL.abs(screen.y.sub(.51))).mul(2.6);
 let blurred=image.sample(screen).mul(.40);
 for(const [dx,dy,w] of [[1,0,.12],[-1,0,.12],[0,1,.12],[0,-1,.12],[2,2,.03],[-2,-2,.03],[2,-2,.03],[-2,2,.03]])blurred=blurred.add(image.sample(screen.add(pixel.mul(TSL.vec2(dx,dy)).mul(focus).mul(1.5))).mul(w));
 const centerZ=TSL.perspectiveDepthToViewZ(depth.sample(screen).r,camera.near,camera.far).negate();let occlusion=TSL.float(0);
 for(const [dx,dy]of[[3,0],[-3,0],[0,3],[0,-3],[2,2],[-2,-2],[-2,2],[2,-2]]){
  const neighborZ=TSL.perspectiveDepthToViewZ(depth.sample(screen.add(pixel.mul(TSL.vec2(dx,dy)))).r,camera.near,camera.far).negate(),diff=centerZ.sub(neighborZ);
  occlusion=occlusion.add(TSL.smoothstep(.30,1.1,diff).mul(TSL.smoothstep(1.1,3.8,TSL.abs(diff)).oneMinus()).mul(.037));
 }
 const luminance=TSL.dot(blurred.rgb,TSL.vec3(.2126,.7152,.0722));
 const enriched=TSL.mix(TSL.vec3(luminance),blurred.rgb,1.07).mul(occlusion.oneMinus());
 const warmHaze=TSL.exp(screen.x.sub(.91).pow(2).div(-.19).add(screen.y.sub(.06).pow(2).div(-.075))).mul(.105);
 let lampGlow=TSL.vec3(0);
 for(const [dx,dy]of[[4,0],[-4,0],[0,4],[0,-4]])lampGlow=lampGlow.add(TSL.max(image.sample(screen.add(pixel.mul(TSL.vec2(dx,dy)))).rgb.sub(1.65),0).mul(.035));
 const vignette=TSL.smoothstep(.26,.78,TSL.length(screen.sub(.5).mul(TSL.vec2(1,.76)))).mul(.10);
 pipeline.outputNode=TSL.vec4(enriched.mul(TSL.vec3(1.045,1.005,.975)).mul(vignette.oneMinus()).add(TSL.vec3(1.0,.57,.20).mul(warmHaze)).add(lampGlow),1);
 const world={scene,camera,renderer,view,sun,sim,airports,flightViews,errors,quality,config,disposed:false,routesVisible:true,airportLabelsVisible:true,updateCamera,
  resize(w,h){width=w;height=h;pixel.value.set(1/w,1/h);world.hud?.resize(w,h);renderer.setSize(w,h,false);camera.aspect=w/h;updateCamera();},
  select(id){if(!sim.planes.some(p=>p.id===id))return;sim.selected=id;world.hud?.invalidate();},
  pick(nx,ny){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(nx,ny),camera);const hit=ray.intersectObjects(hitTargets,true).find(h=>h.object.userData.planeId);if(hit)return hit.object.userData.planeId;let best=null,ds=.06;for(const p of sim.planes){const pr=p.pos.clone().project(camera),d=Math.hypot((pr.x-nx)*width/height,pr.y-ny);if(d<ds){ds=d;best=p.id;}}return best;},
  async step(dt,awaitDecisions=true){await sim.step(dt,awaitDecisions);},
  updateVisual(){
   const t=sim.time;clock.value=t;for(const c of clouds){c.position.x=c.userData.base.x+Math.sin(t*.011+c.userData.phase)*1.8;c.position.y=c.userData.base.y+Math.sin(t*.035+c.userData.phase)*.35;}
   for(const p of sim.planes){const o=flightViews.get(p.id),selected=p.id===sim.selected,bad=sim.hasEmergency(p)||!!p.faults.radio,activeFault=FAULTS.find(f=>p.faults[f]),faultTint={engine:'#ffad89',radio:'#7acbff',radar:'#9ad5b2',fuel:'#f4cf77',hydraulics:'#c2a0ed'}[activeFault];
    o.model.position.copy(p.pos);o.model.position.y+=p.phase==='landed'?0:Math.sin(t*2+p.index)*.035;o.model.rotation.set(p.faults.engine?-.035:0,p.heading,p.bank+(p.faults.hydraulics?Math.sin(t*4)*.075:0));const prop=o.model.userData.prop;if(prop)prop.rotation.z=t*(p.faults.engine?17:54);
    o.tag.position.copy(p.pos).add(V(0,2.2,0));o.tag.visible=true;
    o.shadow.position.set(p.pos.x+p.pos.y*.37,-.11,p.pos.z+p.pos.y*.23);o.shadow.material.opacity=p.phase==='landed'?0:.2;
    const routeChanged=o.lastCurve!==p.curve||o.lastPhase!==p.phase;
    if(routeChanged&&p.curve){const old=o.route.geometry;o.route.geometry=new THREE.BufferGeometry().setFromPoints(p.curve.getPoints(70).map(v=>V(v.x,.12,v.z)));o.route.computeLineDistances();old.dispose();o.lastCurve=p.curve;o.lastPhase=p.phase;}
    o.route.visible=world.routesVisible&&p.phase!=='landed';o.route.material.color.set(bad?'#ffb794':p.reaction!=='maintain'?'#a3dfea':'#e3e8dc');o.route.material.opacity=selected?.88:bad?.8:.40;
    o.ring.visible=selected||!!activeFault||bad;o.ring.position.copy(p.pos);o.ring.position.y-=.55;o.ring.material.color.set(faultTint||(bad?'#ffbb86':'#ffe1a3'));o.ring.material.opacity=bad?.6+.3*Math.sin(t*4):.84;o.ring.scale.setScalar(bad?1.15+Math.sin(t*2.7)*.09:1.05);
    o.glow.visible=selected||!!activeFault||bad;o.glow.position.copy(o.ring.position);o.glow.material.opacity=bad?.46:.16;
    if(p.bubble&&t<p.bubble.until){if(o.lastBubble!==p.bubble.text){if(o.bubble){scene.remove(o.bubble);o.bubble.material.map.dispose();o.bubble.material.dispose();}o.bubble=label(p.bubble.text,1.40,p.bubble.tone,'plane');scene.add(o.bubble);o.lastBubble=p.bubble.text;}o.bubble.position.copy(p.pos).add(V(0,4.05,0));o.bubble.visible=true;}else if(o.bubble)o.bubble.visible=false;
    o.smoke.visible=!!p.faults.engine&&p.phase!=='landed';o.fuelDrops.visible=!!p.faults.fuel&&p.phase!=='landed';
    if(o.smoke.visible)for(let j=0;j<24;j++){const age=((t*3+j)%24)/24,back=age*8,s=.16+age*.64;const v=V(p.pos.x-Math.sin(p.heading)*back+Math.sin(j*14)*age*.7,p.pos.y+age*.65,p.pos.z-Math.cos(p.heading)*back+Math.cos(j*7)*age*.7);o.smoke.setMatrixAt(j,matrix(v,V(s,s*.8,s),V(age*3,j,0)));}o.smoke.instanceMatrix.needsUpdate=o.smoke.visible;
    if(o.fuelDrops.visible)for(let j=0;j<12;j++){const age=((t*4+j)%12)/12,s=.07;const v=V(p.pos.x-Math.sin(p.heading)*age*5,p.pos.y-age*4,p.pos.z-Math.cos(p.heading)*age*5);o.fuelDrops.setMatrixAt(j,matrix(v,V(s,s*2,s)));}o.fuelDrops.instanceMatrix.needsUpdate=o.fuelDrops.visible;
   }
   for(let i=pulses.length-1;i>=0;i--){const p=pulses[i],age=t-p.start;p.mesh.scale.setScalar(1+age*8);p.mesh.material.opacity=clamp(1-age/6)*.8;if(age>6){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();pulses.splice(i,1);}}
   for(let i=links.length-1;i>=0;i--){const l=links[i],age=t-l.start;l.mesh.material.opacity=clamp(1-age/5)*.65;if(age>5){scene.remove(l.mesh);l.mesh.geometry.dispose();l.mesh.material.dispose();links.splice(i,1);}}
   for(const b of boats){b.model.position.x=b.x+Math.sin(t*.017+b.phase)*1.3;b.model.position.z=b.z+Math.cos(t*.017+b.phase)*1.3;b.model.rotation.z=Math.sin(t*1.1+b.phase)*.025;}
   for(let i=0;i<22;i++){const a=t*.12+i*.14,x=-24+Math.cos(a)*9+(i%4)*.6,z=-21+Math.sin(a)*4;birds.setMatrixAt(i,matrix(V(x,12+Math.sin(a*1.3)*.6+(i%3)*.23,z),V(.8,1,.8),V(0,-a+Math.PI/2,Math.sin(t*5+i)*.12)));}birds.instanceMatrix.needsUpdate=true;
   for(const l of airportLabels)l.visible=world.airportLabelsVisible;
  },
  attachHUD(hud){
   world.hud=hud;const uiPass=TSL.pass(hud.scene,hud.camera,{depthBuffer:false}),ui=uiPass.getTextureNode('output');
   const sceneOutput=pipeline.outputNode,visible=TSL.uniform(1);world.uiVisible=visible;world.uiPass=uiPass;
   const displayed=TSL.renderOutput(sceneOutput,THREE.ACESFilmicToneMapping,THREE.SRGBColorSpace);
   const ua=ui.a.mul(visible),unpremult=TSL.vec4(ui.rgb.div(TSL.max(ui.a,.0001)),1);
   const uiOutput=TSL.renderOutput(unpremult,THREE.NoToneMapping,THREE.SRGBColorSpace);
   pipeline.outputNode=TSL.vec4(displayed.rgb.mul(ua.oneMinus()).add(uiOutput.rgb.mul(ua)),1);
   pipeline.outputColorTransform=false;pipeline.needsUpdate=true;
  },
  render(){world.updateVisual();if(world.hud){world.uiVisible.value=world.hud.hidden?0:1;if(world.hud.dirty||sim.time-world.hud.lastPaint>.12)world.hud.draw();}pipeline.render();},
  diagnostics(){return {version:VERSION,seed,size,time:sim.time,threeRevision:THREE.REVISION,backend:renderer.backend.isWebGPUBackend?'WebGPU':'WebGL2',drawCalls:renderer.info.render.drawCalls,renderCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,planes:sim.planes.length,airports:airports.length,errors:[...errors],viewport:{width,height}};},
  dispose(){world.disposed=true;sim.dispose();world.hud?.dispose();world.uiPass?.dispose();pipeline.dispose();scenePass.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m.map)textures.add(m.map);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const tx of textures)tx.dispose();B.dispose();env.dispose();if(!givenRenderer)renderer.dispose();}
 };
 world.render();sun.shadow.autoUpdate=false;return world;
}

function pine(B,x,y,z,s,r){B.add('cylinder','#7d7257',x,y+s*.38,z,s*.12,s*.78,s*.12);const greens=['#355846','#42664b','#55774d','#627f4e','#345747'];for(let k=0;k<3;k++)B.add('cone',greens[Math.floor(r()*greens.length)],x,y+s*(.75+k*.42),z,s*(.62-k*.13),s*(1.35-k*.13),s*(.62-k*.13),0,k*.55+r()*.25);B.add('disc','#395b47',x,y+.035,z,s*.74,s*.66,1,-Math.PI/2,0,0,'shadow');}
function broadTree(B,x,y,z,s,r){B.add('cylinder','#9a825b',x,y+s*.65,z,.10*s,1.3*s,.10*s);for(let k=0;k<3;k++)B.add('rock',choose(r,['#7f9c66','#96ac6d','#a8b977']),x+(k-1)*s*.35,y+s*(1.25+(k%2)*.27),z+(r()-.5)*s*.4,s*.62,s*.74,s*.61,0,r()*6);B.add('disc','#5b734d',x,y+.03,z,s,s*.82,1,-Math.PI/2,0,0,'shadow');}
function palm(B,x,y,z,s,r){for(let k=0;k<4;k++)B.add('taper','#ac9063',x+Math.sin(k*.26)*s*.25,y+s*(.3+k*.48),z,s*.1,s*.54,s*.1,0,0,-.08);const topy=y+s*2.0;for(let k=0;k<6;k++)B.add('leaf',choose(r,['#6e935d','#85a767','#a0b56f']),x+s*.23,topy,z,s*.72,s*.8,s*.83,.2,k/6*TAU,0);B.add('rock','#b79962',x+s*.21,topy,z,s*.18,s*.2,s*.18);}
function house(B,x,y,z,s,ry,r,tropical=false){
 const wall=choose(r,['#f5e5c8','#f0dec4','#e9dcc6','#f6e6ce']),roof=choose(r,tropical?['#e0936c','#e7a076','#ce846a']:['#c3836a','#ce9375','#8e92a0']);
 const place=(type,c,dx,dy,dz,sx,sy,sz,rx=0,rr=0,rz=0,mat='solid')=>B.add(type,c,x+dx*Math.cos(ry)+dz*Math.sin(ry),y+dy,z-dx*Math.sin(ry)+dz*Math.cos(ry),sx*s,sy*s,sz*s,rx,ry+rr,rz,mat);
 place('box',wall,0,.62*s,0,1.25,1.2,1.35);place('roof',roof,0,1.22*s,0,1.48,.85,1.58);place('box','#5a7e7b',-.28*s,.8*s,.687*s,.26,.35,.035,0,0,0,'gloss');place('box','#5a7e7b',.3*s,.8*s,.687*s,.26,.35,.035,0,0,0,'gloss');place('box','#a58c63',0,.28*s,.692*s,.24,.52,.04);place('box','#d4c5a2',.32*s,1.7*s,-.34*s,.23,.62,.26);B.add('disc','#6d7557',x,y+.025,z,1.05*s,.9*s,1,-Math.PI/2,ry,0,'shadow');
}
function tower(B,x,y,z,s=1){B.add('taper','#e4d9bd',x,y+1.6*s,z,.52*s,3.2*s,.52*s);B.add('cylinder','#d7936e',x,y+2.7*s,z,.57*s,.23*s,.57*s);B.add('cylinder','#abc4bd',x,y+3.38*s,z,.78*s,.66*s,.78*s,0,0,0,'gloss');B.add('cylinder','#e9dcc0',x,y+3.05*s,z,.85*s,.17*s,.85*s);B.add('cone','#c88f69',x,y+3.98*s,z,.87*s,.65*s,.87*s);B.add('cylinder','#647f7e',x,y+4.64*s,z,.025,1.25*s,.025);B.add('sphere','#ffe1a0',x,y+4.2*s,z,.12*s,.12*s,.12*s,0,0,0,'light');}
function lighthouse(B,x,y,z,s=1){for(let k=0;k<4;k++)B.add('taper',k%2?'#d9886c':'#f1e7cc',x,y+.46*s+k*.64*s,z,s*(.55-k*.065),s*.75,s*(.55-k*.065));B.add('cylinder','#506e72',x,y+2.84*s,z,.50*s,.15*s,.50*s);B.add('cylinder','#ffe7b0',x,y+3.18*s,z,.32*s,.56*s,.32*s,0,0,0,'light');B.add('cone','#c9765d',x,y+3.63*s,z,.53*s,.52*s,.53*s);}
function dressIsland(a,B,r){
 const major=a.major,tropical=a.index===2||(!a.major&&a.index%4===0);const ax=a.x,az=a.z,yy=a.y+.06;
 const runway=(angle,length,width)=>{
  const put=(type,c,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0,mat='solid')=>B.add(type,c,ax+x*Math.cos(angle)+z*Math.sin(angle),y,az+(major?a.r*.13:0)-x*Math.sin(angle)+z*Math.cos(angle),sx,sy,sz,rx,angle+ry,rz,mat);
  put('box','#cabd94',0,yy-.005,0,width+.38,.10,length+.35);put('box',major?'#4c525e':'#687477',0,yy+.062,0,width,.075,length);
  for(const side of[-1,1])put('box','#f1ddae',side*(width*.5-.08),yy+.11,0,.045,.012,length-.30);
  for(let z=-length/2+.9;z<length/2-.6;z+=1.1)put('box','#f6ebd1',0,yy+.114,z,.07,.017,.58);
  for(const sign of[-1,1]){
   for(let j=-2;j<=2;j++)put('box','#f3e8c7',j*width*.12,yy+.118,sign*(length/2-.5),width*.065,.02,.57);
   put('box','#fbebc5',0,yy+.118,sign*(length/2-1.18),width*.5,.02,.07);
  }
  for(let z=-length/2;z<=length/2;z+=major?1.7:1.55)for(const side of[-1,1]){put('cylinder','#868a70',side*(width/2+.19),yy+.15,z,.065,.11,.065);put('sphere','#ffe6a3',side*(width/2+.19),yy+.225,z,.095,.082,.095,0,0,0,'light');}
 };
 if(major){runway(Math.PI/4,a.r*1.36,1.65);runway(-Math.PI/4,a.r*1.36,1.65);}else runway(a.angle,a.r*1.30,1.14);
 if(major){
  B.add('box','#bfbd9d',ax+5.6,yy+.025,az,4.9,.06,3.6);B.add('box','#e7dcc0',ax+6.0,yy+.65,az-.35,4.0,1.25,1.44);B.add('box','#85989b',ax+6,yy+1.34,az-.35,4.35,.20,1.7);
  for(let j=0;j<8;j++){B.add('box','#709392',ax+4.37+j*.47,yy+.78,az+.39,.30,.53,.035,0,0,0,'gloss');B.add('box','#e5d5b2',ax+4.33+j*.48,yy+.45,az+.49,.08,.92,.20);}
  tower(B,ax+7.8,yy,az-3.1,1.08);
  B.add('box','#b6b0a1',ax-5.2,yy+.045,az+.9,3.5,.05,2.3);
  B.add('box','#f3e4bb',ax-5.2,yy+.30,az+1.0,.28,.25,1.15);
  B.add('box','#efbb64',ax-5.2,yy+.39,az+1.03,1.55,.08,.25);
  B.add('box','#efbb64',ax-5.2,yy+.46,az+.51,.08,.30,.3);
  const hangarX=ax-5.2,hangarZ=az-1.4;
  B.add('box','#f1e2c7',hangarX,yy+.65,hangarZ,2.4,1.3,1.9);
  B.add('cylinder','#94a2b4',hangarX,yy+1.28,hangarZ,1.26,1.97,.55,Math.PI/2,0,0);
  B.add('box','#536f7c',hangarX,yy+.51,hangarZ+1.0,1.7,.99,.05,0,0,0,'gloss');
  house(B,ax-5.3,yy,az+.2,.93,Math.PI/2,r,tropical);house(B,ax-7.2,yy,az+1.8,.75,Math.PI/2,r,tropical);
  B.add('box','#8c9b83',ax+4.7,yy+.18,az+1.1,.52,.31,.9);B.add('box','#eee1bb',ax+4.8,yy+.42,az+1.22,.4,.25,.43);
 }else{const angle=a.angle,x=ax+Math.cos(angle)*2.0,z=az-Math.sin(angle)*2;house(B,x,yy,z,.78,a.angle,r,tropical);}
 // Windsocks: a useful moving-world cue even at the default play distance.
 const wx=ax-a.r*.42,wz=az+a.r*.33,wy=ground(a,wx-ax,wz-az)+.1;
 B.add('cylinder','#e8deba',wx,wy+1.05,wz,.045,2.1,.045);for(let k=0;k<4;k++)B.add('cylinder',k%2?'#f6e9c9':'#da8d68',wx+.18+k*.23,wy+2.05-k*.04,wz,.18-k*.025,.25,.18-k*.025,0,0,Math.PI/2);
 // Back ridges are independently sculpted meshes, not circular heightfield cones.
 if(major){
  const hills=a.index===2?[[-.49,-.41,.18,2.8],[.36,-.49,.24,3.8]]:a.index===1?[[-.46,-.45,.22,3.9],[-.10,-.64,.30,4.6],[.46,-.53,.19,3.7]]:[[-.49,-.54,.20,4.9],[.08,-.64,.28,6.8],[.54,-.47,.18,4.1]];
  for(const [px,pz,rad,ht]of hills)B.custom.push({geometry:mountainGeometry(ax+px*a.r,a.y-.12,az+pz*a.r,a.r*rad,ht,a.index===0&&ht>5.5,r)});
 }
 // Faceted rock shoulders form silhouettes behind the flat airfield.

 const treeCount=major?156:33;
 for(let i=0,attempts=0;i<treeCount&&attempts<treeCount*10;attempts++){
  const theta=r()*TAU,rr=Math.sqrt(r())*.84;const x=Math.cos(theta)*coastline(a,theta)*rr,z=Math.sin(theta)*coastline(a,theta)*rr*.86;
  if(inRunway(a,x,z,major?2.35:1.35)||major&&(Math.abs(x-6)<3.7&&Math.abs(z)<4.8)||!major&&(Math.abs(x-2)<1.7&&Math.abs(z)<1.8))continue;
  const h=ground(a,x,z);if(h<.8||h>a.y+4||(major&&z<-a.r*.35&&Math.abs(x)<a.r*.72))continue;const s=major?.64+r()*.79:.46+r()*.65;
  if(tropical&&r()>.82&&z>a.r*.25)palm(B,ax+x,h,az+z,s,r);else if(r()>.09)pine(B,ax+x,h,az+z,s,r);else broadTree(B,ax+x,h,az+z,s,r);i++;
 }
 for(let i=0;i<(major?42:18);i++){const theta=r()*TAU,rr=coastline(a,theta)*(.9+r()*.10),x=Math.cos(theta)*rr,z=Math.sin(theta)*rr*.86;const h=ground(a,x,z);const s=major?.4+r()*.9:.3+r()*.52;B.add('rock',choose(r,['#a5a697','#bdb7a0','#c6ba9f','#999e92']),ax+x,h+s*.2,az+z,s,s*(.6+r()*.9),s*.8,r()*.4,r()*TAU,r()*.25);}
 if(major){
  for(let i=0;i<8;i++){const theta=.3+i*.19,x=Math.cos(theta)*a.r*.78,z=Math.sin(theta)*a.r*.71;if(inRunway(a,x,z,1.5))continue;house(B,ax+x,ground(a,x,z)+.04,az+z,.56+r()*.15,-.4+i*.13,r,true);}
  const lx=ax+a.r*.64,lz=az+a.r*.44;lighthouse(B,lx,ground(a,lx-ax,lz-az),lz,.95);
  const dx=ax+a.r*.39,dz=az+a.r*.84;B.add('box','#b59c72',dx,.68,dz,3.3,.18,1.1);B.add('box','#b59c72',dx+1.1,.68,dz+1.4,1.05,.18,3.8);house(B,dx+.6,.80,dz+.1,.68,0,r,true);for(let k=0;k<4;k++){B.add('cylinder','#867c61',dx-.9+k*.8,.15,dz-.3,.10,1.5,.10);B.add('cylinder','#867c61',dx+1.5,.15,dz+k*.7,.10,1.5,.10);}
 }else if(a.index%3===0){const x=-a.r*.52,z=-a.r*.22;lighthouse(B,ax+x,ground(a,x,z),az+z,.66);}
 // Rock stacks expose the raised shoreline; low coves remain sandy.
 for(let i=0;i<(major?30:12);i++){
  const theta=i/(major?30:12)*TAU+(r()-.5)*.15;
  if(Math.sin(theta*3+a.phase)>.38)continue;
  const rr=coastline(a,theta)*(.85+r()*.10),x=Math.cos(theta)*rr,z=Math.sin(theta)*rr*.86;
  const s=(major?1.0:.60)+r()*(major?1.0:.5),h=ground(a,x,z);
  B.add('rock',choose(r,['#b3a9a6','#bcaeaa','#c9b9aa','#a89da3']),ax+x,h*.32+s*.42,az+z,s*.85,s*(major?1.4:1.1),s*.78,r()*.35,r()*TAU,r()*.20);
 }
 // Small warm flecks: wildflower patches and sunlit shrubs, not confetti everywhere.
 for(let i=0;i<(major?24:7);i++){const theta=r()*TAU,rad=a.r*(.65+r()*.16),x=Math.cos(theta)*rad,z=Math.sin(theta)*rad*.84;if(inRunway(a,x,z,1.5))continue;const y=ground(a,x,z);for(let k=0;k<3;k++)B.add('sphere',choose(r,['#e8c98b','#dab494','#bac58b']),ax+x+(r()-.5)*.6,y+.16,az+z+(r()-.5)*.6,.13,.17,.13);}
}
function planeModel(tint,kind){
 const jet=kind==='jet',parts=[],add=(geometry,col,x=0,y=0,z=0,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0)=>parts.push({geometry,tint:col,matrix:matrix(V(x,y,z),V(sx,sy,sz),V(rx,ry,rz))});
 const body=new THREE.SphereGeometry(1,12,8);add(body,jet?'#f5edda':tint,0,0,0,.39,.35,jet?2.05:1.55);
 const wingShape=jet?[[-2.65,-.45],[-.42,.64],[.42,.64],[2.65,-.45],[2.55,-.8],[.40,-.25],[-.4,-.25],[-2.55,-.8]]:[[-2.03,-.2],[-2.03,.42],[2.03,.42],[2.03,-.2]];
 add(polygonPrism(wingShape,.115),jet?'#ebe7d9':tint,0,.12,.05);
 add(polygonPrism([[-.96,-.25],[-.96,.05],[0,.36],[.96,.05],[.96,-.25]],.08),jet?'#ef8875':tint,0,.10,jet?-1.68:-1.26);
 add(new THREE.BoxGeometry(.12,.82,.76),jet?'#ee8d78':tint,0,.46,jet?-1.48:-1.16,1,1,1,.18);
 add(new THREE.SphereGeometry(1,8,6),'#456c78',0,.245,jet?.82:.50,.32,.19,jet?.50:.38);
 if(jet){for(const x of[-.94,.94]){add(new THREE.CylinderGeometry(.20,.22,.67,8),'#efe7d5',x,-.14,.22,1,1,1,Math.PI/2);add(new THREE.CircleGeometry(.16,8),'#4b626a',x,-.14,.57);}for(const side of[-1,1])for(let j=0;j<8;j++)add(new THREE.BoxGeometry(.035,.11,.10),'#567980',side*.36,.075,-.92+j*.22);}
 else{for(const x of[-.26,.26]){add(new THREE.BoxGeometry(.045,.40,.045),'#7e8378',x,-.4,.24);add(new THREE.SphereGeometry(.13,6,5),'#535f5e',x,-.60,.24,1,1,.65);}}
 add(new THREE.SphereGeometry(.065,6,4),'#da7566',jet?-2.58:-2.00,.17,-.2);add(new THREE.SphereGeometry(.065,6,4),'#88bd9a',jet?2.58:2.00,.17,-.2);
 const geometry=mergeGeometry(parts);const group=new THREE.Group();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.04}));group.add(mesh);mesh.castShadow=false;
 if(!jet){const prop=new THREE.Group();prop.position.z=1.58;const mat=new THREE.MeshBasicMaterial({color:'#64716b',transparent:true,opacity:.52});for(let i=0;i<2;i++){const blade=new THREE.Mesh(new THREE.BoxGeometry(.075,.98,.032),mat);blade.rotation.z=i*Math.PI/2;prop.add(blade);}group.add(prop);group.userData.prop=prop;}
 for(const p of parts)if(p.geometry!==body)p.geometry.dispose();body.dispose();return group;
}
function boatModel(tint){const group=new THREE.Group(),parts=[];parts.push({geometry:new THREE.SphereGeometry(1,8,5),matrix:matrix(V(),V(.33,.15,.93)),tint:'#997d60'});parts.push({geometry:new THREE.CylinderGeometry(.026,.026,2,6),matrix:matrix(V(0,.95,0)),tint:'#b0996e'});const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,.25,.02,0,1.95,0,0,.25,.86,0,.25,-.04,0,1.62,-.03,0,.25,-.68],3));g.computeVertexNormals();parts.push({geometry:g,tint});const mesh=new THREE.Mesh(mergeGeometry(parts),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.87,side:THREE.DoubleSide}));group.add(mesh);for(const p of parts)p.geometry.dispose();const wake=new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(-.55,-.015,-1.55),V(0,-.015,-.45),V(.55,-.015,-1.55)]),new THREE.LineBasicMaterial({color:'#dce9d5',transparent:true,opacity:.52}));group.add(wake);return group;}
function mountainGeometry(x,y,z,radius,height,snow,r){
 const N=10,levels=[0,.28,.62,.84,1],points=[],offset=r()*TAU;
 const rim=Array.from({length:N},()=>.80+r()*.38);
 for(let j=0;j<levels.length;j++)for(let k=0;k<N;k++){const h=levels[j],theta=k/N*TAU+offset,rr=radius*rim[k]*(1-h)**.76;points.push(V(x+Math.cos(theta)*rr+h*radius*.26,y+h*height+(j>0&&j<4?(r()-.5)*height*.12:0),z+Math.sin(theta)*rr*.89-h*radius*.11));}
 const pos=[],cols=[];for(let j=0;j<levels.length-1;j++)for(let k=0;k<N;k++){const q=(k+1)%N;for(const ids of [[j*N+k,(j+1)*N+q,(j+1)*N+k],[j*N+k,j*N+q,(j+1)*N+q]]){const c=color(snow&&j>=2?choose(r,['#e5dfc9','#ece5d2','#d7d5c5']):choose(r,['#a59e8c','#b4a891','#c3b49c','#b2ab98','#98998c']));for(const id of [...ids].reverse()){const v=points[id];pos.push(v.x,v.y,v.z);cols.push(c.r,c.g,c.b);}}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));g.computeVertexNormals();return g;
}
