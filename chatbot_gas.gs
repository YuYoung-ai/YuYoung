// ════════════════════════════════════════════════════════════════════════
// BAZ BIOMEDIC CS — AI 트러블슈팅 챗봇 GAS 백엔드 (정리판 v3.1)
//
// [시트 구성]
//   📊 CS_대시보드        — 한눈에 보는 요약 (자동 갱신)
//   📖 CS_지식베이스      — 챗봇이 읽는 매뉴얼 (증상/키워드/3단계)
//   ✅ CS_승인대기        — 현장 해결책 (체크박스 승인 → 자동 매뉴얼 반영)
//   📝 CS_대화로그        — 전체 질문 이력
//   ⚠️ CS_미해결질문      — 매뉴얼에 없던 질문 (보강 대상)
//   👍 챗봇피드백         — [v3.1] 답변 👍/👎 평가 (👎는 보강상태 '확인필요')
//
// [설치]
//   1) 이 코드를 GAS 편집기에 붙여넣기
//   2) setupAllSheets() 1회 실행 → 모든 시트 자동 생성·서식
//   3) 웹앱 배포 → chatbot.html의 CONFIG에 URL 입력
//   4) 스크립트 속성에 ANTHROPIC_API_KEY 추가 (AI 프록시용)
//
// ★ v3.1 적용 방법 (기존 v3 위에 덮어쓰기) ★
//   1) 기존 코드 전체를 이 파일로 교체
//   2) 배포 > 배포 관리 > ✏️ > 버전: "새 버전" > 배포
//      ※ "새 배포" 아님 — URL 바뀌면 chatbot.html 연동이 깨집니다
//   [v3.1 추가] POST type=chatbot_feedback (👍/👎 기록)
//               GET  action=kb_version    (KB 버전 조회 — 프런트 캐시 동기화)
//               KB 승인 반영·수동 편집 시 버전 자동 증가
// ════════════════════════════════════════════════════════════════════════

// ── 시트 이름 ──
const SH = {
  DASH:    '📊 CS_대시보드',
  KB:      '📖 CS_지식베이스',
  ADMIN:   '📋 행정_지식베이스',
  PENDING: '✅ CS_승인대기',
  LOG:     '📝 CS_대화로그',
  GAP:     '⚠️ CS_미해결질문',
  FEEDBACK:'👍 챗봇피드백'          // [v3.1]
};

// ── 관리자 알림 이메일 (실제 주소로 교체) ──
const ADMIN_EMAIL_ = 'admin@example.com';

// ── 색상 팔레트 (앱과 통일) ──
const COLOR = {
  navy:   '#1B2F5E',
  teal:   '#2E7D9E',
  green:  '#1A8A5A',
  amber:  '#B87800',
  red:    '#C0392B',
  rowAlt: '#F4F9FC',
  okBg:   '#EAF7EF',
  warnBg: '#FFF8E8',
  failBg: '#FDECEC',
  grayBg: '#EEEEEE'
};


// ════════════════════════════════════════════════════════════════════════
// doPost / doGet 라우터
// (기존 함수가 있으면 case 분기만 합치세요)
// ════════════════════════════════════════════════════════════════════════
function doPost(e) {
  var data = {};
  var parseErr = '';
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    parseErr = String(err);
  }

  // 진단용: 모든 수신을 로그로 남김 (GAS 편집기 → 실행 → 로그에서 확인)
  try {
    Logger.log('[doPost] type=%s parseErr=%s raw=%s',
      data.type, parseErr,
      (e && e.postData && e.postData.contents || '').slice(0, 300));
  } catch (x) {}

  if (parseErr) {
    return jsonOut_({ ok: false, message: 'JSON 파싱 실패: ' + parseErr });
  }

  switch (data.type) {
    case 'chatbot_log':       return handleChatbotLog(data);
    case 'chatbot_feedback':  return handleChatbotFeedback(data);   // [v3.1] 👍/👎
    case 'resolution_report': return handleResolutionReport(data);
    case 'ai_proxy':          return handleAiProxy(data.payload);
  }
  return jsonOut_({ ok: false, message: 'unknown type: ' + data.type });
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'ping') return jsonOut_({ ok: true });   // 콜드스타트 예열용
  if (action === 'chatbot_kb') return getChatbotKB();
  if (action === 'admin_kb') return getAdminKB();
  if (action === 'kb_version') return getKbVersion();     // [v3.1] KB 버전 조회
  return jsonOut_({ ok: false, message: 'unknown action: ' + action });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ════════════════════════════════════════════════════════════════════════
// ① 대화 로그 기록
// ════════════════════════════════════════════════════════════════════════
function handleChatbotLog(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.LOG) || createLogSheet_(ss);

  const localTs     = fmtDate_(data.ts);
  const query       = data.query || '';
  const symptomName = data.symptomName || '미분류';
  const confidence  = data.confidence || 'none';
  const resolved    = data.resolved === true;
  const answer      = data.answer || '';
  const engineer    = data.engineer || activeUser_();

  const confLabel = { high:'높음', mid:'보통', low:'낮음', none:'없음' }[confidence] || confidence;
  const answerSummary = answer.length > 200 ? answer.slice(0, 200) + '…' : answer;

  sheet.appendRow([localTs, query, symptomName, confLabel,
                   resolved ? '✅ 해결' : '⚠️ 미해결', answerSummary, engineer]);

  const row = sheet.getLastRow();
  styleDataRow_(sheet, row, 7, resolved ? null : COLOR.failBg);

  // 미해결 → 보강 대상 시트에 누적
  if (!resolved) addGap_(ss, query, localTs);

  refreshDashboard_();   // 대시보드 자동 갱신
  checkAnomalyAndAlert_(); // 증상 급증 시 관리자 알림 (하루 1회)
  return jsonOut_({ ok: true, resolved: resolved });
}

// ════════════════════════════════════════════════════════════════════════
// ①-b [v3.1] 답변 피드백 기록 (👍/👎)
//   👍(Y): 기록만 / 👎(N): 보강상태 '확인필요' + 미해결 질문에도 누적
// ════════════════════════════════════════════════════════════════════════
function handleChatbotFeedback(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.FEEDBACK) || createFeedbackSheet_(ss);
  const verdict = (data.verdict === 'Y') ? 'Y' : 'N';

  sheet.appendRow([
    fmtDate_(data.ts),
    verdict === 'Y' ? '👍 Y' : '👎 N',
    data.question || '',
    data.answer || '',
    data.hospital || '',
    data.category || '',
    verdict === 'Y' ? '—' : '확인필요'
  ]);
  const row = sheet.getLastRow();
  styleDataRow_(sheet, row, 7, verdict === 'Y' ? COLOR.okBg : COLOR.warnBg);

  // 👎는 보강 루프(미해결 질문)에도 합류
  if (verdict === 'N' && data.question) addGap_(ss, data.question, fmtDate_(data.ts));

  refreshDashboard_();
  return jsonOut_({ ok: true, verdict: verdict });
}

function createFeedbackSheet_(ss) {
  const s = ss.insertSheet(SH.FEEDBACK);
  setHeader_(s, ['일시', '판정', '질문', '답변(증상)', '병원', '카테고리', '보강상태'],
                [140, 70, 280, 160, 140, 90, 90]);
  s.getRange('G1').setNote("👎(N) 피드백은 '확인필요'로 표시됩니다. 답변 보강 후 '반영완료'로 바꿔 관리하세요.");
  return s;
}

// ════════════════════════════════════════════════════════════════════════
// ①-c [v3.1] KB 버전 — 프런트(chatbot.html) 캐시 동기화용
//   KB가 바뀔 때마다 +1 → 프런트가 버전 변경 감지 시 캐시 버리고 전체 재수신
// ════════════════════════════════════════════════════════════════════════
const KB_VER_PROP_ = 'KB_VERSION';
function bumpKbVersion_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const cur = Number(props.getProperty(KB_VER_PROP_) || '1');
    props.setProperty(KB_VER_PROP_, String(cur + 1));
  } catch (e) {}
}
function getKbVersion() {
  const v = PropertiesService.getScriptProperties().getProperty(KB_VER_PROP_) || '1';
  return jsonOut_({ success: true, version: v });
}

// 미해결 질문 누적 (동일 질문은 횟수만 +1)
function addGap_(ss, query, localTs) {
  const gap = ss.getSheetByName(SH.GAP) || createGapSheet_(ss);
  const data = gap.getDataRange().getValues();
  const qNorm = normalize_(query);

  for (let i = 1; i < data.length; i++) {
    if (normalize_(data[i][1]) === qNorm) {
      gap.getRange(i + 1, 3).setValue((data[i][2] || 1) + 1);
      gap.getRange(i + 1, 4).setValue(localTs);   // 최근 발생 갱신
      return;
    }
  }
  gap.appendRow([localTs, query, 1, localTs, '미반영']);
  styleDataRow_(gap, gap.getLastRow(), 5, COLOR.warnBg);
}


// ════════════════════════════════════════════════════════════════════════
// ② 현장 해결책 → 승인 대기 (체크박스 승인)
// ════════════════════════════════════════════════════════════════════════
function handleResolutionReport(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.PENDING) || createPendingSheet_(ss);

  const localTs  = fmtDate_(data.ts);
  const engineer = data.engineer || activeUser_();

  // [승인(체크박스), 증상, 문제확인, 문제해결, 후속조치, 등록일시, 보고자, 상태]
  sheet.appendRow([
    false,
    data.symptom || '',
    data.check || '',
    data.fix || '',
    data.followup || '',
    localTs,
    engineer,
    '대기'
  ]);

  const row = sheet.getLastRow();
  sheet.getRange(row, 1).insertCheckboxes();           // 승인 체크박스
  styleDataRow_(sheet, row, 8, COLOR.warnBg);
  sheet.getRange(row, 2, 1, 7).setVerticalAlignment('top').setWrap(true);

  notifyAdmin_(data, engineer);
  refreshDashboard_();
  return jsonOut_({ ok: true, status: '승인대기 등록' });
}

/**
 * onEdit 트리거 — [v3.1] 승인 반영 + KB 수동 편집 버전 증가 통합
 */
function onEdit(e) {
  try {
    approvePendingOnEdit_(e);   // 승인대기 A열 체크 → 매뉴얼 반영
    kbManualEditBump_(e);       // 지식베이스/행정KB 직접 수정 → 버전 +1
  } catch (err) {
    // onEdit 오류는 조용히 무시 (시트 사용 방해 방지)
  }
}

/** [v3.1] 지식베이스·행정KB를 수동 편집하면 KB 버전 증가 → 프런트 캐시 무효화 */
function kbManualEditBump_(e) {
  const name = e.range.getSheet().getName();
  if (name !== SH.KB && name !== SH.ADMIN) return;
  bumpKbVersion_();
}

/**
 * 체크박스 승인 → 자동 매뉴얼 반영
 * 승인대기 시트의 A열 체크박스를 켜면 즉시 지식베이스로 이동.
 */
function approvePendingOnEdit_(e) {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SH.PENDING) return;
    if (e.range.getColumn() !== 1) return;     // A열(승인)만
    if (e.range.getRow() === 1) return;        // 헤더 제외
    if (e.value !== 'TRUE') return;            // 체크된 경우만

    const row = e.range.getRow();
    const vals = sheet.getRange(row, 1, 1, 8).getValues()[0];
    // [0]체크 [1]증상 [2]확인 [3]해결 [4]후속 [5]일시 [6]보고자 [7]상태
    const symptom  = vals[1];
    const check    = vals[2];
    const fix      = vals[3];
    const followup = vals[4];

    if (!symptom || !fix) {
      SpreadsheetApp.getActiveSpreadsheet().toast('증상·문제해결이 비어있어 반영하지 않았습니다.', '⚠️ 승인 실패');
      e.range.setValue(false);
      return;
    }

    // 지식베이스에 추가
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const kb = ss.getSheetByName(SH.KB) || createKbSheet_(ss);
    kb.appendRow([symptom, symptom, check, fix, followup, '현장반영 ' + fmtDate_()]);
    const kbRow = kb.getLastRow();
    kb.getRange(kbRow, 1, 1, 6).setVerticalAlignment('top').setWrap(true);
    styleDataRow_(kb, kbRow, 6, COLOR.okBg);

    // 승인대기 행 처리 완료 표시 — [v3.1] 반영된 KB 행 번호를 함께 기록
    sheet.getRange(row, 8).setValue('✅ 반영완료 (KB 행 ' + kbRow + ')');
    styleDataRow_(sheet, row, 8, COLOR.grayBg);

    bumpKbVersion_();           // [v3.1] KB 변경 → 버전 +1 (프런트 전체 동기화 유도)
    refreshDashboard_();
    ss.toast('"' + symptom + '" 매뉴얼에 반영됨. 챗봇이 곧 자동 응답합니다.', '✅ 승인 완료', 5);
}


// ════════════════════════════════════════════════════════════════════════
// ②-b 미해결 질문 → 키워드 흡수 (검색 품질 자가 개선 루프)
//   미해결질문 시트 F열(연결할 증상)에 증상명을 적고 이 함수를 실행하면,
//   그 질문에서 핵심어를 뽑아 지식베이스 해당 증상의 키워드(B열)에 병합한다.
//   → 같은 표현이 다음부턴 바로 매칭됨. 처리된 행은 '반영완료'로 표시.
// ════════════════════════════════════════════════════════════════════════
function absorbGapKeywords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gap = ss.getSheetByName(SH.GAP);
  const kb  = ss.getSheetByName(SH.KB);
  if (!gap || !kb) { ss.toast('시트를 찾을 수 없습니다.', '⚠️', 5); return; }
  if (gap.getLastRow() < 2) { ss.toast('미해결 질문이 없습니다.', 'ℹ️', 4); return; }

  // 지식베이스 증상명 → 행 번호 매핑
  const kbVals = kb.getRange(2, 1, kb.getLastRow() - 1, 2).getValues(); // [증상, 키워드]
  const symptomRow = {};   // 증상명 → 실제 시트 행번호
  const symptomKw  = {};   // 증상명 → 현재 키워드 문자열
  kbVals.forEach((r, i) => {
    const name = String(r[0]).trim();
    if (name) { symptomRow[name] = i + 2; symptomKw[name] = String(r[1] || ''); }
  });

  const gapVals = gap.getRange(2, 1, gap.getLastRow() - 1, 6).getValues();
  let absorbed = 0, skipped = 0;
  const notFound = [];

  for (let i = 0; i < gapVals.length; i++) {
    const row      = gapVals[i];
    const question = String(row[1] || '').trim();   // B열: 질문
    const status   = String(row[4] || '').trim();   // E열: 상태
    const target   = String(row[5] || '').trim();   // F열: 연결할 증상

    if (!target) continue;                  // 증상 미지정 → 건너뜀
    if (status === '반영완료') continue;     // 이미 처리됨

    if (!symptomRow[target]) {              // 지식베이스에 없는 증상명
      notFound.push(target);
      skipped++;
      continue;
    }

    // 질문에서 키워드 추출 → 기존 키워드와 병합 (중복 제거)
    const newWords = extractKeywords_(question);
    if (!newWords.length) { skipped++; continue; }

    const existing = symptomKw[target].split(',').map(s => s.trim()).filter(Boolean);
    const merged = existing.slice();
    newWords.forEach(w => {
      // 이미 있거나, 기존 키워드의 일부로 포함되면 추가 안 함
      const dup = merged.some(e => e === w || e.includes(w) || w.includes(e));
      if (!dup) merged.push(w);
    });

    // 변화가 있을 때만 기록
    if (merged.length !== existing.length) {
      const mergedStr = merged.join(',');
      kb.getRange(symptomRow[target], 2).setValue(mergedStr);
      symptomKw[target] = mergedStr;   // 같은 증상에 여러 질문이 매핑될 때 누적 반영
    }

    // 미해결 행을 '반영완료'로 표시
    gap.getRange(i + 2, 5).setValue('반영완료');
    absorbed++;
  }

  refreshDashboard_();

  let msg = absorbed + '건의 질문을 키워드로 흡수했습니다.';
  if (skipped) msg += ' (' + skipped + '건 건너뜀)';
  if (notFound.length) {
    msg += '\n\n⚠️ 지식베이스에 없는 증상: ' + [...new Set(notFound)].join(', ')
         + '\n→ 먼저 해당 증상을 지식베이스에 추가하세요.';
  }
  ss.toast(msg, '✅ 키워드 흡수 완료', 8);
}

// 질문 문장에서 검색 키워드를 추출.
//   한국어는 형태소 분석 없이 잘게 쪼개면 "노즐에서·안켜져요" 같은 어색한
//   토큰이 생긴다. 그래서 (1) 의미 있는 명사형 토큰 + (2) 질문 원문(정제본)을
//   함께 키워드로 넣는다. 챗봇 rankSymptoms가 부분일치로 매칭하므로,
//   원문을 통째로 넣어두는 편이 매칭률이 가장 높고 안전하다.
function extractKeywords_(text) {
  if (!text) return [];
  const clean = String(text).replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, ' ')
                            .replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const result = [];

  // (1) 정제된 질문 원문 자체를 키워드로 (너무 길면 제외)
  if (clean.length <= 25) result.push(clean);

  // (2) 어미·조사를 가볍게 떼어낸 2글자 이상 토큰 (불용어 제외)
  const STOP = ['그리고','근데','그런데','해서','하는데','했는데','입니다','이에요',
                '인데','에서','으로','한테','까지','부터','계속','자꾸','갑자기','너무',
                '약간','조금','그냥','이게','저게','해요','돼요','되요','이거','저거',
                '뭔가','관련','증상','문제','발생','확인','어떻게','왜','잘','안해','안됨'];
  const trimJosa = w => w.replace(/(이|가|을|를|은|는|에|의|도|만|와|과|랑|에서|으로|에요|어요|아요|졌어요|습니다)$/,'');

  const seen = new Set(result);
  clean.split(' ').forEach(w0 => {
    const w = trimJosa(w0);
    if (w.length >= 2 && !STOP.includes(w) && !seen.has(w)) {
      seen.add(w); result.push(w);
    }
  });
  return result;
}


// ════════════════════════════════════════════════════════════════════════
// ③ 지식베이스 제공 (챗봇이 읽어감)
// ════════════════════════════════════════════════════════════════════════
function getChatbotKB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.KB);
  if (!sheet || sheet.getLastRow() < 2) {
    return jsonOut_({ success: false, data: [], message: '지식베이스 비어있음' });
  }
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i][0] || !String(values[i][0]).trim()) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = String(values[i][idx] || '').trim(); });
    rows.push(obj);
  }
  return jsonOut_({ success: true, data: rows, count: rows.length });
}

// 행정 지식베이스 제공 (챗봇 '사내 행정' 탭이 읽어감)
function getAdminKB() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH.ADMIN);
  if (!sheet || sheet.getLastRow() < 2) {
    return jsonOut_({ success: false, data: [], message: '행정 지식베이스 비어있음' });
  }
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i][0] || !String(values[i][0]).trim()) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = String(values[i][idx] || '').trim(); });
    rows.push(obj);
  }
  return jsonOut_({ success: true, data: rows, count: rows.length });
}


// ════════════════════════════════════════════════════════════════════════
// ④ Claude API 프록시 (API 키 보호)
// ════════════════════════════════════════════════════════════════════════
function handleAiProxy(payload) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return jsonOut_({ error: 'ANTHROPIC_API_KEY 미설정' });
  try {
    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const json = JSON.parse(resp.getContentText());
    const text = (json.content && json.content[0] && json.content[0].text) || '';
    return jsonOut_({ text: text });
  } catch (e) {
    return jsonOut_({ error: 'AI 호출 실패: ' + e.message });
  }
}


// ════════════════════════════════════════════════════════════════════════
// ⑤ 대시보드 — 한눈에 보는 요약
// ════════════════════════════════════════════════════════════════════════
function refreshDashboard_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SH.DASH) || createDashSheet_(ss);

  const kb      = ss.getSheetByName(SH.KB);
  const log     = ss.getSheetByName(SH.LOG);
  const gap     = ss.getSheetByName(SH.GAP);
  const pending = ss.getSheetByName(SH.PENDING);

  const kbCount      = kb      ? Math.max(0, kb.getLastRow() - 1) : 0;
  const logCount     = log     ? Math.max(0, log.getLastRow() - 1) : 0;
  const gapCount     = gap     ? countUnresolved_(gap) : 0;
  const pendingCount = pending ? countPending_(pending) : 0;

  // 핵심 지표 (B2~B5)
  dash.getRange('B2').setValue(kbCount);
  dash.getRange('B3').setValue(logCount);
  dash.getRange('B4').setValue(pendingCount);
  dash.getRange('B5').setValue(gapCount);
  dash.getRange('B6').setValue(fmtDate_());

  // 자주 묻는 증상 TOP 5 (대화로그 집계)
  writeTopSymptoms_(dash, log);

  // 미해결 질문 TOP 5 (보강 대상)
  writeTopGaps_(dash, gap);
}

function countUnresolved_(gap) {
  const data = gap.getDataRange().getValues();
  let c = 0;
  for (let i = 1; i < data.length; i++) if (data[i][4] !== '반영완료') c++;
  return c;
}
function countPending_(pending) {
  const data = pending.getDataRange().getValues();
  let c = 0;
  for (let i = 1; i < data.length; i++) if (data[i][7] === '대기') c++;
  return c;
}

function writeTopSymptoms_(dash, log) {
  dash.getRange('A9:B14').clearContent();
  if (!log || log.getLastRow() < 2) { dash.getRange('A9').setValue('(데이터 없음)'); return; }
  const data = log.getRange(2, 3, log.getLastRow() - 1, 1).getValues(); // 증상 컬럼
  const freq = {};
  data.forEach(r => { const s = r[0] || '미분류'; if (s !== '미해결') freq[s] = (freq[s] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  top.forEach((t, i) => {
    dash.getRange(9 + i, 1).setValue(t[0]);
    dash.getRange(9 + i, 2).setValue(t[1]);
  });
}

function writeTopGaps_(dash, gap) {
  dash.getRange('D9:E14').clearContent();
  if (!gap || gap.getLastRow() < 2) { dash.getRange('D9').setValue('(없음 👍)'); return; }
  const data = gap.getRange(2, 1, gap.getLastRow() - 1, 5).getValues();
  const rows = data.filter(r => r[4] !== '반영완료')
                   .sort((a, b) => (b[2] || 1) - (a[2] || 1)).slice(0, 5);
  if (!rows.length) { dash.getRange('D9').setValue('(없음 👍)'); return; }
  rows.forEach((r, i) => {
    dash.getRange(9 + i, 4).setValue(String(r[1]).slice(0, 40));
    dash.getRange(9 + i, 5).setValue(r[2] + '회');
  });
}


// ════════════════════════════════════════════════════════════════════════
// ⑥ 시트 생성·서식 (setupAllSheets 1회 실행)
// ════════════════════════════════════════════════════════════════════════
function setupAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH.KB))      createKbSheet_(ss);
  if (!ss.getSheetByName(SH.ADMIN))   createAdminSheet_(ss);
  if (!ss.getSheetByName(SH.PENDING)) createPendingSheet_(ss);
  if (!ss.getSheetByName(SH.LOG))     createLogSheet_(ss);
  if (!ss.getSheetByName(SH.GAP))     createGapSheet_(ss);
  if (!ss.getSheetByName(SH.FEEDBACK))createFeedbackSheet_(ss);   // [v3.1]
  if (!ss.getSheetByName(SH.DASH))    createDashSheet_(ss);

  // 대시보드를 맨 앞으로
  const dash = ss.getSheetByName(SH.DASH);
  ss.setActiveSheet(dash); ss.moveActiveSheet(1);

  refreshDashboard_();
  SpreadsheetApp.getUi().alert('모든 시트를 생성하고 서식을 적용했습니다.\n📊 대시보드부터 확인하세요.');
}

// 공통: 헤더 서식
function setHeader_(sheet, headers, widths) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground(COLOR.navy).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(11).setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
  if (widths) widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// 공통: 데이터 행 서식 (줄무늬 + 강조색)
function styleDataRow_(sheet, row, cols, bg) {
  const range = sheet.getRange(row, 1, 1, cols);
  range.setFontSize(10).setVerticalAlignment('top');
  if (bg) range.setBackground(bg);
  else if (row % 2 === 0) range.setBackground(COLOR.rowAlt);
}

// 사내 행정 지식베이스 시트 (질문→답변·절차 형식)
// 챗봇 필드명과 일치: 증상=항목명, 키워드, 답변, 절차, 링크
function createAdminSheet_(ss) {
  const s = ss.insertSheet(SH.ADMIN);
  setHeader_(s, ['증상', '키워드', '답변', '절차', '링크'],
                [160, 200, 360, 320, 200]);
  s.getRange('A1').setNote('행정·총무 FAQ를 등록하세요. "증상"칸엔 질문 제목, "답변"은 핵심 답, "절차"는 단계, "링크"는 관련 위치/메모.');
  const seed = [
    ['월급일·급여 지급일', '월급,급여일,월급날,급여 지급,봉급,페이데이,월급 언제',
     '급여는 매월 25일에 지급됩니다. (25일이 주말·공휴일이면 직전 영업일 지급)',
     '', '※ 급여명세서: ERP > 급여명세서'],
    ['연차·휴가 신청 방법', '연차,휴가,월차,반차,휴가 신청,연차 신청,쉬는,휴무',
     '연차는 전자결재로 최소 3일 전 상신, 팀장 승인 후 확정됩니다.',
     '1) 전자결재 접속\n2) [휴가신청서] 선택\n3) 기간·사유 입력 후 상신\n4) 팀장 승인 확인',
     '※ 잔여 연차: ERP > 근태관리'],
    ['전자결재 상신 방법', '전자결재,결재,상신,품의,기안,결재 올리',
     '그룹웨어 전자결재에서 양식을 선택해 작성·상신합니다.',
     '1) 그룹웨어 > 전자결재\n2) 양식 선택\n3) 내용 작성\n4) 결재선 지정 후 상신',
     '※ 결재선 문의: 팀 어시스턴트'],
    ['ERP 비용 처리·경비 청구', 'erp,경비,비용 처리,지출,청구,법인카드,영수증,정산',
     'ERP 경비청구 메뉴에서 영수증을 첨부해 등록합니다. 매월 말일 등록분이 익월 급여와 정산됩니다.',
     '1) ERP > 경비청구\n2) 항목·금액 입력\n3) 영수증 첨부\n4) 상신',
     '※ 계정과목 문의: 재무팀'],
    ['출장 신청·정산', '출장,출장비,출장 신청,출장 정산,여비,교통비',
     '출장 전 전자결재로 신청, 복귀 후 ERP에서 정산합니다.',
     '1) 출장 전: 전자결재 [출장신청서]\n2) 출장 후: ERP > 출장정산\n3) 영수증·교통비 입력',
     '※ 일비·숙박 한도: 사내 규정집']
  ];
  s.getRange(2, 1, seed.length, 5).setValues(seed)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
  for (let i = 0; i < seed.length; i++) styleDataRow_(s, i + 2, 5, null);
  return s;
}

function createKbSheet_(ss) {
  const s = ss.insertSheet(SH.KB);
  setHeader_(s, ['증상', '키워드', '문제 확인', '문제 해결', '후속 조치', '비고'],
                [140, 160, 280, 280, 280, 130]);
  // 시드 데이터
  const seed = [
    ['메인보드 동작 불능', '메인보드,전원 안,켜지지',
     '1) 전원 동작 여부 확인\n2) 메인보드 LED 빨간색 점등 확인\n3) Water pump·TouchScreen 동작 확인',
     '1) 메인보드 교체\n2) F/W·UI Ver 확인 (필요 시 업데이트)',
     '전원 후 약 10분 에이징 → JET TEST → 정상 확인', '기본 매뉴얼'],
    ['풋 스위치 동작 불능', '풋스위치,발판,페달',
     '1) 풋스위치 동작 시 LED 신호 발생 확인\n2) Handpiece 동작 확인\n3) 이상 소음 확인',
     '1) LED 신호 미발생 → 풋스위치 A\'ssy 교체\n2) Handpiece 불능 → Handpiece A\'ssy 교체',
     '반복 테스트로 정상 작동 확인', '기본 매뉴얼'],
    ['RFID 스캔 불량', 'rfid,노즐 인식,스캔',
     '1) RFID 인식음 발생 확인\n2) Device not recognized 팝업 확인\n3) Please scan again 반복 확인',
     '1) RFID Cable 연결 확인\n2) 신규 노즐 적용\n3) 반복 시 UI 재업데이트\n※ 인식음 미발생 시 RFID A\'ssy 교체',
     '전원 후 약 10분 에이징 → RFID TAG 테스트', '기본 매뉴얼'],
    ['냉각수 누수', '냉각수,누수,물 새',
     '1) 누수 지점 확인 (내부·Handpiece)\n2) Water tank 냉각수량 확인 (700~800ml)',
     '1) 누수 원인 제거·교체\n2) 냉각수 보충\n3) 주변 물기 제거',
     '전원 후 약 10분 에이징 → 추가 누수 확인', '기본 매뉴얼']
  ];
  s.getRange(2, 1, seed.length, 6).setValues(seed)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
  for (let i = 0; i < seed.length; i++) styleDataRow_(s, i + 2, 6, null);
  return s;
}

function createPendingSheet_(ss) {
  const s = ss.insertSheet(SH.PENDING);
  setHeader_(s, ['승인', '증상', '문제 확인', '문제 해결', '후속 조치', '등록일시', '보고자', '상태'],
                [50, 130, 240, 240, 240, 140, 100, 90]);
  // 안내 메모
  s.getRange('A1').setNote('A열 체크박스를 켜면 해당 해결책이 즉시 매뉴얼(지식베이스)에 반영됩니다.');
  return s;
}

function createLogSheet_(ss) {
  const s = ss.insertSheet(SH.LOG);
  setHeader_(s, ['일시', '질문', '매칭 증상', '신뢰도', '해결여부', '답변 요약', '엔지니어'],
                [140, 240, 130, 70, 90, 320, 100]);
  return s;
}

function createGapSheet_(ss) {
  const s = ss.insertSheet(SH.GAP);
  setHeader_(s, ['최초 발생', '질문', '발생 횟수', '최근 발생', '상태', '연결할 증상'],
                [140, 300, 80, 140, 90, 160]);
  s.getRange('B1').setNote('여기 쌓인 질문에 답을 정리해 지식베이스에 추가하면 챗봇이 자동 응답합니다.');
  s.getRange('F1').setNote('이 질문이 어떤 증상인지 골라(드롭다운) 메뉴 "④ 미해결 질문 → 키워드 흡수"를 실행하면, 질문이 해당 증상의 검색 키워드로 추가됩니다.');
  applyGapSymptomValidation_(ss, s);  // F열에 증상 드롭다운 적용
  return s;
}

// 미해결질문 F열(연결할 증상)에 지식베이스 증상명 드롭다운을 건다.
function applyGapSymptomValidation_(ss, gapSheet) {
  const kb = ss.getSheetByName(SH.KB);
  if (!kb || kb.getLastRow() < 2) return;
  const names = kb.getRange(2, 1, kb.getLastRow() - 1, 1).getValues()
                  .map(r => String(r[0]).trim()).filter(Boolean);
  if (!names.length) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(names, true)
    .setAllowInvalid(true)   // 새 증상명 직접 입력도 허용
    .build();
  // 2행부터 200행까지 넉넉히 적용
  gapSheet.getRange(2, 6, 200, 1).setDataValidation(rule);
}

function createDashSheet_(ss) {
  const s = ss.insertSheet(SH.DASH);
  s.setHiddenGridlines(true);

  // 제목
  s.getRange('A1:E1').merge().setValue('📊 BAZ CS AI 챗봇 대시보드')
    .setBackground(COLOR.navy).setFontColor('#FFFFFF')
    .setFontSize(15).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(1, 44);

  // 핵심 지표 (A2~B6)
  const metrics = [
    ['📖 매뉴얼 항목 수', 0],
    ['💬 누적 질문 수', 0],
    ['✅ 승인 대기', 0],
    ['⚠️ 미해결 질문', 0],
    ['🕒 최근 갱신', '']
  ];
  s.getRange(2, 1, metrics.length, 2).setValues(metrics);
  s.getRange('A2:A6').setFontWeight('bold').setBackground('#EAF4F8').setFontSize(11);
  s.getRange('B2:B6').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  s.getRange('B4').setFontColor(COLOR.amber);
  s.getRange('B5').setFontColor(COLOR.red);

  // TOP 5 섹션 헤더
  s.getRange('A8').setValue('🔥 자주 묻는 증상 TOP 5')
    .setFontWeight('bold').setBackground(COLOR.teal).setFontColor('#FFFFFF');
  s.getRange('B8').setBackground(COLOR.teal);
  s.getRange('D8').setValue('⚠️ 매뉴얼 보강 필요 TOP 5')
    .setFontWeight('bold').setBackground(COLOR.amber).setFontColor('#FFFFFF');
  s.getRange('E8').setBackground(COLOR.amber);

  // 컬럼 폭
  [200, 90, 30, 280, 90].forEach((w, i) => s.setColumnWidth(i + 1, w));

  // 안내
  s.getRange('A16').setValue('💡 사용법: ✅ 승인대기 시트에서 체크박스를 켜면 해결책이 자동으로 📖 지식베이스에 반영됩니다.')
    .setFontSize(10).setFontColor('#6B7A99');
  s.getRange('A16:E16').merge();

  return s;
}


// ════════════════════════════════════════════════════════════════════════
// ⑦ 알림·리포트·메뉴
// ════════════════════════════════════════════════════════════════════════
function notifyAdmin_(data, engineer) {
  try {
    MailApp.sendEmail(ADMIN_EMAIL_, '[BAZ CS] 현장 해결책 승인 대기',
      '증상: ' + (data.symptom || '-') + '\n' +
      '해결: ' + (data.fix || '-') + '\n' +
      '보고자: ' + engineer + '\n\n' +
      '→ "✅ CS_승인대기" 시트에서 체크박스를 켜면 매뉴얼에 반영됩니다.');
  } catch (e) {}
}

function weeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  refreshDashboard_();
  const dash = ss.getSheetByName(SH.DASH);

  const insights = buildInsights_();   // 인사이트 분석

  let body =
    '[BAZ CS AI 챗봇 주간 리포트]\n\n' +
    '■ 핵심 지표\n' +
    '· 매뉴얼 항목: ' + dash.getRange('B2').getValue() + '건\n' +
    '· 누적 질문: '   + dash.getRange('B3').getValue() + '건\n' +
    '· 승인 대기: '   + dash.getRange('B4').getValue() + '건\n' +
    '· 미해결 질문: ' + dash.getRange('B5').getValue() + '건\n\n';

  if (insights.topWeekly.length) {
    body += '■ 이번 주 자주 묻는 증상 TOP 5\n';
    insights.topWeekly.forEach((t, i) => {
      body += '  ' + (i+1) + '. ' + t[0] + ' (' + t[1] + '건)\n';
    });
    body += '\n';
  }

  if (insights.surges.length) {
    body += '⚠️ 급증 감지 (지난주 대비 2배 이상)\n';
    insights.surges.forEach(s => {
      body += '  · ' + s.name + ': ' + s.prev + '건 → ' + s.curr + '건\n';
    });
    body += '\n선제 대응(부품 재고·펌웨어 점검 등)을 검토하세요.\n\n';
  }

  if (insights.topGaps.length) {
    body += '■ 매뉴얼 보강 필요 (미해결 누적 TOP 5)\n';
    insights.topGaps.forEach((g, i) => {
      body += '  ' + (i+1) + '. ' + g.q + ' (' + g.cnt + '회)\n';
    });
    body += '\n';
  }

  body += '자세한 내용은 📊 대시보드를 확인하세요.';
  MailApp.sendEmail(ADMIN_EMAIL_, '[BAZ CS] 주간 리포트 + 인사이트', body);
}

// 로그를 분석해 인사이트 추출
function buildInsights_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(SH.LOG);
  const gap = ss.getSheetByName(SH.GAP);

  const result = { topWeekly: [], surges: [], topGaps: [] };
  if (!log || log.getLastRow() < 2) return result;

  const data = log.getRange(2, 1, log.getLastRow() - 1, 3).getValues(); // [일시, 질문, 증상]
  const now = new Date();
  const weekAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const twoWeeks = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeek = {}, lastWeek = {};
  data.forEach(row => {
    const ts = new Date(row[0]);
    const sym = row[2] || '미분류';
    if (sym === '미해결') return;
    if (ts >= weekAgo)               thisWeek[sym] = (thisWeek[sym] || 0) + 1;
    else if (ts >= twoWeeks)         lastWeek[sym] = (lastWeek[sym] || 0) + 1;
  });

  // 이번 주 TOP 5
  result.topWeekly = Object.entries(thisWeek).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // 급증 감지: 이번 주 3건 이상 + 지난주 대비 2배 이상
  Object.keys(thisWeek).forEach(sym => {
    const curr = thisWeek[sym];
    const prev = lastWeek[sym] || 0;
    if (curr >= 3 && curr >= (prev + 1) * 2) {
      result.surges.push({ name: sym, curr: curr, prev: prev });
    }
  });
  result.surges.sort((a,b)=>b.curr-a.curr);

  // 미해결 보강 대상 TOP 5
  if (gap && gap.getLastRow() >= 2) {
    const g = gap.getRange(2, 1, gap.getLastRow()-1, 5).getValues();
    result.topGaps = g.filter(r=>r[4]!=='반영완료')
                      .sort((a,b)=>(b[2]||1)-(a[2]||1)).slice(0,5)
                      .map(r=>({ q:String(r[1]).slice(0,40), cnt:r[2]||1 }));
  }
  return result;
}

// 실시간 급증 알림 — handleChatbotLog에서 호출 (하루 1회만 알림)
function checkAnomalyAndAlert_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  if (props.getProperty('lastAlertDate') === today) return; // 오늘 이미 알림 보냄

  const insights = buildInsights_();
  if (!insights.surges.length) return;

  let body = '[BAZ CS] ⚠️ 증상 급증 감지\n\n';
  insights.surges.forEach(s => {
    body += '· ' + s.name + ': 지난주 ' + s.prev + '건 → 이번 주 ' + s.curr + '건\n';
  });
  body += '\n부품 재고·펌웨어 이슈를 선제 점검하세요.\n📊 대시보드에서 상세 확인 가능합니다.';

  MailApp.sendEmail(ADMIN_EMAIL_, '[BAZ CS] ⚠️ 증상 급증 알림', body);
  props.setProperty('lastAlertDate', today);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 CS 챗봇')
    .addItem('① 전체 시트 생성·서식', 'setupAllSheets')
    .addItem('② 대시보드 새로고침', 'refreshDashboard_')
    .addItem('③ 주간 리포트 + 인사이트 발송', 'weeklyReport')
    .addSeparator()
    .addItem('④ 미해결 질문 → 키워드 흡수', 'absorbGapKeywords')
    .addItem('⑤ 증상 드롭다운 새로고침', 'refreshGapDropdown')
    .addToUi();
}

// 지식베이스 증상이 늘어났을 때 미해결질문 F열 드롭다운을 갱신
function refreshGapDropdown() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gap = ss.getSheetByName(SH.GAP);
  if (!gap) { ss.toast('미해결질문 시트가 없습니다.', '⚠️', 4); return; }
  applyGapSymptomValidation_(ss, gap);
  ss.toast('증상 드롭다운을 새로고침했습니다.', '✅', 4);
}


// ════════════════════════════════════════════════════════════════════════
// 유틸리티
// ════════════════════════════════════════════════════════════════════════
function fmtDate_(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}
function normalize_(q) {
  return String(q).toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
}
function activeUser_() {
  try { return Session.getActiveUser().getEmail() || '알 수 없음'; }
  catch (e) { return '알 수 없음'; }
}