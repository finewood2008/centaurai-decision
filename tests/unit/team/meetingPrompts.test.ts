/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  MEETING_FORMS,
  buildClusterPrompt,
  buildConvergePrompt,
  buildDivergePrompt,
  buildDiscussionNotesPrompt,
  buildDynamicModeratorPrompt,
  buildDraftPrompt,
  buildProposalPrompt,
  buildRedTeamPrompt,
  buildRevisePrompt,
  hasValidMeetingSpeech,
  hasResolutionOptions,
  matchSpeakerName,
  parseDynamicModeratorAction,
  parsePlan,
  parseResolutionOptions,
  parseScribe,
  stripResolutionMarkers,
} from '@/renderer/pages/team/meeting/meetingPrompts';

const wrapModeratorAction = (action: object, display = '我们需要先明确方向。') =>
  `${display}\n@@MEETING_ACTION@@\n${JSON.stringify(action)}\n@@END_MEETING_ACTION@@`;

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

describe('meeting speech validation', () => {
  it('pauses when the host opening is blank', () => {
    expect(hasValidMeetingSpeech('  \n')).toBe(false);
  });

  it('continues after one advisor fails when another advisor speaks', () => {
    expect(['', '财务官：可以继续'].some(hasValidMeetingSpeech)).toBe(true);
  });

  it('pauses when every advisor reply is blank', () => {
    expect(['', '   '].some(hasValidMeetingSpeech)).toBe(false);
  });
});

describe('host-driven deep discussion', () => {
  it('requires the opening action to align with the user before consulting advisors', () => {
    const prompt = buildDynamicModeratorPrompt({
      topic: '是否进入新市场',
      form: 'roundtable',
      panelNames: ['增长官'],
      transcript: '',
      opening: true,
    });

    expect(prompt).toContain('必须用 ask_user');
    expect(prompt).toContain('不得先调度顾问');
  });

  it('parses a user question only when it has three or four choices', () => {
    const parsed = parseDynamicModeratorAction(
      wrapModeratorAction({
        type: 'ask_user',
        question: '你最看重什么？',
        options: [{ label: '增长' }, { label: '风险' }, { label: '现金流' }],
        stateSummary: '目标尚未对齐',
        openQuestions: ['成功标准'],
      }),
      ['增长官'],
      'q-1'
    );

    expect(parsed?.action.type).toBe('ask_user');
    expect(parsed?.action.type === 'ask_user' ? parsed.action.question.options : []).toHaveLength(3);
  });

  it('rejects malformed question and unknown advisor targets for repair', () => {
    const shortQuestion = wrapModeratorAction({
      type: 'ask_user',
      question: '选哪个？',
      options: [{ label: 'A' }, { label: 'B' }],
    });
    const unknownAdvisor = wrapModeratorAction({
      type: 'consult_advisors',
      targetNames: ['不存在'],
      instruction: '分析',
    });

    expect(parseDynamicModeratorAction(shortQuestion, ['增长官'], 'q-2')).toBeNull();
    expect(parseDynamicModeratorAction(unknownAdvisor, ['增长官'], 'q-3')).toBeNull();
  });

  it('dispatches only the advisors selected by the moderator', () => {
    const parsed = parseDynamicModeratorAction(
      wrapModeratorAction({
        type: 'consult_advisors',
        targetNames: ['风险官'],
        instruction: '验证最坏情况',
        stateSummary: '增长路径已有雏形',
        openQuestions: ['极端损失'],
      }),
      ['增长官', '风险官'],
      'q-4'
    );

    expect(parsed?.action).toMatchObject({ type: 'consult_advisors', targetNames: ['风险官'] });
  });

  it('does not treat the legacy conclude marker as authority to end a meeting', () => {
    expect(parseDynamicModeratorAction('@@CONCLUDE@@', ['增长官'], 'q-5')).toBeNull();
  });

  it('parses a close suggestion as a user-controlled action rather than completion', () => {
    const parsed = parseDynamicModeratorAction(
      wrapModeratorAction({ type: 'suggest_close', reason: '新增信息的边际价值已经较低' }),
      ['增长官'],
      'q-6'
    );

    expect(parsed?.action).toEqual({ type: 'suggest_close', reason: '新增信息的边际价值已经较低' });
  });

  it('allows the host to request targeted knowledge research', () => {
    const parsed = parseDynamicModeratorAction(
      wrapModeratorAction({ type: 'research', query: '2026 年市场获客成本', openQuestions: ['成本是否持续上涨'] }),
      ['增长官'],
      'q-7'
    );

    expect(parsed?.action).toEqual({ type: 'research', query: '2026 年市场获客成本' });
  });

  it('produces discussion notes without forcing a recommendation', () => {
    const prompt = buildDiscussionNotesPrompt('新市场', '老板：继续验证');
    expect(prompt).toContain('不要强行形成结论');
    expect(prompt).toContain('尚未解决的问题');
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
