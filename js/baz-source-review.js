(function(root){
  'use strict';
  var labels={hospitalName:'병원명',date:'처리일',sn:'장비 S/N',engineer:'실제 처리자',gubun:'구분',cat:'분류',type:'유형',part:'교체품',cost:'교체비용',detail:'처리 내용',result:'처리 결과',remark:'특이사항',nozzleReuse:'노즐 재사용',nsFill:'NS 충진 여부',nsAmt:'NS 충진량',jet:'젯 분사 판단'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function markup(history,disabled){
    var review=history.sourceReview;if(!review)return '';
    if(!review.pending)return review.reviewedAt?'<p class="hint">원본 변경 확인 · '+esc(review.reviewedBy)+' · '+esc(new Date(review.reviewedAt).toLocaleString('ko-KR'))+'</p>':'';
    return '<section class="source-review"><strong>'+(review.afterCompletion?'완료 이후 원본 변경':'Handover 원본 변경')+' · 확인 필요</strong><p>최근 동기화에서 확인한 변경입니다. 업무 상태는 유지됩니다.</p><details><summary>변경 항목 '+review.changes.length+'개 비교</summary><dl>'+review.changes.map(function(c){return '<dt>'+esc(labels[c.field]||c.field)+'</dt><dd><span class="source-before">이전: '+esc(c.before||'미기록')+(c.beforeTruncated?'… (앞 300자)':'')+'</span><span>현재: '+esc(c.after||'미기록')+(c.afterTruncated?'… (앞 300자)':'')+'</span></dd>';}).join('')+'</dl></details><button type="button" data-source-review="'+esc(history.id)+'"'+(disabled?' disabled':'')+'>변경 내용 확인</button></section>';
  }
  async function comparePdf(attachment,source){
    var basis=attachment&&attachment.sourceBasis;
    if(!basis||basis.v!==1||!basis.fields)return {state:'unknown',text:'기존 PDF · 생성 당시 원본 비교 정보 없음'};
    if(!source||basis.recordId!==source.recordId||source.origin==='flow')return {state:'unknown',text:'연결된 Handover를 불러온 뒤 비교할 수 있습니다.'};
    var changed=[];
    var printed=['hospitalName','date','sn','gubun','cat','type','part','cost','detail','result','remark'];if(basis.format!=='simplified')printed.push('engineer');
    for(var field of printed){
      if(!/^[a-f0-9]{64}$/.test(basis.fields[field]||''))return {state:'unknown',text:'PDF 원본 비교 정보를 확인할 수 없습니다.'};
      var bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String((field==='hospitalName'?source.sourceHospitalName||source.hospitalName:source[field])||'').replace(/\r\n?/g,'\n').trim()));
      var hash=Array.from(new Uint8Array(bytes),function(b){return b.toString(16).padStart(2,'0');}).join('');
      if(hash!==basis.fields[field])changed.push(labels[field]);
    }
    return changed.length?{state:'changed',text:'PDF 생성 이후 원본 변경 · 재생성 필요: '+changed.join(', ')}:{state:'current',text:'생성 당시와 Handover 항목 동일 · 최근 동기화 기준'};
  }
  root.BazSourceReview={markup:markup,comparePdf:comparePdf};
})(typeof window!=='undefined'?window:this);
