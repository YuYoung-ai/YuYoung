(function(root){
  'use strict';
  if(root.BazTheme)return;
  var doc=document,html=doc.documentElement,media=root.matchMedia('(prefers-color-scheme: dark)'),key='baz_theme',choice=null;
  function valid(v){return v==='dark'||v==='light'?v:null;}
  try{choice=valid(localStorage.getItem(key))||valid(localStorage.getItem('baz_work_theme'));}catch(e){}
  var moon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z"/></svg>';
  var sun='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>';
  function apply(){
    var dark=(choice|| (media.matches?'dark':'light'))==='dark';
    html.dataset.theme=dark?'dark':'light';
    if(doc.body)doc.body.classList.toggle('dark',dark);
    doc.querySelectorAll('[data-baz-theme-toggle]').forEach(function(b){
      b.innerHTML=dark?sun:moon;b.setAttribute('aria-label',dark?'라이트 모드 켜기':'다크 모드 켜기');
      b.setAttribute('title',dark?'라이트 모드':'다크 모드');b.setAttribute('aria-pressed',String(dark));
    });
    root.dispatchEvent(new CustomEvent('baz-theme-change',{detail:{theme:html.dataset.theme}}));
  }
  function set(value){
    choice=valid(value);
    try{if(choice){localStorage.setItem(key,choice);localStorage.setItem('baz_work_theme',choice);}else{localStorage.removeItem(key);localStorage.removeItem('baz_work_theme');}}catch(e){}
    apply();
  }
  root.BazTheme={set:set,toggle:function(){set(html.dataset.theme==='dark'?'light':'dark');}};
  apply();
  function mount(){
    var b=doc.getElementById('theme')||doc.getElementById('themeToggle');
    if(!b){b=doc.createElement('button');b.id='baz-theme-toggle';b.type='button';doc.body.appendChild(b);b.classList.add('baz-theme-floating');}
    b.classList.add('baz-theme-toggle');b.setAttribute('data-baz-theme-toggle','');
    b.addEventListener('click',root.BazTheme.toggle);apply();
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  root.addEventListener('storage',function(e){if(e.key===key||e.key===null){try{choice=valid(localStorage.getItem(key));}catch(err){choice=null;}apply();}});
  media.addEventListener('change',function(){if(!choice)apply();});
})(window);
