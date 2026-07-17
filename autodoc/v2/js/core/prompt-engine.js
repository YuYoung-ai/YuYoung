/************************************************************
 * prompt-engine.js — Prompt 자동 생성 (PROMPT_ENGINE.md)
 * ----------------------------------------------------------
 * 6축(문서·AI·목적·형식·난이도·언어) 조합으로 Import 용 Prompt 발급.
 * AI 에게는 항상 JSON Contract(autodoc.analysis.v1)만 요청.
 * S5: Analyzer 시드 + Golden 우선(없으면 조립).
 ************************************************************/
export const CONTRACT = 'autodoc.analysis.v1';

const ANALYZERS = {
  'ppt-analyzer': { label: 'PPT 분석기', docTypes: ['pptx', 'ppt'] },
  'word-analyzer': { label: 'Word 분석기', docTypes: ['docx', 'doc'] },
  'excel-analyzer': { label: 'Excel 분석기', docTypes: ['xlsx', 'xls', 'csv'] },
  'pdf-analyzer': { label: 'PDF 분석기', docTypes: ['pdf'] },
  'report-analyzer': { label: '보고서 분석기', docTypes: ['report'] },
  'voc-analyzer': { label: 'VOC 분석기', docTypes: ['voc'] },
};

function detectAnalyzer(docType) {
  const t = String(docType || '').toLowerCase().replace(/^\./, '');
  for (const [id, a] of Object.entries(ANALYZERS)) if (a.docTypes.includes(t)) return id;
  return 'report-analyzer';
}

const PAYLOAD_HINT = `{
    "writingStyle": { "tone": "개조식|서술식", "honorific": true|false, "numberFormat": "1,234" },
    "colorRule": { "primary": "#RRGGBB", "accent": "#RRGGBB" },
    "sectionOrder": { "<문서종류>": ["섹션1","섹션2","..."] },
    "tableRule": { "headerFill": "primary|accent|none", "zebra": true|false },
    "terms": [ { "canonical": "표준표기", "synonyms": ["이표기","저표기"] } ],
    "template": {
      "name": "양식 이름", "desc": "용도 한 줄", "category": "보고서|회의|기타",
      "inputs": [
        { "key": "englishKey", "label": "항목 이름", "type": "text|textarea|number|date|week|select|table", "required": true|false,
          "options": ["select일 때만"],
          "columns": [ { "key": "colKey", "label": "열 이름" } ] }
      ]
    }
  }`;

export const promptEngine = {
  analyzers() { return Object.entries(ANALYZERS).map(([id, a]) => ({ id, label: a.label })); },

  /** axes = { docType, purpose, ai, language, level } */
  issue(axes = {}) {
    const analyzer = axes.analyzer || detectAnalyzer(axes.docType);
    const version = 'v1';
    const language = axes.language || 'ko';
    const body =
`아래 "회사 문서"를 분석하여 우리 회사의 문서 규칙을 추출하세요.
반드시 아래 JSON 하나만 출력하세요. 설명·마크다운·코드펜스 금지. JSON 이 아니면 오류로 처리됩니다.

{
  "contract": "${CONTRACT}",
  "analyzer": "${analyzer}",
  "promptVersion": "${version}",
  "language": "${language}",
  "confidence": 0.0~1.0,
  "payload": ${PAYLOAD_HINT},
  "warnings": ["확신 못한 부분"]
}

규칙:
- 문서에서 실제로 관찰된 것만 채우고, 모르면 그 키를 생략하세요.
- confidence 는 전체 추출 신뢰도(0~1).
- payload 의 각 항목은 회사 표준으로 삼을 값입니다.
- template 은 이 문서를 다시 만들 때 채워야 할 빈칸(입력 항목) 구조입니다.
  반복되는 목록/표는 type "table"+columns 로, 긴 글은 "textarea" 로 추출하세요.

[회사 문서]
<여기에 문서 내용을 붙여넣으세요>`;
    return { promptId: `${analyzer}.${axes.purpose || 'structure'}.${axes.ai || 'any'}.${language}`, version, analyzer, golden: false, body };
  },

  /** Import Gate 오류 시 교정 재요청 Prompt */
  reissue(instance, importError) {
    const extra = `\n\n[재요청] 이전 응답 오류: ${importError || '형식 위반'}. 반드시 JSON 하나만, 위 스키마대로 다시 출력하세요.`;
    return { ...instance, body: instance.body + extra };
  },
};
