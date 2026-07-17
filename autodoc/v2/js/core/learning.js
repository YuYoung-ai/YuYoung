/************************************************************
 * learning.js — 학습 파이프라인 클라이언트 (LEARNING_ENGINE.md)
 * ----------------------------------------------------------
 * analysis 봉투 → Learning Proposal → import.submit(GAS)
 * 승인함 조회/결정 · 승인 시 DNA(자동 반영) / KB(용어 등록).
 * I2: 반영은 승인 통과분만.
 ************************************************************/
import { api } from '../infra/api.js';
import { confidence } from './confidence.js';
import { templateService } from './template-service.js';
import { bus } from '../infra/bus.js';

const DNA_FIELDS = ['writingStyle', 'colorRule', 'sectionOrder', 'tableRule', 'brandRule', 'fontRule'];

export const learning = {
  /** analysis 봉투 → 사람이 검토할 제안 목록 (미제출) */
  proposalsFromEnvelope(env) {
    const out = [];
    const c = Number(env.confidence) || 0;
    const p = env.payload || {};
    for (const k of DNA_FIELDS) {
      if (p[k] == null) continue;
      out.push({
        kind: 'dna', label: `회사 규칙: ${k}`, after: p[k], confidence: c, grade: confidence.grade(c),
        analysis: { analyzer: env.analyzer, promptVersion: env.promptVersion, target: { store: 'DNA', path: k }, after: p[k], confidence: c },
      });
    }
    for (const t of (p.terms || [])) {
      if (!t || !t.canonical) continue;
      out.push({
        kind: 'kb', label: `용어: ${t.canonical}`, after: t, confidence: c, grade: confidence.grade(c),
        analysis: { analyzer: env.analyzer, promptVersion: env.promptVersion, kbTerm: { canonical: t.canonical, synonyms: t.synonyms || [] }, confidence: c },
      });
    }
    if (p.template && typeof p.template === 'object') {
      const tpl = templateService.normalizeImported(p.template);
      out.push({
        kind: 'template', label: `양식: ${tpl.name}`, after: { id: tpl.id, inputs: tpl.inputs.length }, confidence: c, grade: confidence.grade(c),
        analysis: { analyzer: env.analyzer, promptVersion: env.promptVersion, template: tpl, confidence: c },
      });
    }
    return out;
  },

  /** 선택된 제안들을 승인함(GAS)에 제출 */
  async submit(proposals) {
    let count = 0;
    for (const pr of proposals) {
      await api.request('v2.import.submit', { analysis: pr.analysis, grade: pr.grade });
      count += 1;
    }
    bus.publish('analysis.imported', { count });
    return { count };
  },

  async queue(grade) { return (await api.request('v2.learning.queue', grade ? { grade } : {})).items || []; },

  /** 승인/반려/수정. 승인이면 DNA 는 GAS 가 자동 반영, KB 용어·양식은 여기서 등록. */
  async decide(item, decision, reason, correction) {
    const res = await api.request('v2.learning.decide', { id: item.id, decision, reason: reason || '', correction: correction || null });
    const approved = decision === 'approved' || decision === 'corrected';
    if (approved && item.analysis && item.analysis.kbTerm) {
      const t = item.analysis.kbTerm;
      const id = 'kb-' + String(t.canonical).toLowerCase().replace(/\s+/g, '-');
      await api.request('v2.kb.decide', { record: { id, canonical: t.canonical, synonyms: t.synonyms || [], status: 'active' }, decision: 'active' }).catch(() => {});
    }
    if (approved && item.analysis && item.analysis.template) {
      // KB 와 같은 승인-반영 패턴: 승인된 양식을 Templates 컬렉션에 등록 → 카탈로그 노출
      await api.request('v2.template.save', { record: item.analysis.template });
    }
    bus.publish('approval.decided', { id: item.id, decision });
    return res;
  },

  async dna() { return api.request('v2.dna.get', {}).catch(() => ({ ver: 0, json: {} })); },
  async kbList() { return (await api.request('v2.kb.list', {}).catch(() => ({ items: [] }))).items || []; },
  async goldenList() { return (await api.request('v2.template.list', {}).catch(() => ({ items: [] }))).items || []; },
};
