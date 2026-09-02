// 실제 ExcelJS 직렬화/재열기 검증. npm ExcelJS 4.4.0 또는 EXCELJS_TEST_MODULE 경로 사용.
// 실행: node test/dashboard-history-excel.mjs [--xlsx=<합성 데이터 샘플 저장 경로>]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {D,F,cur,raw,grab} from './dashboard-history-comparison.mjs';
const require=createRequire(import.meta.url);
const Excel=require(process.env.EXCELJS_TEST_MODULE||'exceljs');
let count=0;const ck=(label,fn)=>{fn();count++;console.log('✅ '+label);};
D.set(cur,raw,F);D.exShowHistory_('kpiTotal');
const state=D.state();state.filtered=state.items.filter(it=>it.period==='cur'&&it.r.hosp);
const data=D.exHistoryExportData_(state);data.name='합성 데이터 검증';
const wb=D.exBuildHistoryComparisonWorkbook_(data,Excel),ws=wb.getWorksheet('병원별 비교');
ck('병원별 가나다순, 같은 VOC 최신 선택 아래 비교·동일비교 이력',()=>{
  assert.equal(ws.getCell('A8').value,'가병원');assert.equal(ws.getCell('C8').value,'선택');
  assert.equal(ws.getCell('C9').value,'비교 · 동일비교');
  assert.equal(ws.getCell('C12').value,'선택');assert.equal(ws.getCell('C13').value,'비교');
  assert.equal(ws.getCell('C14').value,'동일비교');assert.equal(ws.getCell('L13').value,"Handpiece Ass'y");
});
ck('모든 사용 셀은 가로/세로 가운데 정렬 및 줄바꿈',()=>{
  ws.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{
    assert.equal(cell.alignment.horizontal,'center',cell.address);
    assert.equal(cell.alignment.vertical,'middle',cell.address);
    assert.equal(cell.alignment.wrapText,true,cell.address);
  }));
});
ck('열 너비·행 높이·고정틀·인쇄 제목과 필터 범위',()=>{
  assert.equal(ws.columnCount,15);assert.equal(ws.getColumn(14).width,58);
  assert.ok(ws.getRow(8).height>=42);assert.equal(ws.views[0].xSplit,2);assert.equal(ws.views[0].ySplit,7);
  assert.equal(ws.autoFilter.from.row,7);assert.equal(ws.autoFilter.to.column,15);
  assert.equal(ws.pageSetup.orientation,'landscape');assert.equal(ws.pageSetup.fitToWidth,1);
  assert.equal(ws.pageSetup.printTitlesRow,'7:7');
});
ck('두 경과일은 각각 날짜 셀 참조 수식 + 캐시 값, 날짜/비용은 숫자 형식',()=>{
  assert.equal(ws.getCell('F8').value.result,17);assert.ok(ws.getCell('F8').value.formula.includes('D8-E8'));
  assert.equal(ws.getCell('H8').value.result,17);assert.ok(ws.getCell('H8').value.formula.includes('D8-G8'));
  assert.equal(ws.getCell('F12').value.result,67);assert.equal(ws.getCell('H12').value.result,93);
  assert.equal(ws.getCell('F9').value,'—');assert.equal(ws.getCell('H9').value,'—');
  assert.equal(ws.getCell('D8').value.toISOString(),'2026-08-31T00:00:00.000Z');
  assert.equal(ws.getCell('M13').value,281200);assert.equal(ws.getCell('M13').numFmt,'#,##0');
  assert.equal(ws.getCell('F8').numFmt,'0"일"');assert.equal(ws.getCell('H8').numFmt,'0"일"');
});
ck('비교 기록 색상과 병원·VOC 경계선, 본문 병합 없음',()=>{
  assert.equal(ws.getCell('A9').fill.fgColor.argb,'FFE8F4F5');
  assert.equal(ws.getCell('A14').fill.fgColor.argb,'FFFFF4DF');
  assert.equal(ws.getCell('A8').border.top.style,'medium');
  assert.ok(ws.model.merges.every(range=>Number(range.match(/\d+/)[0])<7));
});
ck('긴 처리 내용은 계속 행으로 보존하며 건수/수식에는 중복 산입하지 않음',()=>{
  const original='누수 상태 확인 후 내부 세척 및 장비 정상 동작 확인. '.repeat(60);
  const longData={...data,records:[{...data.records[0],detail:original,sn:'0000123'}]};
  const s=D.exBuildHistoryComparisonWorkbook_(longData,Excel).worksheets[0];
  assert.ok(s.rowCount>8);let joined='';
  for(let r=8;r<=s.rowCount;r++){
    joined+=s.getCell(r,14).value.replace(/\n/g,'');
    assert.ok(s.getRow(r).height<=400);assert.equal(s.getCell(r,9).value,'0000123');
    if(r>8){assert.ok(s.getCell(r,3).value.includes('내용 계속'));assert.equal(s.getCell(r,6).value,null);assert.equal(s.getCell(r,8).value,null);}
  }
  assert.equal(joined,original);assert.ok(s.getCell('A5').value.result.includes('선택 이력 1건'));
});
ck('원본의 수식처럼 보이는 텍스트를 수식으로 실행하지 않음',()=>{
  const s=D.exBuildHistoryComparisonWorkbook_({...data,records:[{...data.records[0],hosp:'=1+1',sn:'00123',detail:'=HYPERLINK("https://example.test","x")'}]},Excel).worksheets[0];
  assert.equal(s.getCell('A8').type,3);assert.equal(s.getCell('N8').type,3);assert.equal(s.getCell('I8').value,'00123');
});
const buffer=await wb.xlsx.writeBuffer();const reopened=new Excel.Workbook();await reopened.xlsx.load(buffer);
ck('실제 XLSX 저장/재열기 후 수식·정렬·날짜·필터 유지',()=>{
  const s=reopened.worksheets[0];assert.equal(s.getCell('F8').value.result,17);assert.equal(s.getCell('H8').value.result,17);
  assert.equal(s.getCell('D8').value.toISOString(),'2026-08-31T00:00:00.000Z');
  assert.equal(s.getCell('N8').alignment.horizontal,'center');assert.equal(s.getCell('N8').alignment.vertical,'middle');
  assert.ok(s.autoFilter);assert.equal(s.views[0].xSplit,2);
});
/* ── 조치 방법별 재발 근거 시트 (내부수리 vs Handpiece 교체) ── */
{
  const leak=(id,day,hosp,part,extra={})=>({id,date:day,_y:+day.slice(0,4),_m:+day.slice(5,7),_d:+day.slice(8,10),
    _q:1,hosp,gubun:'A/S',cat:'핸드피스',type:'노즐 누수(약액 유입)',part,fse:'김프로',sn:extra.sn||'EQ-1',
    detail:extra.detail||'조치',cost:'',_cost:0,hpIn:extra.hpIn||'',hpOut:extra.hpOut||''});
  const cohort=[leak('c1','2026-06-01','가병원','내부 세척',{sn:'EQ-1'}),
                leak('c2','2026-06-01','나병원',"Handpiece Ass'y",{sn:'EQ-2',hpIn:'HP-0417',hpOut:'HP-0902'}),
                leak('c3','2026-08-01','다병원','내부 세척',{sn:'EQ-3'})];
  const rawArm=cohort.concat([
    leak('c1r','2026-06-21','가병원','내부 세척',{sn:'EQ-1',detail:'동일 증상 재발'}),
    leak('c2r','2026-06-21','나병원',"Handpiece Ass'y",{sn:'EQ-2',hpIn:'HP-0902',hpOut:'HP-1130',detail:'교체 후 재발'})]);
  D.set(cohort,rawArm,F);D.exShowHistory_('kpiTotal');
  const armState=D.state();armState.filtered=armState.items;
  const armData=D.exHistoryExportData_(armState);armData.name='조치 비교 검증';
  const awb=D.exBuildHistoryComparisonWorkbook_(armData,Excel);
  const aws=awb.getWorksheet('조치 방법별 재발');
  ck('조치 방법별 재발 시트를 1번 시트와 별도로 만든다',()=>{
    assert.ok(aws,'시트 존재');
    assert.equal(awb.getWorksheet('병원별 비교').columnCount,15,'기존 시트 열 구성은 그대로');
    assert.equal(aws.getCell('A8').value,'조치 방법');
    assert.equal(aws.getCell('I8').value,'핸드피스 확정');
  });
  ck('두 조치군에 같은 지표를 나란히 싣고 재발률은 백분율 서식',()=>{
    assert.equal(aws.getCell('A9').value,'내부수리');
    assert.equal(aws.getCell('A10').value,'Handpiece 교체');
    assert.equal(aws.getCell('B9').value,2);assert.equal(aws.getCell('C9').value,1);
    assert.equal(aws.getCell('H9').value,1,'아직 재발 없는 건');
    assert.equal(aws.getCell('B10').value,1);assert.equal(aws.getCell('C10').value,1);
    assert.equal(aws.getCell('D9').numFmt,'0.0%');
    assert.equal(aws.getCell('D10').value,1);
    assert.equal(aws.getCell('G9').value,20);assert.equal(aws.getCell('G10').value,20);
  });
  ck('교체로 넣은 HP_SN(OUT)이 재발 행의 IN 으로 나오면 핸드피스 확정으로 남긴다',()=>{
    assert.equal(aws.getCell('I10').value,1,'교체군 확정 1건');
    const rows=[];aws.eachRow(r=>{if(r.number>=14)rows.push(r);});
    const swapRow=rows.find(r=>r.getCell(4).value==='Handpiece 교체');
    assert.equal(swapRow.getCell(10).value,'핸드피스 확정');
    assert.equal(swapRow.getCell(12).value,'HP-0902');
    assert.equal(swapRow.getCell(13).value,'HP-0902');
    assert.equal(swapRow.getCell(8).value,20);
  });
  ck('근거 행은 조치 한 건이 한 행이며 무재발 건은 관찰일을 남긴다',()=>{
    const rows=[];aws.eachRow(r=>{if(r.number>=14)rows.push(r);});
    assert.equal(rows.length,3,'조치 3건');
    const none=rows.find(r=>r.getCell(2).value==='다병원');
    assert.equal(none.getCell(7).value,'—','재발 처리일 없음');
    assert.equal(none.getCell(8).value,'—');
    assert.ok(Number(none.getCell(11).value)>0,'무재발 관찰일');
  });
  ck('해석 범위를 시트 안에 못박는다 — 확정 표현을 쓰지 않는다',()=>{
    const notes=[5,6,7].map(r=>String(aws.getCell(r,1).value||'')).join(' ');
    assert.ok(notes.includes('우월하다는 근거가 확인되지 않았다'));
    assert.ok(notes.includes('확정하지는 않습니다'));
    assert.ok(notes.includes('매칭 조건으로 쓰지 않습니다'));
  });
}

// 다운로드 진입점의 실패·연속 클릭·빈 결과를 검증한다. 운영 네트워크/다운로드는 호출하지 않는다.
let loading=0,downloads=0,fail=false,notices=[];
const btn={textContent:'비교 내역 엑셀',disabled:false,isConnected:true};
const api=new Function('exHistoryExportData_','exBuildHistoryComparisonWorkbook_','ExcelJS','loadHpExcelLib_','exExcelDownload_','toast','document','exHistoryFlushSearch_',`
var EX_HISTORY_STATE=null;${grab('exportHistoryComparisonExcel_')}
return {run:exportHistoryComparisonExcel_,set:s=>EX_HISTORY_STATE=s};
`)(D.exHistoryExportData_,D.exBuildHistoryComparisonWorkbook_,Excel,
  async()=>{loading++;await Promise.resolve();if(fail)throw new Error('테스트 로딩 오류');},
  async()=>{downloads++;},message=>notices.push(message),{getElementById:()=>btn},()=>false);
api.set(state);await Promise.all([api.run(),api.run()]);
ck('다운로드 중 중복 실행 방지 및 버튼 복구',()=>{assert.equal(loading,1);assert.equal(downloads,1);assert.equal(btn.disabled,false);assert.equal(btn.textContent,'비교 내역 엑셀');});
fail=true;await api.run();
ck('라이브러리 실패 시 오류 안내 및 재시도 가능 상태 복구',()=>{assert.equal(downloads,1);assert.equal(state.exporting,false);assert.equal(btn.disabled,false);assert.ok(notices.at(-1).includes('테스트 로딩 오류'));});
state.filtered=[];const before=loading;await api.run();
ck('빈 조회 결과는 파일을 생성하지 않고 안내',()=>{assert.equal(loading,before);assert.ok(notices.at(-1).includes('내보낼 비교 이력이 없습니다'));});
const output=process.argv.find(v=>v.startsWith('--xlsx='));if(output)fs.writeFileSync(output.slice(7),buffer);
console.log(`Excel 검증 통과 ${count}/${count}`);
