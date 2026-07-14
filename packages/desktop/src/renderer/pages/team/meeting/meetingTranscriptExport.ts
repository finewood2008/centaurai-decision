import type { MeetingDiscussionState, MeetingTurn } from './meetingTypes';
import { stripResolutionMarkers } from './meetingPrompts';

type MeetingExportArgs = {
  topic: string;
  transcript: MeetingTurn[];
  dateLabel: string;
};

type MeetingSummaryExportArgs = MeetingExportArgs & {
  discussionState: MeetingDiscussionState;
  plan?: string;
};

function visibleTurnText(text: string): string {
  const actionStart = text.indexOf('@@MEETING_ACTION@@');
  const withoutAction = actionStart >= 0 ? text.slice(0, actionStart) : text;
  return stripResolutionMarkers(withoutAction).trim();
}

function safeTopic(topic: string): string {
  return (
    topic
      .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '决策会议'
  );
}

function compactExcerpt(text: string, maxLength = 280): string {
  const compact = visibleTurnText(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export function meetingExportFileName(topic: string, kind: '完整对话' | '会议摘要'): string {
  return `${safeTopic(topic)}_${kind}.md`;
}

export function buildFullMeetingTranscriptMarkdown(args: MeetingExportArgs): string {
  const sections = args.transcript.map((turn, index) => {
    const body = visibleTurnText(turn.text) || (turn.status === 'speaking' ? '（正在发言）' : '（无有效内容）');
    const question = turn.question;
    const questionLines = question ? ['', '### 待回答问题', question.prompt] : [];
    question?.items?.forEach((item, itemIndex) => {
      questionLines.push(`${itemIndex + 1}. **${item.prompt}**`);
      item.options.forEach((option) => {
        questionLines.push(`   - ${option.label}${option.description ? `：${option.description}` : ''}`);
      });
    });
    const questionBlock = questionLines.join('\n');
    return [`## ${index + 1}. ${turn.name} · ${turn.phaseLabel}`, body, questionBlock].filter(Boolean).join('\n\n');
  });

  return [
    `# ${args.topic || '决策会议'} · 完整对话记录`,
    `> 导出时间：${args.dateLabel}`,
    `> 共 ${args.transcript.length} 段会议记录`,
    '',
    ...sections,
  ].join('\n\n');
}

export function buildMeetingSummaryMarkdown(args: MeetingSummaryExportArgs): string {
  if (args.plan?.trim()) {
    return [`# ${args.topic || '决策会议'} · 会议摘要`, `> 导出时间：${args.dateLabel}`, '', args.plan.trim()].join(
      '\n\n'
    );
  }

  const moderatorInsights = args.transcript
    .filter((turn) => turn.isModerator && turn.insightSummary?.trim())
    .map((turn) => turn.insightSummary!.trim())
    .filter((item, index, list) => list.indexOf(item) === index);
  const userConfirmations = args.transcript
    .filter((turn) => turn.kind === 'user_answer')
    .map((turn) => visibleTurnText(turn.text))
    .filter(Boolean);
  const advisorViews = args.transcript
    .filter((turn) => turn.kind === 'advisor_response')
    .map((turn) => ({ name: turn.name, text: compactExcerpt(turn.text) }))
    .filter((item) => item.text);

  const sections: string[] = [`# ${args.topic || '决策会议'} · 会议摘要`, `> 导出时间：${args.dateLabel}`];
  if (args.discussionState.summary.trim()) {
    sections.push('## 当前认识', args.discussionState.summary.trim());
  }
  if (moderatorInsights.length > 0) {
    sections.push('## 主持人核心研判', ...moderatorInsights.map((item) => `- ${item}`));
  }
  if (userConfirmations.length > 0) {
    sections.push('## 用户已确认', ...userConfirmations.map((item) => `- ${item}`));
  }
  if (advisorViews.length > 0) {
    sections.push('## 顾问关键观点', ...advisorViews.map((item) => `- **${item.name}**：${item.text}`));
  }
  if (args.discussionState.openQuestions.length > 0) {
    sections.push('## 未决问题', ...args.discussionState.openQuestions.map((item) => `- ${item}`));
  }
  if (sections.length === 2) sections.push('## 当前状态', '会议正在进行，尚未形成可导出的摘要内容。');
  return sections.join('\n\n');
}
