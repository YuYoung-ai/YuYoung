(function(global){
  'use strict';
  const CACHE_KEY='baz_inspection_hospital_db_v1';
  const text=value=>value==null?'':String(value).trim();
  function normalize(rows){
    if(!Array.isArray(rows))throw new Error('병원정보DB 응답을 확인할 수 없습니다.');
    const seen=new Set(),list=[];
    rows.forEach(row=>{
      if(!row || typeof row!=='object' || !text(row.name))return;
      const h={n:text(row.name),s:text(row.sn),c:text(row.ncare),sa:text(row.sales),r:text(row.region)};
      const key=JSON.stringify(h);
      if(!seen.has(key)){seen.add(key);list.push(h);}
    });
    if(rows.length && !list.length)throw new Error('병원정보DB 응답을 확인할 수 없습니다.');
    return list;
  }
  function create(cfg){
    let cachedAt='',inFlight=null;
    function replace(rows){cfg.rows.splice(0,cfg.rows.length,...rows);cfg.changed();}
    try{
      const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
      if(cached && typeof cached.at==='string' && Array.isArray(cached.data)){
        const rows=normalize(cached.data);cachedAt=cached.at;replace(rows);
      }
    }catch(e){}
    async function load(force){
      if(inFlight)return inFlight;
      inFlight=(async()=>{
        cfg.busy(true);
        cfg.status(cachedAt?'저장된 병원정보DB를 최신 목록과 확인 중…':'병원정보DB 불러오는 중…');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
          if(!global.BazAuth || typeof global.BazAuth.withToken!=='function')throw new Error('로그인 상태를 확인해 주세요.');
          const url=cfg.url+'?action=hospdbrich'+(force?'&force=1':'');
          const response=await fetch(global.BazAuth.withToken(url),{signal:controller.signal,cache:'no-store'});
          if(!response.ok)throw new Error('병원정보DB 연결에 실패했습니다.');
          const body=await response.json();
          if(!body || body.success!==true)throw new Error(/unauthorized|토큰|로그인/i.test(text(body&&body.error))?'로그인 상태를 확인해 주세요.':'병원정보DB를 불러오지 못했습니다.');
          const rows=normalize(body.data);
          replace(rows);
          cachedAt=new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
          // Store only the autocomplete fields returned by the Sheet, without credentials.
          try{localStorage.setItem(CACHE_KEY,JSON.stringify({at:cachedAt,data:rows.map(h=>({name:h.n,sn:h.s,ncare:h.c,sales:h.sa,region:h.r}))}));}catch(e){}
          cfg.status(rows.length?'병원정보DB · '+rows.length+'건 · 방금 조회':'병원정보DB에 등록된 병원이 없습니다.');
          return true;
        }catch(e){
          const reason=e.name==='AbortError'?'조회 시간이 초과되었습니다.':/로그인|병원정보DB/.test(e.message)?e.message:'병원정보DB 연결에 실패했습니다.';
          cfg.status(cachedAt?'저장된 병원정보DB · '+cachedAt+' 조회 · '+reason:reason+' DB 새로고침을 눌러 주세요.');
          return false;
        }finally{clearTimeout(timer);cfg.busy(false);}
      })();
      try{return await inFlight;}finally{inFlight=null;}
    }
    return {load};
  }
  global.BazInspectionHospitals={create,normalize};
})(window);
