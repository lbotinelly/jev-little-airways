import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {FONT} from './font-atlas.mjs';

// The HUD is actual Three.js geometry, not a screenshot or a DOM surrogate.
// Browser and native capture run precisely the same layout, drawing and hit testing.
const palette={panel:'#2b3548',inner:'#232e40',border:'#8c9caa',text:'#f8f1df',muted:'#b3c3c8',dim:'#7f969f',yellow:'#f2d286',coral:'#f29882',blue:'#7ec7df',mint:'#9ed4ab',purple:'#beaddb'};
const icons={engine:'engine',radio:'radio',radar:'radar',fuel:'drop',hydraulics:'wrench'};
const fullFault={engine:'Engine',radio:'Radio',radar:'Radar',fuel:'Fuel leak',hydraulics:'Hydraulics'};
const faults=['engine','radio','radar','fuel','hydraulics'];
const colors=['#f29882','#7ec7df','#9ed4ab','#f2d286','#beaddb'];
const minmax=(x,a,b)=>Math.max(a,Math.min(b,x));
const escapeText=s=>String(s).replace(/[\u2013\u2014]/g,'-').replace(/\u2022/g,' / ').replace(/\u2192/g,' > ').replace(/\u00b7/g,' / ');
const rgba=(hex,alpha=1)=>{const c=new THREE.Color(hex);return [c.r,c.g,c.b,alpha];};
function fontTexture(){const bytes=Uint8Array.from(atob(FONT.data),c=>c.charCodeAt(0)),w=FONT.w*95,h=FONT.h,data=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((h-1-y)*w+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=bytes[y*w+x];}const texture=new THREE.DataTexture(data,w,h);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;}
class Paint{
 constructor(width,height){this.width=width;this.height=height;this.positions=[];this.cols=[];this.alphas=[];this.textPositions=[];this.textCols=[];this.uvs=[];}
 tri(points,tint,alpha=1){const c=rgba(tint);for(const [x,y]of points){this.positions.push(x,this.height-y,0);this.cols.push(c[0],c[1],c[2]);this.alphas.push(alpha);}}
 poly(points,tint,alpha=1){for(let i=1;i<points.length-1;i++)this.tri([points[0],points[i],points[i+1]],tint,alpha);}
 rect(x,y,w,h,tint,alpha=1,r=0){if(w<=0||h<=0)return;r=Math.min(r,w/2,h/2);if(!r)return this.poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],tint,alpha);const points=[];for(const [cx,cy,start]of[[x+r,y+r,Math.PI],[x+w-r,y+r,Math.PI*1.5],[x+w-r,y+h-r,0],[x+r,y+h-r,Math.PI/2]])for(let j=0;j<=6;j++){const a=start+j/6*Math.PI/2;points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}this.poly(points,tint,alpha);}
 line(x1,y1,x2,y2,tint,width=1,alpha=1){const d=Math.hypot(x2-x1,y2-y1)||1,dx=-(y2-y1)/d*width/2,dy=(x2-x1)/d*width/2;this.poly([[x1+dx,y1+dy],[x2+dx,y2+dy],[x2-dx,y2-dy],[x1-dx,y1-dy]],tint,alpha);}
 ring(cx,cy,r,tint,width=1,alpha=1,start=0,end=Math.PI*2){for(let i=0;i<42;i++){const a=start+(end-start)*i/42,b=start+(end-start)*(i+1)/42;this.line(cx+Math.cos(a)*r,cy+Math.sin(a)*r,cx+Math.cos(b)*r,cy+Math.sin(b)*r,tint,width,alpha);}}
 circle(cx,cy,r,tint,alpha=1){const points=[];for(let j=0;j<32;j++){const a=j/32*Math.PI*2;points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}this.poly(points,tint,alpha);}
 measure(text,size=14){return [...escapeText(text)].reduce((n,c)=>n+(FONT.widths[minmax(c.charCodeAt(0)-32,0,94)]+.6)*size/24,0);}
 text(text,x,y,size=14,tint=palette.text,align='left',maxWidth=Infinity){text=escapeText(text);while(this.measure(text,size)>maxWidth&&text.length>1)text=text.slice(0,-4)+'...';if(align==='right')x-=this.measure(text,size);if(align==='center')x-=this.measure(text,size)/2;const c=rgba(tint),scale=size/24,h=FONT.h*scale;for(const ch of text){const idx=minmax(ch.charCodeAt(0)-32,0,94),w=FONT.w*scale,u0=idx/95,u1=(idx+1)/95,y0=this.height-y;for(const [px,py,u,v]of[[x,y0,u0,1],[x+w,y0,u1,1],[x+w,y0-h,u1,0],[x,y0,u0,1],[x+w,y0-h,u1,0],[x,y0-h,u0,0]]){this.textPositions.push(px,py,1);this.textCols.push(c[0],c[1],c[2]);this.uvs.push(u,v);}x+=(FONT.widths[idx]+.6)*scale;}}
 wrap(text,x,y,maxWidth,size=13,tint=palette.muted,lineHeight=20,maxLines=3){const words=escapeText(text).split(' ');let line='',row=0;for(let i=0;i<words.length;i++){const test=line?line+' '+words[i]:words[i];if(this.measure(test,size)>maxWidth&&line){this.text(line,x,y+row*lineHeight,size,tint);line=words[i];row++;if(row>=maxLines)return y+row*lineHeight;}else line=test;}if(line)this.text(line,x,y+row*lineHeight,size,tint,'left',maxWidth);return y+(row+1)*lineHeight;}
 icon(name,x,y,s,tint=palette.text){const L=(a,b,c,d,w=1.5)=>this.line(x+a*s,y+b*s,x+c*s,y+d*s,tint,w);const R=(a,b,w,h)=>this.rect(x+a*s,y+b*s,w*s,h*s,tint,1,1);const C=(a,b,r)=>this.ring(x+a*s,y+b*s,r*s,tint,1.5);switch(name){
 case 'plane':this.poly([[x,y-s*.8],[x+s*.13,y-s*.12],[x+s*.85,y+s*.2],[x+s*.85,y+s*.37],[x+s*.13,y+s*.15],[x+s*.1,y+s*.65],[x+s*.36,y+s*.83],[x+s*.3,y+s*.95],[x,y+s*.82],[x-s*.3,y+s*.95],[x-s*.36,y+s*.83],[x-s*.1,y+s*.65],[x-s*.13,y+s*.15],[x-s*.85,y+s*.37],[x-s*.85,y+s*.2],[x-s*.13,y-s*.12]],tint);break;
 case 'globe':C(0,0,.85);this.ring(x,y,s*.85,tint,1.3,1,-Math.PI/2,Math.PI/2);L(-.76,-.32,.76,-.32,1);L(-.76,.32,.76,.32,1);this.ring(x,y,s*.38,tint,1);L(0,-.85,0,.85,1);break;
 case 'dice':this.rect(x-s*.65,y-s*.65,s*1.3,s*1.3,tint,1,3);for(const [a,b]of[[-.35,-.35],[.35,.35],[0,0],[.35,-.35],[-.35,.35]])this.circle(x+a*s,y+b*s,s*.09,palette.panel);break;
 case 'engine':R(-.63,-.36,1.10,.75);R(-.32,-.58,.54,.23);R(.52,-.16,.27,.38);R(-.85,-.13,.15,.27);R(-.42,.30,.2,.25);R(.2,.30,.2,.25);break;
 case 'radio':this.circle(x,y-s*.08,s*.14,tint);L(0,.04,0,.65,2);for(const r of [.45,.75]){this.ring(x,y-s*.12,s*r,tint,1.7,1,-.8,.8);this.ring(x,y-s*.12,s*r,tint,1.7,1,Math.PI-.8,Math.PI+.8);}break;
 case 'radar':C(0,0,.80);C(0,0,.50);L(0,0,.55,-.52,2);this.circle(x-s*.3,y+s*.2,s*.085,tint);this.circle(x+s*.25,y+s*.35,s*.075,tint);break;
 case 'drop':this.poly([[x,y-s*.85],[x+s*.46,y],[x+s*.45,y+s*.37],[x+s*.23,y+s*.65],[x-s*.2,y+s*.65],[x-s*.45,y+s*.36],[x-s*.45,y]],tint);break;
 case 'wrench':L(-.5,.62,.40,-.38,5);this.ring(x+s*.42,y-s*.40,s*.35,tint,3.5,1,.5,Math.PI*1.5);C(-.5,.62,.12);break;
 case 'sun':C(0,0,.35);for(let i=0;i<8;i++){const a=i/8*Math.PI*2;L(Math.cos(a)*.59,Math.sin(a)*.59,Math.cos(a)*.86,Math.sin(a)*.86);}break;
 case 'play':this.poly([[x-s*.35,y-s*.6],[x+s*.6,y],[x-s*.35,y+s*.6]],tint);break;
 case 'pause':R(-.42,-.6,.25,1.2);R(.17,-.6,.25,1.2);break;
 case 'close':L(-.5,-.5,.5,.5);L(.5,-.5,-.5,.5);break;
 case 'chevron':L(-.3,-.5,.3,0);L(.3,0,-.3,.5);break;
 case 'check':L(-.6,0,-.15,.45,2);L(-.15,.45,.6,-.45,2);break;
 case 'comms':this.rect(x-s*.85,y-s*.58,s*1.7,s*1.17,tint,1,4);this.poly([[x-s*.48,y+s*.4],[x-s*.48,y+s*.93],[x+s*.03,y+s*.4]],tint);for(const a of[-.43,0,.43])this.circle(x+a*s,y,s*.09,palette.panel);break;
 case 'mountain':this.poly([[x-s*.8,y+s*.55],[x-s*.2,y-s*.65],[x+s*.4,y+s*.55]],tint);this.poly([[x-s*.15,y+s*.55],[x+s*.35,y-s*.22],[x+s*.86,y+s*.55]],tint);break;
 case 'speed':C(0,0,.77);L(0,0,.48,-.4,1.7);this.circle(x,y,s*.1,tint);break;
 case 'home':this.poly([[x-s*.7,y],[x,y-s*.6],[x+s*.7,y]],tint);R(-.5,-.02,1,.65);break;
 case 'info':C(0,0,.77);this.circle(x,y-s*.35,s*.08,tint);L(0,-.04,0,.42,2);break;
 case 'spark':for(let i=0;i<4;i++){const a=i*Math.PI/4;L(Math.cos(a)*-.6,Math.sin(a)*-.6,Math.cos(a)*.6,Math.sin(a)*.6,1.4);}break;
 }}
 geometries(){const cards=new THREE.BufferGeometry();cards.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));cards.setAttribute('color',new THREE.Float32BufferAttribute(this.cols,3));cards.setAttribute('opacityValue',new THREE.Float32BufferAttribute(this.alphas,1));const text=new THREE.BufferGeometry();text.setAttribute('position',new THREE.Float32BufferAttribute(this.textPositions,3));text.setAttribute('color',new THREE.Float32BufferAttribute(this.textCols,3));text.setAttribute('uv',new THREE.Float32BufferAttribute(this.uvs,2));return {cards,text};}
}
export function createHUD(world,width,height,actions={}){
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(0,width,height,0,-5,5);camera.position.z=2;
 const atlas=fontTexture(),cardsMat=new THREE.MeshBasicNodeMaterial({vertexColors:true,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});cardsMat.opacityNode=TSL.attribute('opacityValue','float');
 const textMat=new THREE.MeshBasicMaterial({map:atlas,vertexColors:true,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
 const cards=new THREE.Mesh(new THREE.BufferGeometry(),cardsMat),textMesh=new THREE.Mesh(new THREE.BufferGeometry(),textMat);cards.frustumCulled=textMesh.frustumCulled=false;cards.renderOrder=100;textMesh.renderOrder=101;scene.add(cards,textMesh);
 const hud={world,scene,camera,width,height,actions,regions:[],hover:null,open:'',history:false,tab:'route',hidden:false,hint:true,fps:null,frameMs:null,scale:1,lastPaint:-100,dirty:true,busy:false,
 resize(w,h){this.width=w;this.height=h;camera.right=w;camera.top=h;camera.updateProjectionMatrix();this.dirty=true;},
 invalidate(){this.dirty=true;},
 hit(x,y){x/=this.scale;y/=this.scale;return [...this.regions].reverse().find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||null;},
 pointer(x,y){const r=this.hit(x,y),key=r?.id||null;if(this.hover!==key){this.hover=key;this.dirty=true;}return !!r;},
 click(x,y){const r=this.hit(x,y);if(r){r.action();this.dirty=true;return true;}return !!this.open;},
 handle(action,value){const s=world.sim,p=s.planes.find(p=>p.id===s.selected);switch(action){
 case 'pause':s.paused=!s.paused;break;
 case 'speed':s.speed=s.speed===1?2:s.speed===2?4:1;break;
 case 'fault':if(p)s.inject(p.id,value);break;
 case 'repair':if(p)s.repair(p.id);break;
 case 'close':s.selected=null;break;
 case 'size':actions.regenerate?.(value);break;
 case 'shuffle':actions.regenerate?.(s.size,true);break;
 case 'home':world.view.angle=0;world.view.pitch=.71;world.view.zoom=1.07;world.view.target.set(7,0,1);world.updateCamera();break;
 case 'routes':world.routesVisible=!world.routesVisible;break;
 case 'help':this.open=this.open==='help'?'':'help';break;
   case 'api':this.open=this.open==='api'?'':'api';actions.apiPanel?.(this.open==='api');break;
   case 'monitor':actions.monitor?.();break;
 case 'history':this.history=!this.history;break;
 case 'tab':this.tab=value;break;
 case 'dismiss':this.hint=false;break;
 case 'export':actions.export?.();break;
 case 'mock':actions.mock?.();break;
 }this.dirty=true;},
 draw(){
 const scale=minmax(Math.min(this.height/880,this.width/1460),.60,1.15);this.scale=scale;const w=this.width/scale,h=this.height/scale,P=new Paint(w,h),sim=world.sim,p=sim.planes.find(p=>p.id===sim.selected),regions=[];
 const rect=(...a)=>P.rect(...a),txt=(...a)=>P.text(...a),line=(...a)=>P.line(...a),icon=(...a)=>P.icon(...a);
 const hit=(id,x,y,ww,hh,action,tooltip='')=>regions.push({id,x,y,w:ww,h:hh,action,tooltip});
 const panel=(x,y,ww,hh)=>{rect(x+1,y+5,ww,hh,'#172733',.15,18);rect(x-1,y-1,ww+2,hh+2,palette.border,.36,17);rect(x,y,ww,hh,palette.panel,.92,16);line(x+17,y+1,x+ww-17,y+1,'#eef0e3',1,.17);};
 const btn=(id,x,y,ww,hh,label,action,{active=false,tint=palette.text,small=false,iconName=null}={})=>{rect(x,y,ww,hh,active?tint:this.hover===id?'#516072':'#3c495a',active?.20:.65,9);if(active)rect(x,y+hh-2,ww,2,tint,.85,1);if(iconName)icon(iconName,x+ww/2,y+hh/2,small?8:11,tint);else txt(label,x+ww/2,y+(hh-(small?10:12)*1.28)/2,small?10:12,tint,'center');hit(id,x,y,ww,hh,action,label);};
 const action=(a,v)=>()=>this.handle(a,v);
 // World controls / identity.
 panel(18,18,304,145);icon('globe',43,42,11,palette.yellow);txt('LITTLE AIRWAYS',64,29,18);txt('BIG SKIES. SMALL DECISIONS.',36,58,9.5,palette.muted);
 ['small','medium','large'].forEach((size,i)=>btn('size-'+size,34+i*80,83,73,29,size.toUpperCase(),action('size',size),{active:sim.size===size,tint:sim.size===size?palette.yellow:palette.muted,small:true}));
 btn('shuffle',274,82,32,31,'NEW ISLANDS',action('shuffle'),{iconName:'dice',small:true,tint:palette.yellow});
 txt(`${world.airports.filter(a=>a.major).length} MAJOR / ${world.airports.filter(a=>!a.major).length} SMALL AIRPORTS`,35,126,10,palette.muted);txt(`SEED ${sim.seed}`,305,145,8,palette.dim,'right');
 // Selection panel. Probabilities and confidence come from the validated packet.
 if(p){
  const x=w-360,y=18,ww=342,emergency=sim.hasEmergency(p)||p.faults.radio,packet=p.packet,answer=packet?.answers.find(a=>a.questionId===this.tab),q=(p.questions||sim.questions(p)).find(q=>q.id===this.tab),dest=world.airports.find(a=>a.id===p.destination),height=610;
  panel(x,y,ww,height);icon('plane',x+33,y+32,16,p.color);txt(p.id,x+61,y+17,22);txt(p.model.toUpperCase(),x+61,y+45,8.4,palette.muted);btn('close-plane',x+ww-32,y+12,22,22,'CLOSE',action('close'),{iconName:'close',small:true});
  const state=p.error?'MODEL ERROR':p.phase==='landed'?'HOME SAFE':emergency?'ENGAGED':p.reaction!=='maintain'?'HELPING OUT':'CRUISING';txt(state,x+ww-18,y+48,8.4,p.error||emergency?palette.coral:palette.mint,'right');
  rect(x+12,y+77,ww-24,36,palette.inner,.68,10);icon('drop',x+29,y+95,8,palette.muted);txt('FUEL',x+45,y+85,11);rect(x+92,y+90,ww-169,9,'#75808c',.32,5);rect(x+92,y+90,(ww-169)*p.fuel,9,p.fuel<.25?palette.coral:palette.yellow,1,5);txt(`${Math.round(p.fuel*100)}%`,x+ww-23,y+84,12,palette.text,'right');
  rect(x+12,y+118,ww/2-17,36,palette.inner,.68,9);rect(x+ww/2+5,y+118,ww/2-17,36,palette.inner,.68,9);icon('mountain',x+29,y+137,8,palette.muted);txt(`${Math.round(p.pos.y*350).toLocaleString('en-US')} ft`,x+47,y+125,12);icon('speed',x+ww/2+23,y+137,8,palette.muted);txt(`${p.phase==='landed'?0:Math.round(p.velocity*(p.kind==='jet'?148:104))} kt`,x+ww/2+40,y+125,12);
  txt(p.pending?'ASKING...':'THINKING...',x+19,y+171,11,palette.yellow);txt(packet?`${Math.round(packet.latencyMs)} ms`:'...',x+ww-20,y+171,9,palette.dim,'right');
  let yy=y+197;const factors=answer?.factors||['Assessing the island airways.'];for(const f of factors.slice(0,3)){const available=Math.min(2,Math.floor((y+278-yy)/15));if(available<1)break;P.circle(x+22,yy+7,2,palette.dim);if(available===1){txt(f,x+33,yy,10.3,palette.muted,'left',ww-58);yy+=22;}else yy=P.wrap(f,x+33,yy,ww-58,10.3,palette.muted,15,available)+7;}
  const ty=y+283;btn('tab-route',x+15,ty,ww/2-20,27,'MY NEXT MOVE',action('tab','route'),{active:this.tab==='route',tint:this.tab==='route'?palette.yellow:palette.muted,small:true});btn('tab-response',x+ww/2+5,ty,ww/2-20,27,'NEARBY TRAFFIC',action('tab','response'),{active:this.tab==='response',tint:this.tab==='response'?palette.blue:palette.muted,small:true});
  const rows=answer?.probabilities||[],barTop=ty+42,rowHeight=this.tab==='response'?25:28;
  rows.forEach((item,i)=>{let label=q?.options?.find(o=>o.value===item.value)?.label||item.value;label=label.replace('Continue to ','TO ').replace('Divert to ','DIVERT ').replace('Enter a holding pattern','HOLD');const py=barTop+i*rowHeight,tint=colors[i%5];txt(label.toUpperCase(),x+18,py-1,9.6,palette.text,'left',141);rect(x+161,py+4,112,8,'#73808e',.35,5);rect(x+161,py+4,112*item.probability,8,tint,.95,5);txt(`${Math.round(item.probability*100)}%`,x+ww-17,py-2,10,palette.text,'right');});
  const cy=y+459;line(x+16,cy-8,x+ww-16,cy-8,palette.border,1,.17);txt('CONFIDENCE',x+18,cy,9.5,palette.muted);txt(`${Math.round((answer?.confidence||0)*100)}%`,x+ww-18,cy-3,15,palette.yellow,'right');
  const faultsOn=faults.filter(f=>p.faults[f]);const note=p.error?p.error:emergency?`${faultsOn.map(f=>fullFault[f]).join(' + ')||'Low fuel'} / priority requested`:`DESTINATION / ${dest?.name||'THE ISLANDS'}`;txt(note.toUpperCase(),x+18,cy+27,8.7,emergency||p.error?palette.coral:palette.muted,'left',ww-36);
  txt('INTRODUCE A LITTLE TROUBLE',x+18,y+514,8.7,palette.dim);
  faults.forEach((f,i)=>{const bx=x+14+i*63,by=y+536,active=!!p.faults[f];rect(bx,by,57,51,active?colors[i]:'#455267',active?.20:.40,9);if(active){rect(bx,by,57,2,colors[i],.90,1);P.circle(bx+49,by+8,3,colors[i]);}icon(icons[f],bx+28,by+19,11,colors[i]);txt(f==='hydraulics'?'HYDRO':f==='fuel'?'LEAK':f.toUpperCase(),bx+28,by+37,8,active?palette.text:palette.muted,'center');hit('fault-'+f,bx,by,57,51,action('fault',f),(active?'Clear ':'Inject ')+fullFault[f]);});
  txt('1-5: toggle / R: restore',x+18,y+593,8.2,palette.dim);if(faultsOn.length)hit('repair-text',x+208,y+589,116,19,action('repair'));txt(faultsOn.length?'RESTORE SYSTEMS':'ALL SYSTEMS GO',x+ww-17,y+592,8.5,faultsOn.length?palette.yellow:palette.mint,'right');
 }else{panel(w-300,18,282,70);icon('plane',w-271,49,13,palette.yellow);txt('EVERY PLANE HAS A PLAN.',w-248,32,11);txt('Click one to look inside.',w-248,52,10,palette.muted);}
 // Compact time + transport.
 const bottom=h-63;panel(18,bottom,258,45);btn('pause',26,bottom+7,32,31,sim.paused?'RESUME':'PAUSE',action('pause'),{iconName:sim.paused?'play':'pause',small:true,tint:palette.yellow});btn('speed',63,bottom+7,37,31,sim.speed+'x',action('speed'),{small:true});line(108,bottom+9,108,bottom+35,palette.border,1,.22);icon('sun',128,bottom+22,11,palette.yellow);const mins=18*60+26+Math.floor(sim.time/12);txt(`${Math.floor(mins/60)%24}:${String(mins%60).padStart(2,'0')}`,147,bottom+11,17);txt('CLEAR',207,bottom+12,8,palette.muted);txt('DAY 3',207,bottom+25,8,palette.dim);
 const logx=286,logw=w-304;panel(logx,bottom,logw,45);icon('comms',logx+24,bottom+22,9,palette.muted);txt('COMMS',logx+43,bottom+14,10);line(logx+94,bottom+10,logx+94,bottom+35,palette.border,1,.23);const last=sim.log[0];if(last){const tint=last.tone==='danger'?palette.coral:last.tone==='notice'?palette.blue:palette.mint;P.circle(logx+110,bottom+22,3,tint);txt(last.id,logx+122,bottom+14,10,tint);const offset=Math.min(125,P.measure(last.id,10)+11);txt(last.text,logx+122+offset,bottom+14,10,palette.text,'left',logw-175-offset);}icon('chevron',w-37,bottom+22,7,palette.muted);hit('history',logx,bottom,logw,45,action('history'),'Open communication log');
 // Discreet tool rail, avoiding a large tutorial over the world.
 const railY=bottom-48;btn('home',20,railY,30,30,'RESET VIEW',action('home'),{iconName:'home',small:true});btn('routes',55,railY,68,30,'ROUTES',action('routes'),{active:world.routesVisible,small:true,tint:palette.muted});btn('help',128,railY,30,30,'HELP',action('help'),{iconName:'info',small:true});btn('api',163,railY,108,30,'MOCK / API',action('api'),{small:true,tint:palette.yellow});btn('jev',276,railY,82,30,'JEV DATA',action('monitor'),{small:true,tint:palette.mint});
 txt(this.fps===null?'NATIVE CAPTURE':`${this.fps} FPS`,368,railY+3,9,palette.muted);txt(`${sim.planes.length} FLIGHTS / ${sim.delivered} ARRIVALS`,368,railY+18,8,palette.muted);
 if(this.hint&&sim.interventions===0&&!this.open&&!this.history){const hx=Math.max(346,(w-360)/2-150),hy=bottom-60;rect(hx,hy,301,43,palette.panel,.86,12);icon('spark',hx+21,hy+21,9,palette.yellow);txt('Click a plane. Change its world.',hx+39,hy+9,10.5);txt('Drag to orbit / wheel to get a little closer',hx+39,hy+25,8,palette.muted);hit('hint',hx,hy,301,43,action('dismiss'));}
 if(this.history){const hx=286,hy=Math.max(182,h-433),hw=w-304,hh=bottom-hy-12;panel(hx,hy,hw,hh);txt('THE AIRWAVES',hx+20,hy+17,16);txt('A shared sky. Nobody handles it alone.',hx+20,hy+43,10,palette.muted);btn('export',hx+hw-144,hy+16,95,28,'SAVE LOG',action('export'),{small:true});btn('history-close',hx+hw-40,hy+16,25,28,'CLOSE',action('history'),{iconName:'close',small:true});let ly=hy+79;for(const entry of sim.log.slice(0,Math.max(1,Math.floor((hh-86)/27)))){const tint=entry.tone==='danger'?palette.coral:entry.tone==='notice'?palette.blue:entry.tone==='warning'?palette.yellow:palette.mint;txt(`${Math.floor(entry.time/60)}:${String(Math.floor(entry.time%60)).padStart(2,'0')}`,hx+20,ly,9,palette.dim);txt(entry.id,hx+65,ly,9.5,tint,'left',155);txt(entry.text,hx+225,ly,10,palette.text,'left',hw-247);ly+=27;}}
 if(this.open){
  // The API modal delegates its card to the real-DOM #api-panel (key input, paste,
  // password managers); only the painted dim backdrop and its hit region stay here.
  const ww=Math.min(630,w-50),hh=this.open==='api'?548:480,x=(w-ww)/2,y=(h-hh)/2;rect(0,0,w,h,'#142330',.46);hit('modal-backdrop',0,0,w,h,()=>{if(this.open==='api')actions.apiPanel?.(false);this.open='';});
  if(this.open==='help'){
   panel(x,y,ww,hh);hit('modal-card',x,y,ww,hh,()=>{});btn('modal-close',x+ww-43,y+18,25,25,'CLOSE',()=>{this.open='';},{iconName:'close',small:true});
   txt('A WORLD OF LITTLE DECISIONS',x+27,y+26,20,palette.yellow);P.wrap('Watch the airways find their rhythm. Then throw one small spanner into the works.',x+28,y+70,ww-60,13,palette.muted,21,2);
   const lines=[['CLICK A PLANE','Inspect its next move and confidence.'],['1 / 2 / 3 / 4 / 5','Toggle engine, radio, radar, fuel leak, hydraulics.'],['R','Restore the selected aircraft and its fuel reserve.'],['SPACE / SPEED BUTTON','Pause time or switch between 1x, 2x and 4x.'],['DRAG / WHEEL','Orbit the miniature world / zoom in and out.'],['HOME / C','Reset the camera / hide or show the interface.'],['TAB','Cycle through the aircraft.'],['J','Open the Jev data monitor (decisions + API traffic).'],['H / ESC','Open help / close the open panel.']];
   let yy=y+139;for(const [key,description]of lines){txt(key,x+29,yy,10,palette.yellow);txt(description,x+211,yy,10.5,palette.text,'left',ww-238);yy+=31;}
   P.wrap('This is a playful systems demo, not an aviation simulator. With the mock, probabilities are illustrative; with a live key they come from Jev but remain a toy, not aviation advice.',x+28,y+407,ww-56,10,palette.dim,16,2);
  }
 }
 if(this.busy){rect(0,0,w,h,palette.inner,.3);rect(w/2-108,h/2-25,216,50,palette.panel,.98,15);txt('GROWING NEW ISLANDS...',w/2,h/2-6,12,palette.yellow,'center');}
 // Small, genuinely interactive hover hints.
 const hovered=regions.find(r=>r.id===this.hover);if(hovered?.tooltip&&!this.open&&!this.busy){const tw=P.measure(hovered.tooltip,10)+20,tx=minmax(hovered.x+hovered.w/2-tw/2,8,w-tw-8),ty=hovered.y-29;rect(tx,ty,tw,24,palette.inner,.97,7);txt(hovered.tooltip,tx+10,ty+6,10,palette.text);}
 this.regions=regions;const gs=P.geometries();for(const g of[gs.cards,gs.text]){const pos=g.attributes.position;for(let i=0;i<pos.count;i++){pos.setX(i,pos.getX(i)*scale);pos.setY(i,pos.getY(i)*scale);}}
 cards.geometry.dispose();textMesh.geometry.dispose();cards.geometry=gs.cards;textMesh.geometry=gs.text;this.dirty=false;this.lastPaint=world.sim.time;
 },
 render(renderer){if(this.hidden)return;if(this.dirty||world.sim.time-this.lastPaint>.12)this.draw();const auto=renderer.autoClear;renderer.autoClear=false;renderer.render(scene,camera);renderer.autoClear=auto;},
 dispose(){cards.geometry.dispose();textMesh.geometry.dispose();cardsMat.dispose();textMat.dispose();atlas.dispose();}
 };
 world.sim.listeners.push(()=>hud.invalidate());world.attachHUD(hud);hud.draw();return hud;
}
