/* One full screenshot stays mounted throughout every statistics zoom. */
(()=>{'use strict';
const data=window.WALKTHROUGH,$=s=>document.querySelector(s),steps=data.steps;
const asset=f=>data.embeddedAssets?.[f]||'assets/'+f;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let index=0,sub=0,segmentEnd=null,flow=false,animation=null,timer=null,ticket=0;
let lastGroup='';
$('#steps').innerHTML=steps.map((s,i)=>{const g=s.group!==lastGroup?`<p class="nav-group">${esc(s.group)}</p>`:'';lastGroup=s.group;return g+`<a class="step-link" href="#step-${i+1}" data-step="${i}" aria-label="${i+1}단계 ${esc(s.title)}"><span>${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</a>`}).join('');
function stopCamera(keep=false){ticket++;clearTimeout(timer);timer=null;if(animation){if(keep)try{animation.commitStyles()}catch{}animation.cancel();animation=null}}
function flowButton(){$('#camera-flow').textContent=flow?'■ 연속 보기 중지':'▶ 11~15 연속 보기';$('#camera-flow').setAttribute('aria-pressed',String(flow))}
function pose(scene,rect){const host=$('#visual'),W=host.clientWidth,H=host.clientHeight,pad=24;
 const s=Math.min((W-pad*2)/(rect?rect[2]:scene.width),(H-pad*2)/(rect?rect[3]:scene.height));
 let x=rect?W/2-(rect[0]+rect[2]/2)*s:(W-scene.width*s)/2,y=rect?H/2-(rect[1]+rect[3]/2)*s:(H-scene.height*s)/2;
 if(rect){x=scene.width*s>W?Math.max(W-scene.width*s,Math.min(0,x)):(W-scene.width*s)/2;y=scene.height*s>H?Math.max(H-scene.height*s,Math.min(0,y)):(H-scene.height*s)/2}
 return `translate(${x}px,${y}px) scale(${s})`;
}
function afterScene(){if(!flow)return;if(sub<steps[index].scenes.length-1)go(index,sub+1,true);else if(index<14)go(index+1,0,true);else{flow=false;flowButton();$('#stage-label').textContent='15단계 완료 · 전체 결과 화면'}}
async function playCamera(){stopCamera();const own=ticket,scene=steps[index].scenes[sub],plane=$('.camera-plane');if(!plane)return;
 const img=plane.querySelector('img');try{await img.decode()}catch{}if(own!==ticket)return;
 const full=pose(scene),target=scene.camera?pose(scene,scene.camera):full;plane.style.transform=full;
 $('#stage-label').textContent=scene.camera?'전체 화면 → '+scene.label+' 확대 → 전체 화면':scene.label;
 if(!scene.camera){if(flow)timer=setTimeout(afterScene,scene.duration*1000);return}
 animation=plane.animate([{transform:full,offset:0},{transform:full,offset:.12,easing:'ease-in-out'},{transform:target,offset:.34},{transform:target,offset:.70,easing:'ease-in-out'},{transform:full,offset:.94},{transform:full,offset:1}],{duration:scene.duration*1000,fill:'forwards'});
 try{await animation.finished;if(own!==ticket)return;plane.style.transform=full;animation.cancel();animation=null;$('#stage-label').textContent='전체 화면 복귀 · '+scene.label+' 확인 완료';afterScene()}catch{}
}
function cropMarkup(scene,crop){const [x,y,w,h]=crop;return `<div class="crop-box" style="--crop-ratio:${w/h};aspect-ratio:${w}/${h}"><img src="${asset(scene.file)}" alt="${esc(scene.label)} 확대" style="width:${scene.width/w*100}%;left:${-x/w*100}%;top:${-y/h*100}%"></div>`}
function focusMarkup(scene){if(!scene.focus)return '';const [x,y,w,h]=scene.focus;return `<span class="focus-ring" style="left:${x/scene.width*100}%;top:${y/scene.height*100}%;width:${w/scene.width*100}%;height:${h/scene.height*100}%"></span>`}
function draw(){const s=steps[index],scene=s.scenes[sub],stats=index>=10,phone=scene.width<600&&scene.height>scene.width*1.2;
 $('#group').textContent=s.group;$('#number').textContent=String(index+1).padStart(2,'0');$('#title').textContent=s.title;$('#description').textContent=s.desc;$('#caption').textContent=scene.caption;$('#note').textContent=s.note||'';$('#stage-label').textContent=scene.label;
 $('#counter').textContent=`${index+1} / 15 단계${s.scenes.length>1?' · '+(sub+1)+' / '+s.scenes.length+' 화면':''}`;$('#progress').style.width=(index+1)/15*100+'%';$('#prev').disabled=index===0&&sub===0;$('#next').textContent=index===14?'처음으로 ↺':sub<s.scenes.length-1?'다음 화면 →':'다음 단계 →';
 document.querySelectorAll('.step-link').forEach((a,i)=>{a.classList.toggle('active',i===index);if(i===index)a.setAttribute('aria-current','step');else a.removeAttribute('aria-current')});
 $('#scenes').innerHTML=s.scenes.length>1?s.scenes.map((c,i)=>`<button data-scene="${i}" class="${i===sub?'active':''}" aria-pressed="${i===sub}">${esc(c.label)}</button>`).join(''):'';
 $('#camera-tools').hidden=!stats;$('#camera-replay').hidden=!scene.camera;$('#camera-hold').hidden=!scene.camera;$('#camera-overview').hidden=!scene.camera;flowButton();$('#visual').classList.toggle('camera-view',stats);
 if(stats){const mark=scene.camera?`<span class="camera-target" style="left:${scene.camera[0]}px;top:${scene.camera[1]}px;width:${scene.camera[2]}px;height:${scene.camera[3]}px"></span>`:'';$('#visual').innerHTML=`<div class="camera-plane" style="width:${scene.width}px;height:${scene.height}px"><img src="${asset(scene.file)}" alt="${esc(scene.label)} 전체 화면 원본" width="${scene.width}" height="${scene.height}">${mark}</div>`;playCamera()}
 else if(phone){const crop=scene.crop||(scene.file.startsWith('09-')?[18,190,395,590]:[15,78,400,550]);$('#visual').innerHTML=`<div class="phone-shell"><div class="screenshot-wrap"><img class="main-shot" src="${asset(scene.file)}" alt="${esc(scene.label)} 실제 프로그램 화면">${focusMarkup(scene)}</div></div><span class="detail-arrow" aria-hidden="true">→</span><div class="detail"><small>${esc(scene.label)} · 확대 보기</small>${cropMarkup(scene,crop)}</div>`}
 else if(scene.crop)$('#visual').innerHTML=`<div class="desktop-detail">${cropMarkup(scene,scene.crop)}</div>`;
 else $('#visual').innerHTML=`<div class="screenshot-wrap"><img class="main-shot" src="${asset(scene.file)}" alt="${esc(scene.label)} 실제 프로그램 화면">${focusMarkup(scene)}</div>`;
 $('#large-image').src=asset(scene.file);$('#large-image').alt=scene.label+' 실제 캡처';$('#large-image').classList.toggle('mobile',phone);$('#image-title').textContent=String(index+1).padStart(2,'0')+' · '+scene.label;document.title=s.title+' | 고객만족도 조사 이용 과정';
}
function go(i,j=0,fromFlow=false){stopCamera();if(!fromFlow)flow=false;index=Math.max(0,Math.min(14,i));sub=Math.max(0,Math.min(steps[index].scenes.length-1,j));history.replaceState(null,'',`#step-${index+1}${sub?'-'+(sub+1):''}`);draw();window.scrollTo({top:0,behavior:'instant'})}
function move(delta){if(delta>0&&sub<steps[index].scenes.length-1)go(index,sub+1);else if(delta<0&&sub>0)go(index,sub-1);else if(delta<0&&index>0)go(index-1,steps[index-1].scenes.length-1);else if(delta>0)go(index===14?0:index+1)}
function fromHash(){const m=location.hash.match(/^#step-(\d+)(?:-(\d+))?$/);go(m?Number(m[1])-1:0,m&&m[2]?Number(m[2])-1:0)}
$('#steps').onclick=e=>{const a=e.target.closest('[data-step]');if(a){e.preventDefault();go(Number(a.dataset.step))}};$('#scenes').onclick=e=>{const b=e.target.closest('[data-scene]');if(b)go(index,Number(b.dataset.scene))};$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);window.addEventListener('hashchange',fromHash);
$('#camera-replay').onclick=()=>{flow=false;flowButton();playCamera()};$('#camera-flow').onclick=()=>{if(flow){flow=false;stopCamera(true);flowButton()}else{flow=true;go(10,0,true)}};
$('#camera-hold').onclick=()=>{flow=false;flowButton();stopCamera();const plane=$('.camera-plane'),scene=steps[index].scenes[sub];if(plane&&scene.camera){plane.style.transform=pose(scene,scene.camera);$('#stage-label').textContent=scene.label+' 확대 유지 · 전체 화면으로 축소 버튼으로 돌아가기'}};
$('#camera-overview').onclick=()=>{flow=false;flowButton();stopCamera(true);const plane=$('.camera-plane');if(plane){const scene=steps[index].scenes[sub];animation=plane.animate([{transform:plane.style.transform},{transform:pose(scene)}],{duration:850,easing:'ease-in-out',fill:'forwards'});$('#stage-label').textContent='전체 화면으로 축소'}};
function enlarge(){flow=false;stopCamera(true);flowButton();$('#image-dialog').showModal()}$('#zoom').onclick=enlarge;$('#image-open').onclick=enlarge;$('#visual').onclick=enlarge;$('#image-close').onclick=()=>$('#image-dialog').close();
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{$('#toast').textContent='브라우저의 전체 화면 기능(F11)을 이용해 주세요.';$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3500)}};
const movie=$('#movie');$('#video-chapters').innerHTML=steps.map((s,i)=>`<button data-video-step="${i}">${String(i+1).padStart(2,'0')} ${esc(s.title)}</button>`).join('');
async function playAt(time,end){flow=false;stopCamera(true);flowButton();segmentEnd=end??null;$('#video-dialog').showModal();movie.currentTime=time;try{await movie.play()}catch{}$('#video-info').textContent=end?`${index+1}단계 구간 재생 · 실제 화면 캡처 기반`:'전체 이용 과정 · 실제 화면 캡처 기반 · 무음 영상'}
$('#video-open').onclick=()=>playAt(0);$('#scene-video').onclick=()=>playAt(steps[index].start,steps[index].end);$('#video-close').onclick=()=>$('#video-dialog').close();$('#video-dialog').addEventListener('close',()=>{movie.pause();segmentEnd=null});$('#video-chapters').onclick=e=>{const b=e.target.closest('[data-video-step]');if(b){segmentEnd=null;movie.currentTime=steps[Number(b.dataset.videoStep)].start;movie.play().catch(()=>{})}};
movie.addEventListener('timeupdate',()=>{if(segmentEnd!==null&&movie.currentTime>=segmentEnd){movie.pause();segmentEnd=null}document.querySelectorAll('[data-video-step]').forEach((b,i)=>b.classList.toggle('active',movie.currentTime>=steps[i].start&&movie.currentTime<steps[i].end))});
movie.addEventListener('error',()=>$('#video-info').textContent='영상 재생을 확인할 수 없습니다. 영상 내려받기를 이용해 주세요.');
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||e.target.matches('input,textarea,select'))return;if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(index>=10){stopCamera();draw()}},180)});fromHash();
})();
