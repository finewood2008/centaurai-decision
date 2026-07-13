import { describe, expect, it } from 'vitest';
import {
  buildFullMeetingTranscriptMarkdown,
  buildMeetingSummaryMarkdown,
  meetingExportFileName,
} from '@/renderer/pages/team/meeting/meetingTranscriptExport';
import type { MeetingTurn } from '@/renderer/pages/team/meeting/meetingTypes';

const turns: MeetingTurn[] = [
  {
    id: 'host',
    participantId: 'host',
    name: '主持人',
    agent_type: 'codex',
    isModerator: true,
    phaseLabel: '主持研判',
    text: '### 核心判断\n优先验证需求。',
    insightSummary: '应先验证需求',
    status: 'done',
    kind: 'moderator_action',
  },
  {
    id: 'advisor',
    participantId: 'advisor',
    name: '增长官',
    agent_type: 'claude',
    isModerator: false,
    phaseLabel: '顾问讨论',
    text: '建议先做小范围试点。',
    status: 'done',
    kind: 'advisor_response',
  },
  {
    id: 'boss',
    participantId: 'boss',
    name: '老板',
    agent_type: 'boss',
    isModerator: false,
    phaseLabel: '老板回应',
    text: '选择稳健推进。',
    status: 'done',
    kind: 'user_answer',
  },
];

describe('meeting transcript exports', () => {
  it('exports every turn in order for the full transcript', () => {
    const markdown = buildFullMeetingTranscriptMarkdown({
      topic: '新市场决策',
      transcript: turns,
      dateLabel: '测试时间',
    });

    expect(markdown).toContain('新市场决策 · 完整对话记录');
    expect(markdown).toContain('1. 主持人 · 主持研判');
    expect(markdown).toContain('2. 增长官 · 顾问讨论');
    expect(markdown).toContain('3. 老板 · 老板回应');
  });

  it('builds a live summary from moderator, advisor, user and open questions', () => {
    const markdown = buildMeetingSummaryMarkdown({
      topic: '新市场决策',
      transcript: turns,
      dateLabel: '测试时间',
      discussionState: { summary: '先验证再扩张', openQuestions: ['试点预算是多少？'] },
    });

    expect(markdown).toContain('主持人核心研判');
    expect(markdown).toContain('用户已确认');
    expect(markdown).toContain('顾问关键观点');
    expect(markdown).toContain('试点预算是多少？');
  });

  it('uses the finalized notes when a plan is available and sanitizes filenames', () => {
    const markdown = buildMeetingSummaryMarkdown({
      topic: '进入/新市场?',
      transcript: turns,
      dateLabel: '测试时间',
      discussionState: { summary: '', openQuestions: [] },
      plan: '## 正式纪要\n结论正文',
    });

    expect(markdown).toContain('正式纪要');
    expect(meetingExportFileName('进入/新市场?', '会议摘要')).toBe('进入 新市场_会议摘要.md');
  });
});
