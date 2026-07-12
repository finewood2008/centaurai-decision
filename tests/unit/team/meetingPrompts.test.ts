/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  MEETING_FORMS,
  MAX_DEBATE_ROUNDS,
  buildAdaptivePanelistResponses,
  buildClusterPrompt,
  buildConvergePrompt,
  buildDivergePrompt,
  buildDraftPrompt,
  buildProposalPrompt,
  buildModeratorDebateMovePrompt,
  buildRedTeamPrompt,
  buildRevisePrompt,
  hasValidMeetingSpeech,
  hasResolutionOptions,
  matchSpeakerName,
  parseModeratorMove,
  parsePlan,
  parseResolutionOptions,
  parseScribe,
  stripResolutionMarkers,
} from '@/renderer/pages/team/meeting/meetingPrompts';

describe('meeting resolution parsing', () => {
  const synth = [
    'intro prose',
    '@@PLAN@@',
    '## 推荐方案\n做 A 再做 B',
    '@@END_PLAN@@',
    '@@OPTION@@ 方案一',
    '核心思路：稳健',
    '@@END@@',
    '@@OPTION@@ 方案二',
    '核心思路：激进',
    '@@END@@',
  ].join('\n');

  it('parses every option block (title + body)', () => {
    const opts = parseResolutionOptions(synth);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ title: '方案一' });
    expect(opts[0]?.body).toContain('稳健');
    expect(opts[1]?.title).toBe('方案二');
  });

  it('extracts the plan between PLAN markers', () => {
    expect(parsePlan(synth)).toContain('推荐方案');
    expect(parsePlan('no markers')).toBe('');
  });

  it('detects + strips the machine markers for display', () => {
    expect(hasResolutionOptions(synth)).toBe(true);
    const stripped = stripResolutionMarkers(synth);
    expect(stripped).not.toContain('@@OPTION@@');
    expect(stripped).not.toContain('@@PLAN@@');
    expect(stripped).toContain('intro prose');
  });

  it('returns no options for empty / unmarked text', () => {
    expect(parseResolutionOptions('')).toEqual([]);
    expect(parseResolutionOptions('just prose')).toEqual([]);
  });
});

describe('adaptive meeting strategy', () => {
  it('caps moderator-driven debate at five rounds', () => {
    expect(MAX_DEBATE_ROUNDS).toBe(5);
  });

  it('continues when ordinary summary language appears without the explicit marker', () => {
    const move = parseModeratorMove('综上所述，已经达成部分共识，但 @风险官 还需要核算最坏情况。', [
      '增长官',
      '风险官',
    ]);

    expect(move.conclude).toBe(false);
    expect(move.targetNames).toEqual(['风险官']);
  });

  it('concludes only on a standalone marker or an empty moderator reply', () => {
    expect(parseModeratorMove('态势已经清楚。\n@@CONCLUDE@@', ['增长官']).conclude).toBe(true);
    expect(parseModeratorMove('', ['增长官']).conclude).toBe(true);
  });

  it('builds a response for every expert while specializing only named experts', () => {
    const responses = buildAdaptivePanelistResponses({
      topic: '是否进入新市场',
      panelNames: ['增长官', '风险官', '财务官'],
      targetNames: ['风险官'],
      challenge: '@风险官 请重算最坏情况',
      referenceContext: '最新资料：市场规模 20 亿元',
      priorContext: '增长官：建议先做小规模试点',
    });

    expect(responses).toHaveLength(3);
    expect(responses.find((response) => response.name === '风险官')?.phaseLabel).toBe('回应主持');
    expect(responses.find((response) => response.name === '增长官')?.phaseLabel).toBe('交锋回应');
    expect(responses.every((response) => response.prompt.includes('市场规模 20 亿元'))).toBe(true);
    expect(responses.every((response) => response.prompt.includes('增长官：建议先做小规模试点'))).toBe(true);
  });

  it('pauses when the host opening is blank', () => {
    expect(hasValidMeetingSpeech('  \n')).toBe(false);
  });

  it('continues after one advisor fails when another advisor speaks', () => {
    expect(['', '财务官：可以继续'].some(hasValidMeetingSpeech)).toBe(true);
  });

  it('pauses when every advisor reply is blank', () => {
    expect(['', '   '].some(hasValidMeetingSpeech)).toBe(false);
  });

  it('keeps the selected meeting form and reference material in the moderator prompt', () => {
    const prompt = buildModeratorDebateMovePrompt({
      topic: '是否进入新市场',
      form: 'redteam',
      round: 2,
      fullTranscript: '增长官：建议进入',
      panelNames: ['增长官', '风险官'],
      refNote: '最新资料：获客成本上涨',
    });

    expect(prompt).toContain('红蓝对抗模式');
    expect(prompt).toContain('获客成本上涨');
  });
});

describe('scribe + speaker parsing', () => {
  it('parses a scribe JSON answer tolerating surrounding prose', () => {
    const r = parseScribe('here: {"consensus":["a"],"disagreements":["b"],"open":[],"converged":true} done');
    expect(r.consensus).toEqual(['a']);
    expect(r.disagreements).toEqual(['b']);
    expect(r.converged).toBe(true);
  });

  it('degrades safely on non-JSON', () => {
    expect(parseScribe('nope').converged).toBe(false);
  });

  it('matches a speaker name exactly then by containment', () => {
    expect(matchSpeakerName('张三', ['张三', '李四'])).toBe('张三');
    expect(matchSpeakerName('我选「李四」', ['张三', '李四'])).toBe('李四');
    expect(matchSpeakerName('王五', ['张三', '李四'])).toBeNull();
  });
});

describe('per-form prompt builders', () => {
  const topic = '要不要进军海外市场';

  it('exposes all four discussion formats for the picker', () => {
    expect(MEETING_FORMS.map((f) => f.id)).toEqual(['roundtable', 'redteam', 'tournament', 'diverge', 'deepdive']);
    for (const f of MEETING_FORMS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
    }
  });

  it('every form prompt embeds the topic and the persona/context, and they differ', () => {
    const draft = buildDraftPrompt({ topic, persona: '专家A' });
    const redteam = buildRedTeamPrompt({ topic, persona: '专家B', lens: '风险', draftContext: '草案X' });
    const revise = buildRevisePrompt({ topic, persona: '专家A', critiqueContext: '批评Y' });
    const proposal = buildProposalPrompt({ topic, persona: '专家C', lens: '增长' });
    const diverge = buildDivergePrompt({ topic, persona: '专家D', lens: '用户' });
    const cluster = buildClusterPrompt({ topic, ideasContext: '点子Z' });
    const converge = buildConvergePrompt({ topic, persona: '专家E', clustersContext: '方向簇W' });

    for (const p of [draft, redteam, revise, proposal, diverge, cluster, converge]) {
      expect(p).toContain(topic);
      expect(p.length).toBeGreaterThan(20);
    }
    expect(redteam).toContain('草案X');
    expect(revise).toContain('批评Y');
    expect(cluster).toContain('点子Z');
    expect(converge).toContain('方向簇W');
    // The formats are genuinely distinct prompts, not the same text.
    expect(new Set([draft, redteam, proposal, diverge]).size).toBe(4);
  });
});
