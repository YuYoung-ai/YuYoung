/************************************************************
 * confidence.js — 신뢰도 등급 (CONFIDENCE_ENGINE.md)
 * ----------------------------------------------------------
 * 98 자동 / 90 추천 / 80 관리자 확인 / 60 질문 / 그 이하 보류.
 ************************************************************/
const THRESHOLDS = { auto: 0.98, recommend: 0.90, review: 0.80, question: 0.60 };

export const confidence = {
  thresholds() { return { ...THRESHOLDS }; },
  grade(c) {
    const v = Number(c) || 0;
    if (v >= THRESHOLDS.auto) return 'auto';
    if (v >= THRESHOLDS.recommend) return 'recommend';
    if (v >= THRESHOLDS.review) return 'review';
    if (v >= THRESHOLDS.question) return 'question';
    return 'hold';
  },
  label(grade) {
    return { auto: '자동 적용', recommend: '추천', review: '관리자 확인', question: '질문', hold: '보류' }[grade] || grade;
  },
};
