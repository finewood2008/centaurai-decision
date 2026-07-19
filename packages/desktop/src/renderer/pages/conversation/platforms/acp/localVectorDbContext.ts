import {
  attachKnowledgeContext,
  hasKnowledgeContext,
  retrieveKnowledge,
  type KnowledgeRetrievalScope,
} from '@/renderer/services/knowledgeBaseSearch';
import i18n from '@/renderer/services/i18n';

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

const retrieveLocalVectorContext = async (question: string, mode: LocalVectorMode, query: string): Promise<string> => {
  const searchQuery = String(query || question);

  if (mode === 'direct') return question;
  const options: Record<
    Exclude<LocalVectorMode, 'direct'>,
    {
      scope: KnowledgeRetrievalScope;
      limit: number;
      label: string;
      querySuffix?: string;
    }
  > = {
    profile: {
      scope: 'memory',
      limit: 5,
      label: i18n.t('messages.knowledgeRetrieval.modes.profile'),
      querySuffix: 'USER.md 用户画像 个人资料 偏好',
    },
    rules: {
      scope: 'memory',
      limit: 5,
      label: i18n.t('messages.knowledgeRetrieval.modes.rules'),
      querySuffix: 'AGENTS.md Agent 行为规则 工作规则',
    },
    journal: {
      scope: 'memory',
      limit: 6,
      label: i18n.t('messages.knowledgeRetrieval.modes.journal'),
      querySuffix: 'journal 最近日记 工作日志',
    },
    memory: { scope: 'memory', limit: 5, label: i18n.t('messages.knowledgeRetrieval.modes.memory') },
    kb: { scope: 'knowledge', limit: 5, label: i18n.t('messages.knowledgeRetrieval.modes.knowledge') },
    deep: { scope: 'all', limit: 10, label: i18n.t('messages.knowledgeRetrieval.modes.deep') },
    smart: { scope: 'all', limit: 6, label: i18n.t('messages.knowledgeRetrieval.modes.smart') },
  };
  const selected = options[mode];
  const result = await retrieveKnowledge({
    query: selected.querySuffix ? `${searchQuery}\n${selected.querySuffix}` : searchQuery,
    scope: selected.scope,
    limit: selected.limit,
    mode: 'text',
  });
  return attachKnowledgeContext(question, result, { modeLabel: selected.label });
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
    const tr = (key: string): string => escapeHtml(String(i18n.t(key)));
    wrapper.innerHTML = `<div class="local-vector-db-choice-card"><div class="local-vector-db-choice-head"><div><div class="local-vector-db-choice-title">${tr('messages.knowledgeRetrieval.choice.title')}</div><p class="local-vector-db-choice-desc">${tr('messages.knowledgeRetrieval.choice.description')}</p></div><button class="local-vector-db-choice-close" data-mode="direct" title="${tr('messages.knowledgeRetrieval.choice.close')}">×</button></div><div class="local-vector-db-choice-query"><label>${tr('messages.knowledgeRetrieval.choice.query')}</label><input value="${escapeHtml(clipText(question, 120))}" /></div><div class="local-vector-db-choice-grid"><button class="local-vector-db-choice-option" data-mode="smart"><strong>${tr('messages.knowledgeRetrieval.choice.smart')}</strong><span>${tr('messages.knowledgeRetrieval.choice.smartHint')}</span></button><button class="local-vector-db-choice-option" data-mode="memory"><strong>${tr('messages.knowledgeRetrieval.choice.memory')}</strong><span>${tr('messages.knowledgeRetrieval.choice.memoryHint')}</span></button><button class="local-vector-db-choice-option" data-mode="kb"><strong>${tr('messages.knowledgeRetrieval.choice.knowledge')}</strong><span>${tr('messages.knowledgeRetrieval.choice.knowledgeHint')}</span></button><button class="local-vector-db-choice-option" data-mode="journal"><strong>${tr('messages.knowledgeRetrieval.choice.journal')}</strong><span>${tr('messages.knowledgeRetrieval.choice.journalHint')}</span></button><button class="local-vector-db-choice-option" data-mode="deep"><strong>${tr('messages.knowledgeRetrieval.choice.deep')}</strong><span>${tr('messages.knowledgeRetrieval.choice.deepHint')}</span></button><button class="local-vector-db-choice-option" data-mode="direct"><strong>${tr('messages.knowledgeRetrieval.choice.direct')}</strong><span>${tr('messages.knowledgeRetrieval.choice.directHint')}</span></button></div><div class="local-vector-db-choice-foot"><span>${tr('messages.knowledgeRetrieval.choice.timeout')}</span><span>CentaurAI</span></div></div>`;

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
          ? i18n.t('messages.knowledgeRetrieval.choice.sending')
          : timedOut
            ? i18n.t('messages.knowledgeRetrieval.choice.timedOut')
            : i18n.t('messages.knowledgeRetrieval.choice.searching');
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
    if (typeof question !== 'string' || !question.trim() || hasKnowledgeContext(question)) {
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
