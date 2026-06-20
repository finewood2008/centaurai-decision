/**
 * Deterministic 方案书 → well-formatted Word (.docx) export for the 智囊团.
 *
 * The backend (aioncore) is Rust and `fs.writeFile` is text-only, so we build
 * the document in the renderer with the bundled `docx` library and hand the user
 * a downloaded .docx — no agent / officecli dependency, fully reproducible layout.
 */
import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import type { MeetingResolutionOption } from '@renderer/pages/team/meeting/meetingTypes';

/** A CJK-friendly default font so Chinese 方案书 render cleanly in Word. */
const FONT = '微软雅黑';
const NUM_REF = 'plan-numbered';

/** Split a markdown line into runs, turning `**bold**` spans into bold runs. */
function inlineRuns(text: string, base?: { bold?: boolean; size?: number; color?: string }): TextRun[] {
  const segments = text.split(/\*\*/);
  const runs: TextRun[] = [];
  segments.forEach((seg, i) => {
    if (!seg) return;
    runs.push(
      new TextRun({
        text: seg,
        bold: base?.bold || i % 2 === 1,
        size: base?.size,
        color: base?.color,
        font: FONT,
      })
    );
  });
  return runs.length > 0 ? runs : [new TextRun({ text: '', font: FONT })];
}

/** Render a markdown block into docx paragraphs (headings / bold / bullets / numbers / rules). */
function markdownToParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of (md || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) {
      out.push(new Paragraph({ text: '' }));
    } else if (t.startsWith('### ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(t.slice(4)) }));
    } else if (t.startsWith('## ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(t.slice(3)) }));
    } else if (t.startsWith('# ')) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(t.slice(2)) }));
    } else if (/^[-*]\s+/.test(t)) {
      out.push(
        new Paragraph({ bullet: { level: 0 }, children: inlineRuns(t.replace(/^[-*]\s+/, '')), spacing: { after: 40 } })
      );
    } else if (/^\d+\.\s+/.test(t)) {
      out.push(
        new Paragraph({
          numbering: { reference: NUM_REF, level: 0 },
          children: inlineRuns(t.replace(/^\d+\.\s+/, '')),
          spacing: { after: 40 },
        })
      );
    } else if (t.startsWith('> ')) {
      out.push(new Paragraph({ children: inlineRuns(t.slice(2), { color: '666666' }), indent: { left: 360 } }));
    } else if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
      out.push(
        new Paragraph({
          text: '',
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 1 } },
        })
      );
    } else {
      out.push(new Paragraph({ children: inlineRuns(t), spacing: { after: 100 } }));
    }
  }
  return out;
}

export type DecisionDocArgs = {
  /** Discussion topic (used as the document title). */
  topic: string;
  /** Team / 智囊团 name (title fallback). */
  teamName?: string;
  /** The synthesized 方案书 markdown. */
  plan: string;
  /** The option the boss picked (highlighted as the final decision), if any. */
  decision?: MeetingResolutionOption | null;
  /** Pre-formatted date string (callers pass it — Date.now is environment-restricted). */
  dateLabel: string;
};

/** Build the decision Word document (pure — node-testable). */
export function buildDecisionDocument(args: DecisionDocArgs): Document {
  const title = (args.topic || args.teamName || '智囊团方案').trim();
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, font: FONT })],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `智囊团决策文档 · ${args.dateLabel}`, color: '888888', size: 20, font: FONT })],
      spacing: { after: 240 },
    })
  );

  if (args.decision) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '✅ 最终决策', font: FONT })] })
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: args.decision.title, bold: true, size: 26, color: '1A5FB4', font: FONT })],
        spacing: { before: 60, after: 100 },
      })
    );
    children.push(...markdownToParagraphs(args.decision.body || ''));
    children.push(new Paragraph({ text: '' }));
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '📋 完整方案书', font: FONT })] })
  );
  children.push(...markdownToParagraphs(args.plan || ''));

  return new Document({
    numbering: {
      config: [
        {
          reference: NUM_REF,
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });
}

/** A filesystem-safe filename for the decision document. */
export function decisionFileName(topic: string, teamName?: string): string {
  const base =
    (topic || teamName || '智囊团方案')
      .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '智囊团方案';
  return `${base}_决策方案.docx`;
}

/** Base64-encode bytes in chunks (avoids call-stack overflow on large buffers). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/**
 * Build the decision Word doc and return it as a base64 string. The caller writes
 * it to disk via the Electron main-process binary-write IPC (blob downloads are
 * dropped by this app, and aioncore's fs.write is text-only).
 */
export async function decisionDocxBase64(args: DecisionDocArgs): Promise<string> {
  const doc = buildDecisionDocument(args);
  const blob = await Packer.toBlob(doc);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return uint8ToBase64(bytes);
}
