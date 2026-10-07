(function(){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function safeURL(value,cloud){
    try{var text=String(value||'').trim(),url=new URL(text);if(!/^https?:$/.test(url.protocol)||!url.hostname||url.username||url.password)return '';
      if(cloud&&(url.protocol!=='https:'||url.hostname!=='bazsecure.com'||url.port||!/^\/url\/?$/.test(url.pathname)||!url.searchParams.get('key')))return '';
      return text;
    }catch(e){return '';}
  }
  function clean(value){return String(value||'').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();}
  function action(label){var text=clean(label).replace(/^[｜|]\s*/,'');return /^(수정|편집|edit)$/i.test(text)?'edit':/^(문서\s*)?(열기|보기|open|view)$/i.test(text)?'open':'';}
  function documentFromLinks(links,folder){
    links=links.filter(function(link){return safeURL(link.url,true)&&clean(link.label);});
    var titles=links.filter(function(link){return !action(link.label);});if(!titles.length)return null;
    var title=titles[0],open=links.find(function(link){return action(link.label)==='open';})||titles[titles.length-1],edit=links.find(function(link){return action(link.label)==='edit';});
    return {name:clean(title.label),folder:clean(folder),titleURL:title.url,openURL:open.url,editURL:edit?edit.url:''};
  }
  function markdownLabel(value){return clean(value).replace(/\\/g,'\\\\').replace(/\[/g,'\\[').replace(/\]/g,'\\]');}
  function markdownLink(label,url){return '['+markdownLabel(label)+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';}
  function serialize(doc){return doc.editURL||doc.openURL;}
  var markdownPattern=/\[((?:\\.|[^\]\\\r\n])+)\]\((https?:\/\/[^)\s]+)\)/gi;
  function parseDocument(block){
    var links=[],folder='',valid=true;
    String(block).split('\n').forEach(function(line){
      line=line.trim();if(!line||/^\|?[\s:|\-]+\|?$/.test(line))return;
      var found=false,remainder=line.replace(new RegExp(markdownPattern.source,'gi'),function(all,label,url){found=true;links.push({label:label.replace(/\\([\\\[\]])/g,'$1'),url:url});return '';}).replace(/[|｜·]/g,'').trim();
      if(found){if(remainder)valid=false;return;}
      var path=line.replace(/^\|\s*|\s*\|$/g,'').replace(/^폴더\s*:\s*/,'').trim();
      if(path.includes('>')||/^폴더\s*:/.test(line))folder=path;else valid=false;
    });
    return valid?documentFromLinks(links,folder):null;
  }
  function renderText(text){
    var pattern=/\[((?:\\.|[^\]\\\r\n])+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<>"'\x00-\x1f]+/gi,out='',cursor=0,match;
    while((match=pattern.exec(text))){
      var candidate=match[0],url=match[2]||candidate,label=match[1]?match[1].replace(/\\([\\\[\]])/g,'$1'):'',tail='';
      if(!match[2]){while(/[.,!?;:、。！？，；：]$/.test(url)||(/[)\]\}）]$/.test(url)&&((url.match(/[)\]\}）]/g)||[]).length>(url.match(/[([\{（]/g)||[]).length)))url=url.slice(0,-1);tail=candidate.slice(url.length);}
      out+=esc(text.slice(cursor,match.index));out+=safeURL(url)?'<a class="comment-url" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label||url)+'</a>'+esc(tail):esc(candidate);cursor=match.index+candidate.length;
    }
    return out+esc(text.slice(cursor));
  }
  function render(body){return String(body==null?'':body).split(/\r?\n\s*\r?\n/).map(function(block){var doc=parseDocument(block);return '<div class="comment-note">'+renderText(doc?serialize(doc):block)+'</div>';}).join('\n\n');}
  function fromHTML(html){
    if(String(html).length>200000)throw new Error('공유 내용이 너무 큽니다. 문서 공유 표만 복사해 주세요.');
    // Template contents remain inert: pasted scripts, event handlers and remote assets never enter the live page.
    var template=document.createElement('template');template.innerHTML=html;var root=template.content;
    root.querySelectorAll('script,style,iframe,object,embed,svg,math,template,img,link,meta').forEach(function(node){node.remove();});
    var anchors=Array.from(root.querySelectorAll('a[href]'));if(!anchors.some(function(a){return safeURL(a.getAttribute('href'),true);}))return null;
    var documents=new Map();
    root.querySelectorAll('table').forEach(function(table){
      if(table.querySelector('table'))return;
      var links=Array.from(table.querySelectorAll('a[href]')).map(function(a){return {label:a.textContent,url:a.getAttribute('href')};}),folder='';
      table.querySelectorAll('tr').forEach(function(row){if(!row.querySelector('a')&&row.textContent.includes('>'))folder=clean(row.textContent);});
      var doc=documentFromLinks(links,folder);if(doc)documents.set(table,doc);
    });
    function walk(node){
      if(documents.has(node))return '\n\n'+serialize(documents.get(node))+'\n\n';
      if(node.nodeType===3)return node.textContent;
      if(node.nodeType!==1&&node.nodeType!==11)return '';
      var tag=node.nodeName.toLowerCase();if(tag==='br')return '\n';
      if(tag==='a'){var url=safeURL(node.getAttribute('href'));return url?markdownLink(node.textContent||url,url):node.textContent;}
      var text=Array.from(node.childNodes).map(walk).join('');return /^(p|div|li|tr|table|section|article|h[1-6])$/.test(tag)?'\n'+text+'\n':text;
    }
    return walk(root).replace(/\r/g,'').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function mount(options){
    var input=options.input,preview=options.preview,fileInput=options.fileInput,fileButton=options.fileButton,error=options.error,chosenSelection=null;
    function message(text){error.textContent=text||'';error.hidden=!text;}
    function refresh(){preview.innerHTML=render(input.value);preview.hidden=!input.value.trim();}
    function insert(text,selection){
      if(input.disabled||!input.isConnected)return false;
      var start=selection?selection[0]:input.selectionStart,end=selection?selection[1]:input.selectionEnd,before=input.value.slice(0,start),after=input.value.slice(end);
      var addition=(before.trim()&&!/\n\s*\n$/.test(before)?'\n\n':'')+text+(after.trim()&&!/^\n\s*\n/.test(after)?'\n\n':'');
      if(before.length+addition.length+after.length>(input.maxLength>0?input.maxLength:4000)){message('댓글은 4,000자까지 저장할 수 있습니다. 내용을 줄이거나 댓글을 나누어 등록해 주세요.');return false;}
      input.setRangeText(addition,start,end,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return true;
    }
    input.addEventListener('input',function(){message('');refresh();});
    input.addEventListener('paste',function(event){
      var clipboard=event.clipboardData;if(!clipboard||input.disabled)return;
      var html=clipboard.getData('text/html'),plain=clipboard.getData('text/plain');if(!html&&/<(?:table|a)\b/i.test(plain))html=plain;if(!html)return;
      try{var text=fromHTML(html);if(text!==null){event.preventDefault();insert(text);}}
      catch(e){event.preventDefault();message(e.message);}
    });
    fileButton.onclick=function(){chosenSelection={value:input.value,range:[input.selectionStart,input.selectionEnd]};fileInput.click();};
    fileInput.onchange=async function(){
      var file=fileInput.files&&fileInput.files[0];fileInput.value='';if(!file)return;
      if(!/\.html?$/i.test(file.name)||file.size>1024*1024){message('1MB 이하의 클라우디움 URL.html 공유 파일을 선택해 주세요.');return;}
      try{var text=fromHTML(await file.text());if(!input.isConnected)return;if(text===null){message('클라우디움 공유 링크를 찾지 못했습니다. URL.html 파일을 확인해 주세요.');return;}insert(text,chosenSelection&&chosenSelection.value===input.value?chosenSelection.range:null);}
      catch(e){if(input.isConnected)message('공유 링크를 불러오지 못했습니다. '+e.message);}
    };
    refresh();return refresh;
  }
  window.BazWorkComments={render:render,fromHTML:fromHTML,parseDocument:parseDocument,serialize:serialize,mount:mount};
})();
