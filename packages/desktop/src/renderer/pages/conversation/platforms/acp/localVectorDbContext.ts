const LOCAL_VECTOR_DB_MARK = '【local-vector-db 检索结果】';
const LOCAL_VECTOR_DB_BASE = 'http://127.0.0.1:8618';
const CHOICE_TIMEOUT_MS = 45_000;

const PROFILE_QUERY_RE =
  /(我是谁|你知道我是谁|你认识我吗|认识我|我叫什么|怎么称呼我|我的名字|关于我|个人资料|用户画像|用户文件|USER\.md|who\s*am\s*i|whoami|do\s*you\s*know\s*me|profile)/i;
const RULES_QUERY_RE = /(AGENTS\.md|行为规则|工作规则|你的规则|agent规则|你应该怎么|怎么工作)/i;
const JOURNAL_QUERY_RE = /(日记|日志|今天.*记录|昨天.*记录|最近.*记录|journal)/i;
const RETRIEVAL_QUERY_RE =
  /(知识库|向量库|资料库|本地资料|本地文档|文档|文件|检索|搜索|查一下|查找|查查|记忆|长期记忆|之前|上次|以前|记得|说过|提过|项目记忆|基于.*资料|kb|knowledge|memory|search)/i;
const PINYIN_QUERY_RE =
  /(woshishui|woshishei|nizhidaowoshishui|nizhidaowoshishei|nirenshiwo|zenmechenghuwo|wodemingzi|jiyi|riji|yonghu|zhishiku)/i;
const PROFILE_PINYIN_RE =
  /(woshishui|woshishei|nizhidaowoshishui|nizhidaowoshishei|nirenshiwo|zenmechenghuwo|wodemingzi)/i;

type LocalVectorMode = 'direct' | 'profile' | 'rules' | 'journal' | 'memory' | 'kb' | 'deep' | 'smart';

type LocalVectorChoice = {
  mode: LocalVectorMode;
  query: string;
};

type LocalVectorSearchItem = {
  text?: string;
  content?: string;
  chunk?: string;
  snippet?: string;
  preview?: string;
  document?: string;
  page_content?: string;
  rel_path?: string;
  source_path?: string;
  path?: string;
  title?: string;
  doc_id?: string;
  id?: string;
  score?: number;
  vector_score?: number;
  metadata?: {
    file_name?: string;
    source_path?: string;
    path?: string;
    score?: number;
  };
};

const normalizeQuery = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_，。！？,.!?：:;；“”"'~()（）[\]【】]/g, '');

const clipText = (value: string, maxLength: number): string => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

const escapeHtml = (value: string): string =>
  String(value || '').replace(/[<>&"]/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    return '&quot;';
  });

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${LOCAL_VECTOR_DB_BASE}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${LOCAL_VECTOR_DB_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const itemText = (item: LocalVectorSearchItem): string =>
  item.text || item.content || item.chunk || item.snippet || item.preview || item.document || item.page_content || '';

const itemSource = (item: LocalVectorSearchItem): string => {
  const metadata = item.metadata || {};
  return (
    metadata.file_name ||
    metadata.source_path ||
    metadata.path ||
    item.rel_path ||
    item.source_path ||
    item.path ||
    item.title ||
    item.doc_id ||
    item.id ||
    'unknown'
  );
};

const itemScore = (item: LocalVectorSearchItem): string => {
  const score =
    typeof item.score === 'number'
      ? item.score
      : typeof item.vector_score === 'number'
        ? item.vector_score
        : typeof item.metadata?.score === 'number'
          ? item.metadata.score
          : null;
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(3) : '';
};

const cleanItems = (items: LocalVectorSearchItem[]): LocalVectorSearchItem[] =>
  items.filter((item) => {
    const text = itemText(item).trim();
    return text && text !== '---' && text !== '#' && text.length > 2;
  });

const formatItems = (items: LocalVectorSearchItem[], title: string, snippetLength: number): string => {
  const formatted = cleanItems(items)
    .map((item, index) => {
      const source = clipText(itemSource(item), 96);
      const score = itemScore(item);
      const snippet = clipText(itemText(item).replace(/\s+/g, ' '), snippetLength);
      return `[${index + 1}] ${source}${score ? ` · score ${score}` : ''}\n${snippet}`;
    })
    .filter(Boolean);

  return formatted.length ? `## ${title}（${formatted.length} 条）\n${formatted.join('\n\n')}` : '';
};

const wrapRetrievedContext = (question: string, modeLabel: string, sections: string[]): string => {
  const body = sections.filter(Boolean).join('\n\n').trim();
  return body ? `${LOCAL_VECTOR_DB_MARK}\n检索模式：${modeLabel}\n\n${body}\n\n---\n用户问题：${question}` : question;
};

const readMemoryFile = async (filePath: string, maxLength: number): Promise<string> => {
  try {
    const data = await getJson<{ content?: string }>(
      `/api/memory/files/${filePath.split('/').map(encodeURIComponent).join('/')}`
    );
    return data.content ? `## ${filePath}\n\n${clipText(data.content, maxLength)}` : '';
  } catch {
    return '';
  }
};

const readRecentJournal = async (count: number): Promise<string> => {
  try {
    const data = await getJson<{ journals?: Array<{ date: string }> }>('/api/memory/journal');
    const sections: string[] = [];
    for (const journal of (data.journals || []).slice(0, count)) {
      try {
        const item = await getJson<{ content?: string }>(`/api/memory/journal/${encodeURIComponent(journal.date)}`);
        if (item.content) {
          sections.push(`## journal/${journal.date}.md\n\n${clipText(item.content, 500)}`);
        }
      } catch {
        // Ignore individual journal read failures so retrieval can still continue.
      }
    }
    return sections.join('\n\n');
  } catch {
    return '';
  }
};

const retrieveLocalVectorContext = async (question: string, mode: LocalVectorMode, query: string): Promise<string> => {
  const searchQuery = String(query || question);

  if (mode === 'direct') return question;
  if (mode === 'profile') {
    return wrapRetrievedContext(question, '用户画像', [await readMemoryFile('USER.md', 1100)]);
  }
  if (mode === 'rules') {
    return wrapRetrievedContext(question, 'Agent 规则', [await readMemoryFile('AGENTS.md', 1100)]);
  }
  if (mode === 'journal') {
    return wrapRetrievedContext(question, '最近日记', [await readRecentJournal(3)]);
  }
  if (mode === 'memory') {
    let results: LocalVectorSearchItem[] = [];
    try {
      results =
        (
          await postJson<{ results?: LocalVectorSearchItem[] }>('/api/memory/search', {
            query: searchQuery,
            n_results: 5,
          })
        ).results || [];
    } catch {}
    return wrapRetrievedContext(question, '最近记忆', [formatItems(results, '记忆检索', 360)]);
  }
  if (mode === 'kb') {
    let results: LocalVectorSearchItem[] = [];
    try {
      results =
        (
          await postJson<{ results?: LocalVectorSearchItem[] }>('/api/search', {
            query: searchQuery,
            n_results: 5,
            mode: 'hybrid',
          })
        ).results || [];
    } catch {}
    return wrapRetrievedContext(question, '知识库轻检索', [formatItems(results, '知识库检索', 420)]);
  }
  if (mode === 'deep') {
    let memoryResults: LocalVectorSearchItem[] = [];
    let kbResults: LocalVectorSearchItem[] = [];
    try {
      memoryResults =
        (
          await postJson<{ results?: LocalVectorSearchItem[] }>('/api/memory/search', {
            query: searchQuery,
            n_results: 7,
          })
        ).results || [];
    } catch {}
    try {
      kbResults =
        (
          await postJson<{ results?: LocalVectorSearchItem[] }>('/api/search', {
            query: searchQuery,
            n_results: 7,
            mode: 'hybrid',
          })
        ).results || [];
    } catch {}
    return wrapRetrievedContext(question, '深度检索', [
      formatItems(memoryResults, '记忆检索', 380),
      formatItems(kbResults, '知识库检索', 440),
    ]);
  }

  let memoryResults: LocalVectorSearchItem[] = [];
  let kbResults: LocalVectorSearchItem[] = [];
  try {
    memoryResults =
      (
        await postJson<{ results?: LocalVectorSearchItem[] }>('/api/memory/search', {
          query: searchQuery,
          n_results: 3,
        })
      ).results || [];
  } catch {}
  try {
    kbResults =
      (
        await postJson<{ results?: LocalVectorSearchItem[] }>('/api/search', {
          query: searchQuery,
          n_results: 3,
          mode: 'hybrid',
        })
      ).results || [];
  } catch {}
  return wrapRetrievedContext(question, '智能轻检索', [
    formatItems(memoryResults, '记忆检索', 320),
    formatItems(kbResults, '知识库检索', 360),
  ]);
};

const shouldOfferLocalVectorChoice = (question: string): boolean => {
  const lower = question.toLowerCase();
  const normalized = normalizeQuery(question);
  return (
    !PROFILE_QUERY_RE.test(lower) &&
    !RULES_QUERY_RE.test(lower) &&
    (RETRIEVAL_QUERY_RE.test(lower) || JOURNAL_QUERY_RE.test(lower) || PINYIN_QUERY_RE.test(normalized))
  );
};

const ensureChoiceCardStyle = (): void => {
  if (document.getElementById('local-vector-db-choice-card-style')) return;

  const style = document.createElement('style');
  style.id = 'local-vector-db-choice-card-style';
  style.textContent =
    '.local-vector-db-choice-wrap{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:2147483000;width:min(720px,calc(100vw - 32px));font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.local-vector-db-choice-card{background:var(--bg-1);border:1px solid var(--aou-3);box-shadow:0 20px 56px rgba(78,44,32,.18);border-radius:10px;padding:16px;color:var(--color-text-1,#1d2129)}.local-vector-db-choice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.local-vector-db-choice-title{font-size:14px;font-weight:650;margin:0 0 4px}.local-vector-db-choice-desc{font-size:12px;line-height:18px;color:var(--color-text-2,#4e5969);margin:0}.local-vector-db-choice-close{appearance:none;border:0;background:transparent;color:var(--color-text-3,#86909c);font-size:18px;line-height:18px;padding:2px 4px;cursor:pointer}.local-vector-db-choice-query{display:flex;gap:8px;align-items:center;margin:12px 0}.local-vector-db-choice-query label{font-size:12px;color:var(--color-text-2,#4e5969);white-space:nowrap}.local-vector-db-choice-query input{flex:1;min-width:0;border:1px solid var(--aou-3);border-radius:8px;background:var(--bg-1);color:var(--color-text-1,#1d2129);font-size:12px;padding:8px 10px;outline:none}.local-vector-db-choice-query input:focus{border-color:var(--brand);box-shadow:0 0 0 2px rgba(192,117,90,.14)}.local-vector-db-choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.local-vector-db-choice-card button.local-vector-db-choice-option{appearance:none;border:1px solid var(--aou-3);background:var(--aou-1);color:var(--color-text-1,#1d2129);border-radius:8px;padding:9px 10px;text-align:left;cursor:pointer;min-height:58px}.local-vector-db-choice-card button.local-vector-db-choice-option:hover{border-color:var(--brand);background:var(--brand-light)}.local-vector-db-choice-card button.local-vector-db-choice-option strong{display:block;font-size:12px;font-weight:650}.local-vector-db-choice-card button.local-vector-db-choice-option span{display:block;margin-top:3px;font-size:11px;color:var(--color-text-3,#86909c);line-height:15px}.local-vector-db-choice-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;font-size:11px;color:var(--color-text-3,#86909c)}.local-vector-db-choice-busy{padding:10px 0 2px;font-size:12px;color:var(--brand)}@media(max-width:560px){.local-vector-db-choice-wrap{bottom:76px}.local-vector-db-choice-grid{grid-template-columns:1fr}.local-vector-db-choice-card{padding:14px}.local-vector-db-choice-query{align-items:stretch;flex-direction:column}}';
  document.head.appendChild(style);
};

const showLocalVectorChoice = (question: string): Promise<LocalVectorChoice> =>
  new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve({ mode: 'smart', query: question });
      return;
    }

    ensureChoiceCardStyle();
    document.querySelectorAll('.local-vector-db-choice-wrap').forEach((node) => node.remove());

    const wrapper = document.createElement('div');
    wrapper.className = 'local-vector-db-choice-wrap';
    wrapper.innerHTML =
      '<div class="local-vector-db-choice-card"><div class="local-vector-db-choice-head"><div><div class="local-vector-db-choice-title">需要从本地知识库检索吗？</div><p class="local-vector-db-choice-desc">请选择检索范围，必要时改一下检索词。系统只会注入少量相关片段，不会导入整个知识库。</p></div><button class="local-vector-db-choice-close" data-mode="direct" title="不检索">×</button></div><div class="local-vector-db-choice-query"><label>检索词</label><input value="' +
      escapeHtml(clipText(question, 120)) +
      '" /></div><div class="local-vector-db-choice-grid"><button class="local-vector-db-choice-option" data-mode="smart"><strong>智能轻检索</strong><span>推荐，记忆+知识库少量片段</span></button><button class="local-vector-db-choice-option" data-mode="memory"><strong>查最近记忆</strong><span>适合“之前/上次/说过”</span></button><button class="local-vector-db-choice-option" data-mode="kb"><strong>查知识库</strong><span>适合文档、资料、文件</span></button><button class="local-vector-db-choice-option" data-mode="journal"><strong>查最近日记</strong><span>只看最近日期摘要</span></button><button class="local-vector-db-choice-option" data-mode="deep"><strong>深度检索</strong><span>更全面，token 较高</span></button><button class="local-vector-db-choice-option" data-mode="direct"><strong>不查，直接回答</strong><span>不增加检索上下文</span></button></div><div class="local-vector-db-choice-foot"><span>45 秒未选择将使用智能轻检索</span><span>local-vector-db</span></div></div>';

    document.body.appendChild(wrapper);

    const input = wrapper.querySelector('input');
    if (input) {
      window.setTimeout(() => {
        try {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {}
      }, 20);
    }

    let settled = false;
    const timeout = window.setTimeout(() => settle('smart', true), CHOICE_TIMEOUT_MS);

    function settle(mode: LocalVectorMode, timedOut: boolean) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);

      const query = input?.value.trim() || question;
      wrapper.querySelectorAll('button,input').forEach((node) => {
        (node as HTMLButtonElement | HTMLInputElement).disabled = true;
      });

      const busy = document.createElement('div');
      busy.className = 'local-vector-db-choice-busy';
      busy.textContent =
        mode === 'direct'
          ? '将直接发送…'
          : timedOut
            ? '已默认使用智能轻检索，正在压缩上下文…'
            : '正在检索并压缩上下文…';
      wrapper.querySelector('.local-vector-db-choice-card')?.appendChild(busy);

      window.setTimeout(() => wrapper.remove(), 280);
      resolve({ mode, query });
    }

    wrapper.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-mode]');
      if (button) {
        settle(button.dataset.mode as LocalVectorMode, false);
      }
    });

    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        settle('smart', false);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        settle('direct', false);
      }
    });
  });

export const maybeAttachLocalVectorContext = async (question: string, backend?: string): Promise<string> => {
  try {
    if (typeof question !== 'string' || !question.trim() || question.includes(LOCAL_VECTOR_DB_MARK)) {
      return question;
    }

    const lower = question.toLowerCase();
    const normalized = normalizeQuery(question);

    if (PROFILE_QUERY_RE.test(lower) || (PINYIN_QUERY_RE.test(normalized) && PROFILE_PINYIN_RE.test(normalized))) {
      return retrieveLocalVectorContext(question, 'profile', question);
    }

    if (RULES_QUERY_RE.test(lower)) {
      return retrieveLocalVectorContext(question, 'rules', question);
    }

    if (String(backend || '').toLowerCase() === 'advisor') {
      return RETRIEVAL_QUERY_RE.test(lower) || JOURNAL_QUERY_RE.test(lower)
        ? retrieveLocalVectorContext(question, 'smart', question)
        : question;
    }

    if (!shouldOfferLocalVectorChoice(question)) {
      return question;
    }

    const choice = await showLocalVectorChoice(question);
    return retrieveLocalVectorContext(question, choice.mode, choice.query);
  } catch {
    return question;
  }
};
