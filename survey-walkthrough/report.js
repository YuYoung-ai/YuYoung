(()=>{'use strict';
const data=window.WALKTHROUGH,$=s=>document.querySelector(s),steps=data.steps;
let index=0,sub=0,segmentEnd=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let previousGroup='';
$('#steps').innerHTML=steps.map((s,i)=>{const group=s.group!==previousGroup?`<p class="nav-group">${esc(s.group)}</p>`:'';previousGroup=s.group;return group+`<a class="step-link" href="#step-${i+1}" data-step="${i}" aria-label="${i+1}단계 ${esc(s.title)}"><span>${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</a>`}).join('');
function cropMarkup(scene,crop){const [x,y,w,h]=crop;return `<div class="crop-box" style="--crop-ratio:${w/h};aspect-ratio:${w}/${h}"><img src="assets/${scene.file}" alt="${esc(scene.label)} 확대" style="width:${scene.width/w*100}%;left:${-x/w*100}%;top:${-y/h*100}%"></div>`}
function focusMarkup(scene){if(!scene.focus)return '';const [x,y,w,h]=scene.focus;return `<span class="focus-ring" style="left:${x/scene.width*100}%;top:${y/scene.height*100}%;width:${w/scene.width*100}%;height:${h/scene.height*100}%"></span>`}
function draw(){const s=steps[index],scene=s.scenes[sub];$('#group').textContent=s.group;$('#number').textContent=String(index+1).padStart(2,'0');$('#title').textContent=s.title;$('#description').textContent=s.desc;$('#caption').textContent=scene.caption;$('#note').textContent=s.note||'';$('#stage-label').textContent=scene.label;$('#counter').textContent=`${index+1} / 15 단계${s.scenes.length>1?' · '+(sub+1)+' / '+s.scenes.length+' 화면':''}`;$('#progress').style.width=((index+1)/15*100)+'%';$('#prev').disabled=index===0&&sub===0;$('#next').textContent=index===14?'처음으로 ↺':'다음 단계 →';
document.querySelectorAll('.step-link').forEach((a,i)=>{a.classList.toggle('active',i===index);if(i===index)a.setAttribute('aria-current','step');else a.removeAttribute('aria-current')});
$('#scenes').innerHTML=s.scenes.length>1?s.scenes.map((c,i)=>`<button data-scene="${i}" class="${i===sub?'active':''}" aria-pressed="${i===sub}">${esc(c.label)}</button>`).join(''):'';
const phone=scene.width<600;
if(phone){const crop=scene.crop||(scene.file.startsWith('09-')?[18,190,395,590]:[15,78,400,550]);$('#visual').innerHTML=`<div class="phone-shell"><div class="screenshot-wrap"><img class="main-shot" src="assets/${scene.file}" alt="${esc(scene.label)} 실제 프로그램 화면">${focusMarkup(scene)}</div></div><span class="detail-arrow" aria-hidden="true">→</span><div class="detail"><small>${esc(scene.label)} · 확대 보기</small>${cropMarkup(scene,crop)}</div>`}
else if(scene.crop){$('#visual').innerHTML=`<div class="desktop-detail">${cropMarkup(scene,scene.crop)}</div>`}
else{$('#visual').innerHTML=`<div class="screenshot-wrap"><img class="main-shot" src="assets/${scene.file}" alt="${esc(scene.label)} 실제 프로그램 화면">${focusMarkup(scene)}</div>`}
$('#large-image').src='assets/'+scene.file;$('#large-image').alt=scene.label+' 실제 캡처';$('#large-image').classList.toggle('mobile',phone);$('#image-title').textContent=String(index+1).padStart(2,'0')+' · '+scene.label;document.title=s.title+' | 고객만족도 조사 이용 과정';
}
function go(i,j=0){index=Math.max(0,Math.min(14,i));sub=Math.max(0,Math.min(steps[index].scenes.length-1,j));history.replaceState(null,'',`#step-${index+1}${sub?'-'+(sub+1):''}`);draw();window.scrollTo({top:0,behavior:'instant'})}
function move(delta){const length=steps[index].scenes.length;if(delta>0&&sub<length-1)go(index,sub+1);else if(delta<0&&sub>0)go(index,sub-1);else if(delta<0&&index>0)go(index-1,steps[index-1].scenes.length-1);else if(delta>0)go(index===14?0:index+1)}
function fromHash(){const m=location.hash.match(/^#step-(\d+)(?:-(\d+))?$/);go(m?Number(m[1])-1:0,m&&m[2]?Number(m[2])-1:0)}
$('#steps').addEventListener('click',e=>{const a=e.target.closest('[data-step]');if(a){e.preventDefault();go(Number(a.dataset.step))}});$('#scenes').addEventListener('click',e=>{const b=e.target.closest('[data-scene]');if(b)go(index,Number(b.dataset.scene))});$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);window.addEventListener('hashchange',fromHash);
function enlarge(){$('#image-dialog').showModal()}$('#zoom').onclick=enlarge;$('#image-open').onclick=enlarge;$('#visual').onclick=enlarge;$('#image-close').onclick=()=>$('#image-dialog').close();
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{$('#toast').textContent='브라우저의 전체 화면 기능(F11)을 이용해 주세요.';$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3500)}};
const movie=$('#movie');
$('#video-chapters').innerHTML=steps.map((s,i)=>`<button data-video-step="${i}">${String(i+1).padStart(2,'0')} ${esc(s.title)}</button>`).join('');
async function playAt(time,end){segmentEnd=end??null;$('#video-dialog').showModal();movie.currentTime=time;try{await movie.play()}catch{}$('#video-info').textContent=end?`${index+1}단계 구간 재생 · 실제 화면 캡처 기반`:'전체 이용 과정 · 실제 화면 캡처 기반 · 무음 영상'}
$('#video-open').onclick=()=>playAt(0);$('#scene-video').onclick=()=>playAt(steps[index].start,steps[index].end);$('#video-close').onclick=()=>$('#video-dialog').close();$('#video-dialog').addEventListener('close',()=>{movie.pause();segmentEnd=null});$('#video-chapters').onclick=e=>{const b=e.target.closest('[data-video-step]');if(b){segmentEnd=null;movie.currentTime=steps[Number(b.dataset.videoStep)].start;movie.play().catch(()=>{})}};
movie.addEventListener('timeupdate',()=>{if(segmentEnd!==null&&movie.currentTime>=segmentEnd){movie.pause();segmentEnd=null}document.querySelectorAll('[data-video-step]').forEach((b,i)=>b.classList.toggle('active',movie.currentTime>=steps[i].start&&movie.currentTime<steps[i].end))});
movie.addEventListener('error',()=>$('#video-info').textContent='영상 재생을 확인할 수 없습니다. 영상 내려받기를 이용해 주세요.');
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||e.target.matches('input,textarea,select,button'))return;if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));fromHash();
})();
