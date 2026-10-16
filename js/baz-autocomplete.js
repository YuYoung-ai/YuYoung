(function(root){
  'use strict';
  function create(cfg){
    var doc=cfg.document||document,win=doc.defaultView||root,input=doc.getElementById(cfg.inputId),dropdown=doc.getElementById(cfg.dropdownId);
    var matches=[],active=-1,timer=null,generation=0,press=null,composing=false,picking=false,committed=null,lastTouch=0,blockedClick=false;
    var normalize=cfg.normalize||function(v){return String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');};
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',cfg.dropdownId);input.setAttribute('aria-expanded','false');
    dropdown.setAttribute('role','listbox');
    function cancel(){generation++;if(timer!==null)win.clearTimeout(timer);timer=null;}
    function hide(){cancel();dropdown.style.display='none';active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
    function search(){
      if(picking||press||doc.activeElement!==input)return;
      var measured=root.BazPerf?root.BazPerf.start('search'):function(){},query=normalize(input.value),starts=[],contains=[];
      if(!query){matches=[];hide();measured({count:0});return;}
      (cfg.getRows?cfg.getRows():cfg.db).forEach(function(item){var text=normalize(cfg.itemText(item));if(text.startsWith(query))starts.push(item);else if(text.includes(query))contains.push(item);});
      matches=starts.concat(contains).slice(0,cfg.maxResults||20);active=-1;
      dropdown.innerHTML=matches.map(function(item,i){return '<div class="ac-opt" role="option" aria-selected="false" id="'+cfg.dropdownId+'-'+i+'" data-i="'+i+'"'+(cfg.optStyle?' style="'+cfg.optStyle+'"':'')+'>'+cfg.renderItem(item)+'</div>';}).join('');
      dropdown.style.display=matches.length?'block':'none';dropdown.scrollTop=0;input.setAttribute('aria-expanded',String(!!matches.length));input.removeAttribute('aria-activedescendant');measured({count:starts.length+contains.length});
    }
    function schedule(immediate){cancel();if(immediate){search();return;}var token=generation;timer=win.setTimeout(function(){timer=null;if(token===generation)search();},cfg.delay==null?120:cfg.delay);}
    function restoreCommit(){
      // A final IME event may arrive after blur. Keep the explicitly picked value
      // until a new focus starts a new editing session.
      if(committed!==null&&doc.activeElement!==input){input.value=committed;return true;}return false;
    }
    function pick(item,finishComposition){
      if(!item||picking||dropdown.style.display!=='block')return;
      if(!(cfg.getRows?cfg.getRows():cfg.db).includes(item)){press=null;hide();search();return;}
      cancel();press=null;picking=true;
      try{if((composing||finishComposition)&&input.blur)input.blur();cfg.onPick(item);committed=input.value;composing=false;hide();}
      finally{picking=false;}
    }
    function changed(e){if(picking||restoreCommit())return;committed=null;if(e&&e.isComposing)composing=true;if(cfg.onInput)cfg.onInput();schedule(composing);}
    input.addEventListener('input',changed);
    input.addEventListener('focus',function(){committed=null;press=null;blockedClick=false;if(input.value)schedule(true);});
    input.addEventListener('blur',function(){if(!picking&&!press)hide();});
    input.addEventListener('compositionstart',function(){composing=true;committed=null;});
    input.addEventListener('compositionupdate',function(){if(!picking&&!restoreCommit())schedule(true);});
    input.addEventListener('compositionend',function(){composing=false;if(!picking&&!restoreCommit())schedule(true);});
    input.addEventListener('keydown',function(e){
      if(e.isComposing||composing||e.keyCode===229)return;
      if(e.key==='Escape'){hide();return;}
      if(dropdown.style.display!=='block')return;
      if(e.key==='Enter'){e.preventDefault();if(active>=0)pick(matches[active]);return;}
      if(e.key==='Tab'){hide();return;}
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      e.preventDefault();active=e.key==='ArrowDown'?Math.min(active+1,matches.length-1):Math.max(active-1,0);
      var options=dropdown.querySelectorAll('.ac-opt');options.forEach(function(option,i){option.setAttribute('aria-selected',String(i===active));option.style.background=i===active?'#EAF4F8':'';});
      if(options[active]){input.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
    });
    function point(e){var p=e.touches&&e.touches[0]||e;return {x:p.clientX||0,y:p.clientY||0};}
    function start(e){
      var option=e.target.closest('.ac-opt');if(!option||dropdown.style.display!=='block'||e.isPrimary===false||e.button>0)return;
      if(e.type==='touchstart')lastTouch=Date.now();
      if(e.type==='mousedown'&&Date.now()-lastTouch<700)return;
      cancel();blockedClick=false;var p=point(e);press={item:matches[Number(option.getAttribute('data-i'))],x:p.x,y:p.y,moved:false,pointerId:e.pointerId,composing:composing};
      // Retain focus through a tap; touch-action:pan-y still permits scrolling,
      // which produces pointercancel instead of applying a selection.
      if(e.type==='pointerdown'||e.type==='mousedown')e.preventDefault();
    }
    function move(e){if(!press)return;var p=point(e);if(Math.abs(p.x-press.x)>10||Math.abs(p.y-press.y)>10)press.moved=true;}
    function cancelPress(){if(press){blockedClick=true;press=null;if(doc.activeElement!==input)hide();}}
    if(win.PointerEvent){dropdown.addEventListener('pointerdown',start);dropdown.addEventListener('pointermove',move);dropdown.addEventListener('pointercancel',cancelPress);}
    else{dropdown.addEventListener('mousedown',start);dropdown.addEventListener('touchstart',start,{passive:true});dropdown.addEventListener('touchmove',move,{passive:true});dropdown.addEventListener('touchcancel',cancelPress);}
    dropdown.addEventListener('scroll',cancelPress,{passive:true});
    dropdown.addEventListener('click',function(e){
      var option=e.target.closest('.ac-opt');if(!option)return;e.preventDefault();
      if(blockedClick){blockedClick=false;return;}
      var gesture=press;press=null;
      if(gesture&&gesture.moved){if(doc.activeElement!==input)hide();return;}
      pick(gesture?gesture.item:matches[Number(option.getAttribute('data-i'))],gesture&&gesture.composing);
    });
    doc.addEventListener(win.PointerEvent?'pointerdown':'mousedown',function(e){if(e.target!==input&&!dropdown.contains(e.target)){press=null;hide();}});
    doc.addEventListener('click',function(e){if(e.target!==input&&!dropdown.contains(e.target)){press=null;hide();}});
    return {refresh:function(){if(doc.activeElement===input&&committed===null)schedule(true);else hide();},reset:function(){press=null;blockedClick=false;committed=null;composing=false;matches=[];hide();}};
  }
  var api={create:create};if(typeof module==='object'&&module.exports)module.exports=api;else root.BazAutocomplete=api;
})(typeof window==='object'?window:this);
