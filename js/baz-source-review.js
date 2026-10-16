(function(root){
  'use strict';
  var labels={hospitalName:'병원명',date:'처리일',sn:'장비 S/N',engineer:'실제 처리자',gubun:'구분',cat:'분류',type:'유형',part:'교체품',cost:'교체비용',detail:'처리 내용',result:'처리 결과',remark:'특이사항',nozzleReuse:'노즐 재사용',nsFill:'NS 충진 여부',nsAmt:'NS 충진량',jet:'젯 분사 판단'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function markup(history,disabled){
    var review=history.sourceReview;if(!review)return '';
    if(!review.pending)return review.reviewedAt?'<p class="hint">원본 변경 확인 · '+esc(review.reviewedBy)+' · '+esc(new Date(review.reviewedAt).toLocaleString('ko-KR'))+'</p>':'';
    return '<section class="source-review"><strong>'+(review.afterCompletion?'완료 이후 원본 변경':'Handover 원본 변경')+' · 확인 필요</strong><p>최근 동기화에서 확인한 변경입니다. 업무 상태는 유지됩니다.</p><details><summary>변경 항목 '+review.changes.length+'개 비교</summary><dl>'+review.changes.map(function(c){return '<dt>'+esc(labels[c.field]||c.field)+'</dt><dd><span class="source-before">이전: '+esc(c.before||'미기록')+(c.beforeTruncated?'… (앞 300자)':'')+'</span><span>현재: '+esc(c.after||'미기록')+(c.afterTruncated?'… (앞 300자)':'')+'</span></dd>';}).join('')+'</dl></details><button type="button" data-source-review="'+esc(history.id)+'"'+(disabled?' disabled':'')+'>변경 내용 확인</button></section>';
  }
  async function comparePdf(){return {state:'snapshot',text:'생성 당시 입력·사진·서명으로 고정된 문서'};}
  root.BazSourceReview={markup:markup,comparePdf:comparePdf};
})(typeof window!=='undefined'?window:this);
