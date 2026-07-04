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
const PPT_TITLE_FONT_SIZE = 3400;
const PPT_BODY_FONT_SIZE = 1800;
const PPT_MAX_BODY_LINES = 9;

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

type PptSlide = {
  title: string;
  lines: string[];
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
  return `${decisionFileBase(topic, teamName)}_决策方案.docx`;
}

export function decisionPptxFileName(topic: string, teamName?: string): string {
  return `${decisionFileBase(topic, teamName)}_决策方案.pptx`;
}

export function decisionMarkdownFileName(topic: string, teamName?: string): string {
  return `${decisionFileBase(topic, teamName)}_决策方案.md`;
}

function decisionFileBase(topic: string, teamName?: string): string {
  const base =
    (topic || teamName || '智囊团方案')
      .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '智囊团方案';
  return base;
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

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function splitLongLine(line: string, maxLen = 34): string[] {
  const clean = cleanMarkdownLine(line);
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += maxLen) out.push(clean.slice(i, i + maxLen));
  return out;
}

function markdownToSlides(args: DecisionDocArgs): PptSlide[] {
  const title = (args.topic || args.teamName || '智囊团方案').trim();
  const slides: PptSlide[] = [
    {
      title,
      lines: [`智囊团决策方案 · ${args.dateLabel}`, args.teamName ? `会议：${args.teamName}` : ''],
    },
  ];

  if (args.decision) {
    slides.push({
      title: '最终决策',
      lines: [
        args.decision.title,
        ...args.decision.body
          .split('\n')
          .flatMap((line) => splitLongLine(line))
          .slice(0, 7),
      ],
    });
  }

  let current: PptSlide | null = null;
  for (const raw of (args.plan || '').split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      if (current && current.lines.length > 0) slides.push(current);
      current = { title: cleanMarkdownLine(heading[2]), lines: [] };
      continue;
    }
    if (!current) current = { title: '方案要点', lines: [] };
    for (const part of splitLongLine(trimmed)) {
      if (current.lines.length < PPT_MAX_BODY_LINES) current.lines.push(part);
    }
  }
  if (current && current.lines.length > 0) slides.push(current);

  if (slides.length === 1) {
    slides.push({
      title: '方案要点',
      lines: (args.plan || '暂无方案内容')
        .split('\n')
        .flatMap((line) => splitLongLine(line))
        .slice(0, PPT_MAX_BODY_LINES),
    });
  }

  return slides.slice(0, 10).map((slide) => ({
    title: slide.title || '方案要点',
    lines: slide.lines.filter(Boolean).slice(0, PPT_MAX_BODY_LINES),
  }));
}

function slideXml(slide: PptSlide, index: number): string {
  const bodyLines = slide.lines.length > 0 ? slide.lines : [' '];
  const bodyParagraphs = bodyLines
    .map(
      (line) => `
        <a:p>
          <a:r><a:rPr lang="zh-CN" sz="${PPT_BODY_FONT_SIZE}"/><a:t>${xmlEscape(line)}</a:t></a:r>
        </a:p>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title ${index}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="914400"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:rPr lang="zh-CN" sz="${PPT_TITLE_FONT_SIZE}" b="1"/><a:t>${xmlEscape(slide.title)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body ${index}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="7315200" cy="4572000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bodyParagraphs}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function presentationXml(slides: PptSlide[]): string {
  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(slides: PptSlide[]): string {
  const rels = slides
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypesXml(slides: PptSlide[]): string {
  const slideOverrides = slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appXml(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>CentaurAI</Application>
  <PresentationFormat>On-screen Show (4:3)</PresentationFormat>
  <Slides>${slideCount}</Slides>
</Properties>`;
}

function coreXml(title: string, dateLabel: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>CentaurAI</dc:creator>
  <cp:lastModifiedBy>CentaurAI</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(dateLabel)}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEscape(dateLabel)}</dcterms:modified>
</cp:coreProperties>`;
}

function makeCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const file of files) {
    const name = textBytes(file.path);
    const offset = out.length;
    const crc = crc32(file.data);
    writeU32(out, 0x04034b50);
    writeU16(out, 20);
    writeU16(out, 0);
    writeU16(out, 0);
    writeU16(out, dosTime);
    writeU16(out, dosDate);
    writeU32(out, crc);
    writeU32(out, file.data.length);
    writeU32(out, file.data.length);
    writeU16(out, name.length);
    writeU16(out, 0);
    out.push(...name, ...file.data);

    writeU32(central, 0x02014b50);
    writeU16(central, 20);
    writeU16(central, 20);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, dosTime);
    writeU16(central, dosDate);
    writeU32(central, crc);
    writeU32(central, file.data.length);
    writeU32(central, file.data.length);
    writeU16(central, name.length);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, 0);
    writeU32(central, offset);
    central.push(...name);
  }

  const centralOffset = out.length;
  out.push(...central);
  writeU32(out, 0x06054b50);
  writeU16(out, 0);
  writeU16(out, 0);
  writeU16(out, files.length);
  writeU16(out, files.length);
  writeU32(out, central.length);
  writeU32(out, centralOffset);
  writeU16(out, 0);
  return new Uint8Array(out);
}

export function decisionMarkdownContent(args: DecisionDocArgs): string {
  const title = (args.topic || args.teamName || '智囊团方案').trim();
  const decisionBlock = args.decision
    ? `\n\n## 最终决策\n\n### ${args.decision.title}\n\n${args.decision.body || ''}\n`
    : '';
  return `# ${title}\n\n> 智囊团决策文档 · ${args.dateLabel}${decisionBlock}\n\n## 完整方案书\n\n${args.plan || ''}\n`;
}

export async function decisionPptxBase64(args: DecisionDocArgs): Promise<string> {
  const slides = markdownToSlides(args);
  const title = (args.topic || args.teamName || '智囊团方案').trim();
  const isoDate = new Date().toISOString();
  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: '[Content_Types].xml', data: textBytes(contentTypesXml(slides)) },
    { path: '_rels/.rels', data: textBytes(rootRelsXml()) },
    { path: 'docProps/app.xml', data: textBytes(appXml(slides.length)) },
    { path: 'docProps/core.xml', data: textBytes(coreXml(title, isoDate)) },
    { path: 'ppt/presentation.xml', data: textBytes(presentationXml(slides)) },
    { path: 'ppt/_rels/presentation.xml.rels', data: textBytes(presentationRels(slides)) },
    ...slides.map((slide, i) => ({ path: `ppt/slides/slide${i + 1}.xml`, data: textBytes(slideXml(slide, i + 1)) })),
  ];
  return uint8ToBase64(createZip(files));
}
