(function(root){
  'use strict';
  function normalize(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\s_·/()-]+/g,'');}
  function search(rows,value){
    var tokens=String(value||'').trim().split(/\s+/).map(normalize).filter(Boolean);
    return rows.filter(function(h){
      var text=normalize([h.name,h.region,h.sn].join(' '));
      return h.origin!=='flow'&&tokens.every(function(token){return text.includes(token);});
    }).sort(function(a,b){
      var query=normalize(value),ap=normalize(a.name).startsWith(query),bp=normalize(b.name).startsWith(query);
      return Number(bp)-Number(ap);
    });
  }
  function create(options){
    var doc=options.document||document,win=doc.defaultView,selector=options.selector;
    var input=null,matches=[],active=-1,choosing=false,composing=false;
    var panel=doc.createElement('div'),status=doc.createElement('div'),list=doc.createElement('div');
    panel.className='hospital-search-popup';panel.hidden=true;panel.setAttribute('popover','manual');
    status.className='hospital-search-status';status.setAttribute('role','status');
    list.id='work-hospital-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','병원정보DB 검색 결과');
    panel.append(status,list);
    function close(){
      if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
      if(panel.hidePopover&&panel.matches(':popover-open'))panel.hidePopover();
      panel.hidden=true;active=-1;
    }
    function position(){
      if(panel.hidden)return;
      if(!input||!input.isConnected||doc.activeElement!==input){close();return;}
      var box=input.getBoundingClientRect(),view=win.visualViewport;
      var top=view?view.offsetTop:0,left=view?view.offsetLeft:0,height=view?view.height:win.innerHeight,width=view?view.width:win.innerWidth;
      var below=top+height-box.bottom-8,above=box.top-top-8,up=below<180&&above>below;
      var space=Math.max(60,Math.min(330,up?above:below));
      panel.style.width=Math.min(Math.max(box.width,280),width-16)+'px';
      panel.style.left=Math.max(left+8,Math.min(box.left,left+width-parseFloat(panel.style.width)-8))+'px';
      panel.style.maxHeight=space+'px';list.style.maxHeight=Math.max(40,space-42)+'px';
      panel.style.top=(up?box.top-panel.getBoundingClientRect().height-5:box.bottom+5)+'px';
    }
    function update(target){
      if(choosing||!target||!target.matches(selector))return;
      if(input!==target){close();composing=false;}input=target;active=-1;
      input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
      input.setAttribute('aria-controls',list.id);input.removeAttribute('aria-activedescendant');
      var results=search(options.getRows(),input.value);matches=results.slice(0,40);
      list.replaceChildren();
      matches.forEach(function(h,index){
        var item=doc.createElement('div'),name=doc.createElement('strong'),meta=doc.createElement('span');
        item.id=list.id+'-'+index;item.className='hospital-search-option';item.setAttribute('role','option');
        item.setAttribute('aria-selected','false');item.dataset.hospitalIndex=String(index);
        name.textContent=h.name;meta.textContent=[h.region||'지역 미기록','S/N '+(h.sn||'미기록')].join(' · ');
        item.append(name,meta);list.append(item);
      });
      status.textContent=results.length?(results.length>40?results.length+'곳 중 40곳 · 더 입력하면 좁혀집니다':results.length+'곳 · 병원을 선택하세요'):'일치하는 병원이 없습니다.';
      var host=input.closest('dialog')||doc.body;
      if(panel.parentNode!==host){close();host.append(panel);}
      panel.hidden=false;input.setAttribute('aria-expanded','true');
      if(panel.showPopover&&!panel.matches(':popover-open'))panel.showPopover();
      list.scrollTop=0;position();
    }
    function choose(index){
      var row=matches[index];if(!row||!input||!input.isConnected)return;
      choosing=true;input.value=options.formatValue(row);close();
      // Keep the existing validation, sales fill and draft-save handlers in one path.
      input.dispatchEvent(new win.Event('input',{bubbles:true}));choosing=false;
    }
    doc.addEventListener('focusin',function(event){if(event.target.matches(selector))update(event.target);else close();});
    doc.addEventListener('focusout',function(event){if(event.target===input)close();});
    doc.addEventListener('input',function(event){update(event.target);});
    doc.addEventListener('compositionstart',function(event){if(event.target.matches(selector))composing=true;});
    doc.addEventListener('compositionend',function(event){if(event.target.matches(selector)){composing=false;update(event.target);}});
    doc.addEventListener('keydown',function(event){
      if(!event.target.matches(selector)||event.isComposing||composing||event.keyCode===229)return;
      if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        if(panel.hidden)update(event.target);if(!matches.length)return;
        event.preventDefault();event.stopPropagation();
        active=(active+(event.key==='ArrowDown'?1:active<0?0:-1)+matches.length)%matches.length;
        Array.from(list.children).forEach(function(item,index){item.setAttribute('aria-selected',String(index===active));});
        input.setAttribute('aria-activedescendant',list.children[active].id);
        list.children[active].scrollIntoView({block:'nearest'});
      }else if(event.key==='Enter'&&!panel.hidden){
        event.preventDefault();event.stopPropagation();if(active>=0)choose(active);
      }else if(event.key==='Tab')close();
    },true);
    panel.addEventListener('pointerdown',function(event){
      var item=event.target.closest('[data-hospital-index]');
      // Retain focus while selecting, so blur cannot hide the result before it is applied.
      if(item){event.preventDefault();event.stopPropagation();}
    });
    panel.addEventListener('click',function(event){var item=event.target.closest('[data-hospital-index]');if(item){event.preventDefault();event.stopPropagation();choose(Number(item.dataset.hospitalIndex));}});
    doc.addEventListener('pointerdown',function(event){if(event.target!==input&&!panel.contains(event.target))close();});
    doc.addEventListener('close',function(event){if(input&&input.closest('dialog')===event.target)close();},true);
    doc.addEventListener('scroll',position,true);win.addEventListener('resize',position);
    // Inline fields are replaced when the list is rendered; removed inputs do not always blur.
    if(win.MutationObserver)new win.MutationObserver(function(){if(input&&!input.isConnected)close();}).observe(doc.body,{childList:true,subtree:true});
    if(win.visualViewport){win.visualViewport.addEventListener('resize',position);win.visualViewport.addEventListener('scroll',position);}
    return {refresh:function(){if(input&&input.isConnected&&doc.activeElement===input)update(input);else close();}};
  }
  var api={create:create,search:search};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkHospitalSearch=api;
})(typeof window!=='undefined'?window:this);
