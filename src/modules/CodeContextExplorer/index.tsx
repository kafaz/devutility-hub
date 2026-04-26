import {
    BranchesOutlined,
    CloseOutlined,
    CodeOutlined,
    ReloadOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import {
    Alert,
    Button,
    Card,
    Collapse,
    Empty,
    Input,
    InputNumber,
    List,
    Select,
    Space,
    Spin,
    Tag,
    Tooltip,
    Typography,
    message,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ResizableOutput from '../../components/shared/ResizableOutput';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useGlobalStore } from '../../store/globalStore';
import { extractFunctionCandidates, type FunctionCandidateToken } from '../../utils/sourceLookupHints';
import { highlightCLine } from './cHighlight';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { Password, Search, TextArea } = Input;

const PROXY_HTTP = 'http://127.0.0.1:3001';
const DEFAULT_BEFORE_CONTEXT = 12;
const DEFAULT_AFTER_CONTEXT = 24;
const MAX_BEFORE_CONTEXT = 240;
const MAX_AFTER_CONTEXT = 360;
const APPROX_LINE_HEIGHT = 20;
const MAX_COMMAND_RUNS = 12;
const DEFAULT_SPLIT_RATIO = 0.42;
const SPLIT_HANDLE_WIDTH = 18;
const MIN_LEFT_PANEL_WIDTH = 420;
const MIN_RIGHT_PANEL_WIDTH = 560;
const STACK_LAYOUT_BREAKPOINT = 1120;

const SYMBOL_KIND_LABEL: Record<string, string> = {
  function: '函数',
  struct: '结构体',
  union: '联合体',
  enum: '枚举',
  macro: '宏',
  typedef: '类型别名',
};

const SYMBOL_KIND_COLOR: Record<string, string> = {
  function: 'blue',
  struct: 'purple',
  union: 'cyan',
  enum: 'orange',
  macro: 'magenta',
  typedef: 'gold',
};

interface CodeContextBindingDraft {
  repo: string;
  branch: string;
  commit: string;
}

interface CodeContextBindingResult {
  contextId: string;
  repo: string;
  repoDisplayName: string;
  branch: string;
  branchRef: string;
  commit: string;
  worktreePath: string;
  symbolCount: number | null;
  searchStrategy?: 'on-demand' | 'indexed';
}

interface SymbolCandidate {
  id: string;
  name: string;
  path: string;
  line: number;
  language: string;
  kind?: string;
  signature: string;
  matchType: 'exact' | 'fuzzy';
  score: number;
}

interface RenderedLine {
  lineNumber: number;
  text: string;
  inFunction: boolean;
  isDeclaration: boolean;
}

interface RenderedSymbolPayload {
  symbol: SymbolCandidate;
  signature: string;
  functionStartLine: number;
  functionEndLine: number;
  snippetStartLine: number;
  snippetEndLine: number;
  beforeContext: number;
  afterContext: number;
  totalLines: number;
  lines: RenderedLine[];
}

interface CallRelationPathNode {
  name: string;
  symbol: SymbolCandidate | null;
  matchCount: number;
}

interface CallRelationPayload {
  source: SymbolCandidate;
  targetQuery: string;
  target: SymbolCandidate | null;
  relation: 'same' | 'direct' | 'indirect' | 'none';
  reachable: boolean;
  maxDepth: number;
  hopCount: number;
  visitedCount: number;
  path: CallRelationPathNode[];
  sourceMatchCount: number;
  targetMatchCount: number;
}

interface SessionOption {
  sessionId: string;
  host: string;
  username: string;
}

interface CommandRunRecord {
  id: string;
  ts: number;
  sessionId: string;
  sessionLabel: string;
  mode: 'pty' | 'exec';
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  functionCandidates: FunctionCandidateToken[];
}

/** 高亮计算完成前的纯文本 fallback，仅做 HTML 转义 */
function escapeHtmlPlain(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeClientId(prefix = 'ctx') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampPaneRatio(rawRatio: number, containerWidth: number) {
  if (!Number.isFinite(containerWidth) || containerWidth <= SPLIT_HANDLE_WIDTH) {
    return DEFAULT_SPLIT_RATIO;
  }

  const usableWidth = Math.max(1, containerWidth - SPLIT_HANDLE_WIDTH);
  const minRatio = Math.min(0.8, MIN_LEFT_PANEL_WIDTH / usableWidth);
  const maxRatio = Math.max(0.2, 1 - (MIN_RIGHT_PANEL_WIDTH / usableWidth));

  if (minRatio >= maxRatio) {
    return 0.5;
  }

  const safeRatio = Number.isFinite(rawRatio) ? rawRatio : DEFAULT_SPLIT_RATIO;
  return Math.min(maxRatio, Math.max(minRatio, safeRatio));
}

// 命令运行历史卡片 — React.memo 防止无关状态变化触发重渲染
const CommandRunCard = React.memo(function CommandRunCard({
  item,
  isDark,
  mutedBg,
  borderColor,
  activeFunctionToken,
  onCandidateClick,
  onTextSelect,
}: {
  item: CommandRunRecord;
  isDark: boolean;
  mutedBg: string;
  borderColor: string;
  activeFunctionToken: FunctionCandidateToken | null;
  onCandidateClick: (c: FunctionCandidateToken) => void;
  onTextSelect: (text: string) => void;
}) {
  return (
    <Card
      size="small"
      style={{ background: mutedBg, border: `1px solid ${borderColor}` }}
      title={
        <Space wrap>
          <Text strong>{item.sessionLabel}</Text>
          <Tag>{item.mode}</Tag>
          <Tag color={item.exitCode === 0 ? 'success' : 'error'}>exit {item.exitCode}</Tag>
          <Tag>{item.durationMs}ms</Tag>
        </Space>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Text code>{item.command}</Text>
        <div>
          <Text type="secondary">C 函数候选</Text>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {item.functionCandidates.length === 0 ? (
              <Text type="secondary">未从本次输出里识别到明显 C 函数名</Text>
            ) : (
              item.functionCandidates.map((candidate) => (
                <Tooltip key={`${item.id}-${candidate.token}`} title={candidate.sampleLine}>
                  <Tag
                    color={activeFunctionToken?.token === candidate.token ? 'magenta' : 'blue'}
                    style={{ cursor: 'pointer', paddingInline: 10 }}
                    onClick={() => onCandidateClick(candidate)}
                  >
                    {candidate.token} · {candidate.hits}
                  </Tag>
                </Tooltip>
              ))
            )}
          </div>
        </div>
        {item.stdout && (
          <div>
            <Text strong>stdout</Text>
            <ResizableOutput
              content={item.stdout}
              isDark={isDark} minHeight={56} maxHeight={220}
              onTextSelect={onTextSelect}
            />
          </div>
        )}
        {item.stderr && (
          <div>
            <Text strong>stderr</Text>
            <ResizableOutput
              content={item.stderr}
              isDark={isDark} minHeight={56} maxHeight={220}
              onTextSelect={onTextSelect}
            />
          </div>
        )}
      </Space>
    </Card>
  );
});

const CodeContextExplorer: React.FC = () => {
  const isDark = useGlobalStore((state) => state.theme === 'dark');
  const [messageApi, contextHolder] = message.useMessage();
  const [savedBinding, setSavedBinding] = useLocalStorage<CodeContextBindingDraft>('devutility-code-context-binding', {
    repo: '',
    branch: '',
    commit: '',
  });
  const [savedSplitRatio, setSavedSplitRatio] = useLocalStorage<number>('devutility-code-context-split-ratio', DEFAULT_SPLIT_RATIO);

  const [repo, setRepo] = useState(savedBinding.repo);
  const [branch, setBranch] = useState(savedBinding.branch);
  const [commit, setCommit] = useState(savedBinding.commit);
  const [token, setToken] = useState('');
  const [activeContexts, setActiveContexts] = useState<CodeContextBindingResult[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [openingContext, setOpeningContext] = useState(false);

  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [commandText, setCommandText] = useState('');
  const [commandMode, setCommandMode] = useState<'pty' | 'exec'>('pty');
  const [commandTimeoutMs, setCommandTimeoutMs] = useState(20000);
  const [executingCommand, setExecutingCommand] = useState(false);
  const [commandRuns, setCommandRuns] = useState<CommandRunRecord[]>([]);
  const [activeFunctionToken, setActiveFunctionToken] = useState<FunctionCandidateToken | null>(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SymbolCandidate[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolCandidate | null>(null);
  const [rendered, setRendered] = useState<RenderedSymbolPayload | null>(null);
  const [rendering, setRendering] = useState(false);
  const [beforeContext, setBeforeContext] = useState(DEFAULT_BEFORE_CONTEXT);
  const [afterContext, setAfterContext] = useState(DEFAULT_AFTER_CONTEXT);
  const [contentWidth, setContentWidth] = useState(0);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(savedSplitRatio);

  const [callers, setCallers] = useState<SymbolCandidate[]>([]);
  const [callees, setCallees] = useState<SymbolCandidate[]>([]);
  const [loadingCallChain, setLoadingCallChain] = useState(false);
  const [relationTargetQuery, setRelationTargetQuery] = useState('');
  const [relationMaxDepth, setRelationMaxDepth] = useState(8);
  const [relationLoading, setRelationLoading] = useState(false);
  const [relationResult, setRelationResult] = useState<CallRelationPayload | null>(null);

  const codePanelRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ left: number; width: number } | null>(null);
  const splitRatioRef = useRef(splitRatio);
  const pendingWheelExpandRef = useRef<'up' | 'down' | null>(null);
  const previousSnippetStartRef = useRef<number | null>(null);
  const renderKeyRef = useRef(0);

  const activeContext = activeContexts.find((c) => c.contextId === activeContextId) || null;
  // stable ref so searchFunctions useCallback doesn't recreate on every render
  const activeContextRef = useRef(activeContext);
  useEffect(() => { activeContextRef.current = activeContext; }, [activeContext]);

  // 异步语法高亮：分批次处理，利用 requestIdleCallback 不阶塞任意帧
  const HIGHLIGHT_CHUNK = 60; // 每次空闲切片处理的行数
  const [highlightedHtml, setHighlightedHtml] = useState<string[]>([]);
  const highlightVersionRef = useRef(0);
  // stable key：只有符号 id + 上下文行数变化时才重新高亮
  const highlightKey = rendered ? `${rendered.symbol.id}:${rendered.lines.length}` : '';

  useEffect(() => {
    if (!rendered?.lines?.length) { setHighlightedHtml([]); return; }
    const version = ++highlightVersionRef.current;
    const lines = rendered.lines;
    const dark = isDark;
    const result: string[] = new Array(lines.length);
    let offset = 0;
    let inBlock = false;

    const idleSupported = typeof requestIdleCallback !== 'undefined';
    const handles: number[] = [];

    function processChunk() {
      const end = Math.min(offset + HIGHLIGHT_CHUNK, lines.length);
      for (let i = offset; i < end; i++) {
        const { html, endsInBlockComment } = highlightCLine(lines[i].text, inBlock, dark);
        inBlock = endsInBlockComment;
        result[i] = html;
      }
      offset = end;
      if (offset < lines.length) {
        if (version !== highlightVersionRef.current) return;
        if (idleSupported) {
          handles.push(requestIdleCallback(processChunk, { timeout: 120 }));
        } else {
          handles.push(setTimeout(processChunk, 0) as unknown as number);
        }
      } else {
        if (version === highlightVersionRef.current) {
          setHighlightedHtml(result);
        }
      }
    }

    // 开始处理第一批（延迟到下一帧后）
    const startHandle = setTimeout(processChunk, 0);
    return () => {
      clearTimeout(startHandle);
      handles.forEach((h) => {
        if (idleSupported && typeof h === 'number') cancelIdleCallback(h);
        else clearTimeout(h);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, isDark]);

  // 虚拟滚动：用 rAF ref 节流，避免每个 scroll 事件都触发 React re-render
  const VIRTUAL_BUFFER = 40;
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRafRef = useRef<number | null>(null);

  const handlePanelScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = (e.currentTarget as HTMLDivElement).scrollTop;
    if (scrollRafRef.current !== null) return; // 当前帧已排队
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(top);
      scrollRafRef.current = null;
    });
  }, []);

  const visibleRange = useMemo(() => {
    if (!rendered?.lines || !rendered.lines.length) return { start: 0, end: 0 };
    const panelHeight = 820;
    const firstVisible = Math.max(0, Math.floor(scrollTop / APPROX_LINE_HEIGHT) - VIRTUAL_BUFFER);
    const lastVisible = Math.min(
      rendered.lines.length,
      Math.ceil((scrollTop + panelHeight) / APPROX_LINE_HEIGHT) + VIRTUAL_BUFFER
    );
    return { start: firstVisible, end: lastVisible };
  }, [scrollTop, rendered?.lines]);


  useEffect(() => {
    void fetchSessions();
    void fetchContexts();
  }, []);

  useEffect(() => {
    if (!activeContext || !selectedSymbol) return;
    void renderSelectedSymbol(activeContext.contextId, selectedSymbol.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext?.contextId, selectedSymbol?.id, beforeContext, afterContext]);

  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  useEffect(() => {
    setRelationResult(null);
  }, [activeContext?.contextId, selectedSymbol?.id]);

  useEffect(() => {
    const element = splitContainerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContentWidth(entry.contentRect.width);
    });

    observer.observe(element);
    setContentWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const dragState = splitDragRef.current;
      if (!dragState) return;

      const nextRatio = clampPaneRatio(
        (event.clientX - dragState.left - (SPLIT_HANDLE_WIDTH / 2)) / Math.max(1, dragState.width - SPLIT_HANDLE_WIDTH),
        dragState.width
      );
      splitRatioRef.current = nextRatio;
      setSplitRatio(nextRatio);
    };

    const stopDragging = () => {
      if (!splitDragRef.current) return;
      splitDragRef.current = null;
      setIsDraggingSplit(false);
      setSavedSplitRatio(splitRatioRef.current);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', stopDragging);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stopDragging);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [setSavedSplitRatio]);

  async function fetchSessions() {
    setLoadingSessions(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions`);
      const data = await response.json();
      const nextSessions = Array.isArray(data.sessions) ? (data.sessions as SessionOption[]) : [];
      setSessions(nextSessions);
      if (!selectedSessionId && nextSessions[0]?.sessionId) {
        setSelectedSessionId(nextSessions[0].sessionId);
      }
    } catch {
      messageApi.warning('未获取到可用节点，请先在 SSH Manager 中建立会话');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function fetchContexts() {
    try {
      const response = await fetch(`${PROXY_HTTP}/api/code-context/contexts`);
      const data = await response.json();
      if (data.ok && Array.isArray(data.data)) {
        const contexts = data.data as CodeContextBindingResult[];
        setActiveContexts(contexts);
        if (contexts.length > 0 && !activeContextId) {
          setActiveContextId(contexts[0].contextId);
        }
      }
    } catch {
      // silently ignore if server not running
    }
  }

  async function openContext() {
    const trimmedRepo = repo.trim();
    const trimmedBranch = branch.trim();
    const trimmedCommit = commit.trim();

    if (!trimmedRepo || !trimmedBranch || !trimmedCommit) {
      messageApi.warning('请填写 repo、branch 和 commit');
      return;
    }

    setOpeningContext(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/code-context/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: trimmedRepo,
          branch: trimmedBranch,
          commit: trimmedCommit,
          token: token.trim(),
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        messageApi.error(data.error || '代码上下文绑定失败');
        return;
      }

      const nextContext = data.data as CodeContextBindingResult;
      setActiveContexts((prev) => {
        const filtered = prev.filter((c) => c.contextId !== nextContext.contextId);
        return [...filtered, nextContext];
      });
      setActiveContextId(nextContext.contextId);
      setSavedBinding({
        repo: trimmedRepo,
        branch: trimmedBranch,
        commit: trimmedCommit,
      });
      setResults([]);
      setSelectedSymbol(null);
      setRendered(null);
      setActiveFunctionToken(null);
      setBeforeContext(DEFAULT_BEFORE_CONTEXT);
      setAfterContext(DEFAULT_AFTER_CONTEXT);
      if (typeof nextContext.symbolCount === 'number') {
        messageApi.success(`已绑定 C 代码版本，索引符号 ${nextContext.symbolCount} 个`);
      } else {
        messageApi.success('已绑定 C 代码版本，大仓库将按需检索符号定义');
      }
    } catch {
      messageApi.error('代码上下文绑定失败');
    } finally {
      setOpeningContext(false);
    }
  }

  async function removeContext(contextId: string) {
    try {
      await fetch(`${PROXY_HTTP}/api/code-context/contexts/${encodeURIComponent(contextId)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
    let nextActiveId: string | null = activeContextId;
    const nextContexts = activeContexts.filter((c) => c.contextId !== contextId);
    if (activeContextId === contextId) {
      nextActiveId = nextContexts.length > 0 ? nextContexts[0].contextId : null;
      setActiveContextId(nextActiveId);
      // Clear stale search/render state when the active context is removed
      setResults([]);
      setSelectedSymbol(null);
      setRendered(null);
      setCallers([]);
      setCallees([]);
    }
    setActiveContexts(nextContexts);
  }

  const searchFunctions = useCallback(async (nextQuery?: string) => {
    const effectiveQuery = String(nextQuery ?? query).trim();
    const ctx = activeContextRef.current;
    if (!ctx) {
      messageApi.warning('请先绑定 repo / branch / commit，对 C 代码建立上下文');
      return;
    }

    if (!effectiveQuery) {
      messageApi.warning('请输入搜索词');
      return;
    }

    setSelectedSymbol(null);
    setRendered(null);
    setCallers([]);
    setCallees([]);
    setSearching(true);
    try {
      const response = await fetch(
        `${PROXY_HTTP}/api/code-context/${encodeURIComponent(ctx.contextId)}/symbols?q=${encodeURIComponent(effectiveQuery)}&limit=80`
      );
      const data = await response.json();

      if (!data.ok) {
        messageApi.error(data.error || '符号搜索失败');
        return;
      }

      const nextResults = Array.isArray(data.data) ? (data.data as SymbolCandidate[]) : [];
      setResults(nextResults);

      if (nextResults.length === 0) {
        messageApi.info(`没有找到匹配符号：${effectiveQuery}`);
        return;
      }

      setBeforeContext(DEFAULT_BEFORE_CONTEXT);
      setAfterContext(DEFAULT_AFTER_CONTEXT);
      setSelectedSymbol(nextResults[0]);
    } catch {
      messageApi.error('符号搜索失败');
    } finally {
      setSearching(false);
    }
  // query 允许在回调内直接传入，不必作为 dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function renderSelectedSymbol(contextId: string, symbolId: string) {
    renderKeyRef.current += 1;
    const currentKey = renderKeyRef.current;
    setRendering(true);
    previousSnippetStartRef.current = rendered?.snippetStartLine ?? null;

    try {
      const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbolId,
          beforeContext,
          afterContext,
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        messageApi.error(data.error || '源码渲染失败');
        return;
      }

      const payload = data.data as RenderedSymbolPayload;
      if (currentKey !== renderKeyRef.current) return;
      setRendered(payload);

      // Load call chain
      void loadCallChain(contextId, symbolId, currentKey);

      const panel = codePanelRef.current;
      if (!panel) return;

      const expandDirection = pendingWheelExpandRef.current;
      if (expandDirection === 'up' && previousSnippetStartRef.current) {
        const addedLines = previousSnippetStartRef.current - payload.snippetStartLine;
        requestAnimationFrame(() => {
          panel.scrollTop += Math.max(0, addedLines) * APPROX_LINE_HEIGHT;
        });
      } else if (!expandDirection) {
        requestAnimationFrame(() => {
          panel.scrollTop = 0;
        });
      }
      pendingWheelExpandRef.current = null;
    } catch {
      messageApi.error('源码渲染失败');
    } finally {
      if (currentKey === renderKeyRef.current) {
        setRendering(false);
      }
    }
  }

  async function loadCallChain(contextId: string, symbolId: string, renderKey?: number) {
    setLoadingCallChain(true);
    try {
      const [callersRes, calleesRes] = await Promise.all([
        fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/symbols/${encodeURIComponent(symbolId)}/callers`),
        fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/symbols/${encodeURIComponent(symbolId)}/callees`),
      ]);
      const callersData = await callersRes.json();
      const calleesData = await calleesRes.json();

      if (renderKey !== undefined && renderKey !== renderKeyRef.current) return;
      setCallers(callersData.ok && Array.isArray(callersData.data) ? callersData.data : []);
      setCallees(calleesData.ok && Array.isArray(calleesData.data) ? calleesData.data : []);
    } catch {
      setCallers([]);
      setCallees([]);
    } finally {
      setLoadingCallChain(false);
    }
  }

  async function executeCommand() {
    const trimmedCommand = commandText.trim();
    if (!selectedSessionId) {
      messageApi.warning('请先选择一个节点');
      return;
    }
    if (!trimmedCommand) {
      messageApi.warning('请输入要执行的命令');
      return;
    }

    const session = sessions.find((item) => item.sessionId === selectedSessionId);
    setExecutingCommand(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions/${encodeURIComponent(selectedSessionId)}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: trimmedCommand,
          mode: commandMode,
          timeoutMs: commandTimeoutMs,
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        messageApi.error(data.error || '节点命令执行失败');
        return;
      }

      const result = data.data || {};
      const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const runRecord: CommandRunRecord = {
        id: makeClientId('cmd'),
        ts: Date.now(),
        sessionId: selectedSessionId,
        sessionLabel: session ? `${session.username}@${session.host}` : selectedSessionId,
        mode: commandMode,
        command: trimmedCommand,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        exitCode: Number(result.exitCode ?? 0),
        durationMs: Number(result.durationMs ?? 0),
        functionCandidates: extractFunctionCandidates(combinedOutput),
      };

      setCommandRuns((items) => [runRecord, ...items].slice(0, MAX_COMMAND_RUNS));
      messageApi.success(`命令执行完成，exit=${runRecord.exitCode}`);

      if (activeContext && runRecord.functionCandidates.length > 0) {
        // 用 setTimeout 将自动搜索消费延迟到下一个事件循环循环，
        // 避免和 "setCommandRuns + success toast" 在同一批 React 更新中堆叠导致卡顿
        setTimeout(() => {
          void handleFunctionCandidateClick(runRecord.functionCandidates[0]);
        }, 0);
      }
    } catch {
      messageApi.error('节点命令执行失败');
    } finally {
      setExecutingCommand(false);
    }
  }

  const handleFunctionCandidateClick = useCallback(async (candidate: FunctionCandidateToken) => {
    setActiveFunctionToken(candidate);
    setQuery(candidate.query);
    await searchFunctions(candidate.query);
  }, [searchFunctions]);

  const handleTextSelect = useCallback(async (text: string) => {
    if (!text || text.length < 2) return;
    setQuery(text);
    setActiveFunctionToken({ token: text, query: text, hits: 1, sampleLine: `手动选取: ${text}` });
    await searchFunctions(text);
  }, [searchFunctions]);

  function handleSelectSymbol(item: SymbolCandidate) {
    setSelectedSymbol(item);
    setBeforeContext(DEFAULT_BEFORE_CONTEXT);
    setAfterContext(DEFAULT_AFTER_CONTEXT);
    pendingWheelExpandRef.current = null;
  }

  async function analyzeCallRelation(nextTargetQuery?: string) {
    const effectiveTargetQuery = String(nextTargetQuery ?? relationTargetQuery).trim();
    if (!activeContext) {
      messageApi.warning('请先绑定 repo / branch / commit，对 C 代码建立上下文');
      return;
    }
    if (!selectedSymbol) {
      messageApi.warning('请先选中一个起点函数');
      return;
    }
    if (!effectiveTargetQuery) {
      messageApi.warning('请输入目标函数名');
      return;
    }

    setRelationLoading(true);
    setRelationTargetQuery(effectiveTargetQuery);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(activeContext.contextId)}/call-relation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromSymbolId: selectedSymbol.id,
          targetQuery: effectiveTargetQuery,
          maxDepth: relationMaxDepth,
        }),
      });
      const data = await response.json();

      if (!data.ok) {
        messageApi.error(data.error || '调用关系分析失败');
        setRelationResult(null);
        return;
      }

      setRelationResult(data.data as CallRelationPayload);
    } catch {
      messageApi.error('调用关系分析失败');
      setRelationResult(null);
    } finally {
      setRelationLoading(false);
    }
  }

  function handleCodeClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const funcCall = target.closest('.code-func-call');
    if (funcCall) {
      const funcName = funcCall.getAttribute('data-name');
      if (funcName && funcName !== selectedSymbol?.name) {
        setQuery(funcName);
        setActiveFunctionToken({ token: funcName, query: funcName, hits: 1, sampleLine: `代码内点击: ${funcName}` });
        void searchFunctions(funcName);
      }
    }
  }

  function expandContext(direction: 'up' | 'down') {
    if (!selectedSymbol || rendering) return;

    if (direction === 'up') {
      if (beforeContext >= MAX_BEFORE_CONTEXT) return;
      pendingWheelExpandRef.current = 'up';
      setBeforeContext((value) => Math.min(value + 20, MAX_BEFORE_CONTEXT));
      return;
    }

    if (afterContext >= MAX_AFTER_CONTEXT) return;
    pendingWheelExpandRef.current = 'down';
    setAfterContext((value) => Math.min(value + 40, MAX_AFTER_CONTEXT));
  }

  function handleCodeWheel(event: React.WheelEvent<HTMLDivElement>) {
    const panel = codePanelRef.current;
    if (!panel || !selectedSymbol || rendering) return;

    const nearTop = panel.scrollTop <= 0;
    const nearBottom = panel.scrollHeight - (panel.scrollTop + panel.clientHeight) <= 0;

    if (event.deltaY < 0 && nearTop && beforeContext < MAX_BEFORE_CONTEXT) {
      event.preventDefault();
      expandContext('up');
      return;
    }

    if (event.deltaY > 0 && nearBottom && afterContext < MAX_AFTER_CONTEXT) {
      event.preventDefault();
      expandContext('down');
    }
  }

  function handleSplitPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (contentWidth < STACK_LAYOUT_BREAKPOINT || !splitContainerRef.current) {
      return;
    }

    event.preventDefault();
    const bounds = splitContainerRef.current.getBoundingClientRect();
    splitDragRef.current = { left: bounds.left, width: bounds.width };
    setIsDraggingSplit(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resetSplitWidth() {
    splitRatioRef.current = DEFAULT_SPLIT_RATIO;
    setSplitRatio(DEFAULT_SPLIT_RATIO);
    setSavedSplitRatio(DEFAULT_SPLIT_RATIO);
  }

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';
  const mutedBg = isDark ? '#1f1f1f' : '#fafafa';
  const codeBg = isDark ? '#111827' : '#f8fafc';
  const isStackedLayout = contentWidth > 0 && contentWidth < STACK_LAYOUT_BREAKPOINT;
  const effectiveSplitRatio = clampPaneRatio(splitRatio, contentWidth || (MIN_LEFT_PANEL_WIDTH + MIN_RIGHT_PANEL_WIDTH + SPLIT_HANDLE_WIDTH));
  const leftPaneWidth = !contentWidth || isStackedLayout
    ? null
    : Math.round(Math.max(MIN_LEFT_PANEL_WIDTH, (contentWidth - SPLIT_HANDLE_WIDTH) * effectiveSplitRatio));
  const leftPaneContentWidth = leftPaneWidth ?? contentWidth;
  const isCompactBindingLayout = contentWidth > 0 && contentWidth < 1240;
  const isStackedBindingLayout = contentWidth > 0 && contentWidth < 860;
  const isCompactCommandLayout = leftPaneContentWidth > 0 && leftPaneContentWidth < 720;
  const isStackedCommandLayout = leftPaneContentWidth > 0 && leftPaneContentWidth < 560;
  const compactSearchButton = leftPaneContentWidth > 0 && leftPaneContentWidth < 620;

  const currentSession = sessions.find((item) => item.sessionId === selectedSessionId);

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}

      <div style={{ marginBottom: 20 }}>
        <Title level={2} style={{ margin: 0 }}>C 符号/源码定位</Title>
        <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          面向 C 代码库的符号检索、调用链可视化与节点命令联动。绑定 repo / branch / commit 后，左侧执行命令提取 C 符号，右侧渲染源码并支持点击跳转。
        </Paragraph>
      </div>

      <Card
        title="C 代码版本绑定"
        style={{ background: cardBg, border: `1px solid ${borderColor}`, marginBottom: 16 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isStackedBindingLayout
              ? 'minmax(0, 1fr)'
              : isCompactBindingLayout
              ? 'repeat(2, minmax(0, 1fr))'
              : 'minmax(220px, 1.4fr) minmax(180px, 0.7fr) minmax(180px, 0.9fr) minmax(180px, 0.9fr) auto',
            gap: 12,
            alignItems: 'start',
          }}
        >
          <Input
            prefix={<CodeOutlined />}
            placeholder="仓库 URL 或本地 repo 路径"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          />
          <Input
            prefix={<BranchesOutlined />}
            placeholder="branch name"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
          <Input
            prefix={<CodeOutlined />}
            placeholder="commit id"
            value={commit}
            onChange={(event) => setCommit(event.target.value)}
          />
          <Password
            placeholder="访问 token（可选）"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div style={{ gridColumn: isCompactBindingLayout ? '1 / -1' : undefined }}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={openingContext}
              onClick={() => void openContext()}
              style={{ width: '100%' }}
            >
              绑定并准备 C 代码
            </Button>
          </div>
        </div>
      </Card>

      {activeContexts.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text strong>已挂载仓库：</Text>
          {activeContexts.map((ctx) => (
            <Tag
              key={ctx.contextId}
              color={ctx.contextId === activeContextId ? 'processing' : 'default'}
              style={{ cursor: 'pointer', paddingInline: 10 }}
              onClick={() => {
                setActiveContextId(ctx.contextId);
                setResults([]);
                setSelectedSymbol(null);
                setRendered(null);
                setCallers([]);
                setCallees([]);
              }}
              closable
              onClose={(e) => {
                e.preventDefault();
                void removeContext(ctx.contextId);
              }}
              closeIcon={<CloseOutlined />}
            >
              {ctx.repoDisplayName} · {ctx.branch} · {ctx.commit.slice(0, 7)}
              {typeof ctx.symbolCount === 'number' ? ` (${ctx.symbolCount})` : ''}
            </Tag>
          ))}
        </div>
      )}

      <div
        ref={splitContainerRef}
        style={{
          display: 'grid',
          gridTemplateColumns: !leftPaneWidth
            ? 'minmax(0, 1fr)'
            : `${leftPaneWidth}px ${SPLIT_HANDLE_WIDTH}px minmax(0, 1fr)`,
          alignItems: 'start',
          width: '100%',
        }}
      >
        <div style={{ minWidth: 0, paddingRight: leftPaneWidth ? 8 : 0 }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card title="节点执行与 C 符号提取" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isStackedCommandLayout
                    ? 'minmax(0, 1fr)'
                    : isCompactCommandLayout
                    ? 'repeat(2, minmax(0, 1fr))'
                    : 'minmax(220px, 1fr) 110px 120px auto',
                  gap: 8,
                  alignItems: 'stretch',
                }}
              >
                <div style={{ gridColumn: isCompactCommandLayout ? '1 / -1' : undefined }}>
                  <Select
                    loading={loadingSessions}
                    value={selectedSessionId}
                    placeholder="选择已连接节点"
                    style={{ width: '100%' }}
                    options={sessions.map((item) => ({
                      value: item.sessionId,
                      label: `${item.username}@${item.host}`,
                    }))}
                    onChange={(value) => setSelectedSessionId(String(value))}
                  />
                </div>
                <Select
                  value={commandMode}
                  style={{ width: '100%' }}
                  options={[
                    { label: 'PTY', value: 'pty' },
                    { label: 'Exec', value: 'exec' },
                  ]}
                  onChange={(value) => setCommandMode(value as 'pty' | 'exec')}
                />
                <InputNumber
                  min={1000}
                  max={120000}
                  step={1000}
                  value={commandTimeoutMs}
                  onChange={(value) => setCommandTimeoutMs(Number(value || 20000))}
                  style={{ width: '100%' }}
                  addonAfter="ms"
                />
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => void fetchSessions()}
                  loading={loadingSessions}
                  style={{ width: '100%' }}
                >
                  刷新节点
                </Button>
              </div>

              {currentSession ? (
                <Text type="secondary">当前节点：{currentSession.username}@{currentSession.host}</Text>
              ) : (
                <Alert type="warning" showIcon message="请先在 SSH Manager 中建立节点会话" />
              )}

              <TextArea
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="输入排障命令，例如 tail -200 /path/to/log | grep -E 'panic|BUG|submit_bio|nvme_reset_work'"
              />

              <Space wrap>
                <Button
                  type="primary"
                  icon={<CodeOutlined />}
                  loading={executingCommand}
                  onClick={() => void executeCommand()}
                >
                  在节点执行
                </Button>
                {activeFunctionToken && (
                  <Tag color="magenta">当前选中：{activeFunctionToken.token}</Tag>
                )}
              </Space>

              {commandRuns.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="节点执行结果会出现在这里，并自动抽取 C 函数候选" />
              ) : (
                <List
                  size="small"
                  dataSource={commandRuns}
                  renderItem={(item) => (
                    <List.Item style={{ display: 'block', paddingInline: 0 }}>
                      <CommandRunCard
                        item={item}
                        isDark={isDark}
                        mutedBg={mutedBg}
                        borderColor={borderColor}
                        activeFunctionToken={activeFunctionToken}
                        onCandidateClick={(c) => void handleFunctionCandidateClick(c)}
                        onTextSelect={(text) => void handleTextSelect(text)}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Space>
          </Card>

          <Card title="C 符号检索" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Search
                placeholder="可手动补充 C 函数/类型名搜索，例如 submit_bio 或 struct request_queue"
                value={query}
                enterButton={compactSearchButton ? <SearchOutlined /> : <><SearchOutlined /> 搜索</>}
                onChange={(event) => setQuery(event.target.value)}
                onSearch={(value) => void searchFunctions(value)}
                loading={searching}
                disabled={!activeContext}
              />

              {!activeContext ? (
                <Alert type="warning" showIcon message="请先绑定 C 代码版本，再执行节点命令或搜索符号" />
              ) : results.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧抽取出的 C 函数候选后，匹配结果会列在这里" />
              ) : (
                <List
                  size="small"
                  dataSource={results}
                  renderItem={(item) => (
                    <List.Item
                      onClick={() => handleSelectSymbol(item)}
                      style={{
                        cursor: 'pointer',
                        borderRadius: 8,
                        paddingInline: 10,
                        background: selectedSymbol?.id === item.id
                          ? (isDark ? '#1e3a5f' : '#eff6ff')
                          : 'transparent',
                      }}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <Text strong>{item.name}</Text>
                            {item.kind && (
                              <Tag color={SYMBOL_KIND_COLOR[item.kind] || 'default'}>
                                {SYMBOL_KIND_LABEL[item.kind] || item.kind}
                              </Tag>
                            )}
                            <Tag color={item.matchType === 'exact' ? 'success' : 'default'}>{item.matchType}</Tag>
                          </Space>
                        }
                        description={
                          <Space direction="vertical" size={4} style={{ width: '100%' }}>
                            <Text code>{item.path}:{item.line}</Text>
                            <Text type="secondary" ellipsis>{item.signature}</Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Space>
          </Card>
          </Space>
        </div>

        {leftPaneWidth && (
          <div
            onPointerDown={handleSplitPointerDown}
            onDoubleClick={resetSplitWidth}
            title="拖拽调整左右宽度，双击恢复默认布局"
            style={{
              minHeight: 640,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              cursor: 'col-resize',
              userSelect: 'none',
              touchAction: 'none',
              padding: '0 2px',
            }}
          >
            <div
              style={{
                width: 2,
                borderRadius: 999,
                background: isDraggingSplit
                  ? (isDark ? '#60a5fa' : '#2563eb')
                  : (isDark ? '#4b5563' : '#cbd5e1'),
                boxShadow: isDraggingSplit
                  ? `0 0 0 4px ${isDark ? 'rgba(96, 165, 250, 0.18)' : 'rgba(37, 99, 235, 0.12)'}`
                  : 'none',
                transition: isDraggingSplit ? 'none' : 'background 0.2s ease, box-shadow 0.2s ease',
              }}
            />
          </div>
        )}

        <div style={{ minWidth: 0, paddingLeft: leftPaneWidth ? 8 : 0, marginTop: leftPaneWidth ? 0 : 16 }}>
          <Card
            title="符号源码"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
            extra={
              rendered && (
                <Space wrap>
                  <Button size="small" onClick={() => expandContext('up')} disabled={rendering || beforeContext >= MAX_BEFORE_CONTEXT}>
                    上文 +20
                  </Button>
                  <Button size="small" onClick={() => expandContext('down')} disabled={rendering || afterContext >= MAX_AFTER_CONTEXT}>
                    下文 +40
                  </Button>
                </Space>
              )
            }
          >
            {!selectedSymbol ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="左侧执行节点命令后点击符号候选，右侧会实时渲染对应源码" />
            ) : rendering && !rendered ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}>
                <Spin />
              </div>
            ) : !rendered ? (
              <Alert type="warning" showIcon message="暂未加载到符号源码" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div style={{ background: mutedBg, borderRadius: 8, padding: 10 }}>
                    <Text type="secondary">符号</Text>
                    <div>
                      <Text strong>{rendered.symbol.name}</Text>
                      {rendered.symbol.kind && (
                        <Tag style={{ marginLeft: 8 }} color={SYMBOL_KIND_COLOR[rendered.symbol.kind] || 'default'}>
                          {SYMBOL_KIND_LABEL[rendered.symbol.kind] || rendered.symbol.kind}
                        </Tag>
                      )}
                    </div>
                  </div>
                  <div style={{ background: mutedBg, borderRadius: 8, padding: 10 }}>
                    <Text type="secondary">文件</Text>
                    <div><Text code>{rendered.symbol.path}:{rendered.symbol.line}</Text></div>
                  </div>
                  <div style={{ background: mutedBg, borderRadius: 8, padding: 10 }}>
                    <Text type="secondary">范围</Text>
                    <div><Text strong>{rendered.functionStartLine} - {rendered.functionEndLine}</Text></div>
                  </div>
                </div>

                <Alert
                  type="info"
                  showIcon
                  message={rendered.signature}
                  description="在代码面板顶部或底部继续滚轮，可以自动补更多上下文。点击代码中的函数调用可直接跳转定义。"
                />

                <div style={{ background: mutedBg, borderRadius: 8, padding: 12 }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <Text strong>间接调用关系分析</Text>
                      <div>
                        <Text type="secondary">
                          以当前函数 <Text code>{rendered.symbol.name}</Text> 为起点，判断它是否会直接或间接调用另一个指定函数，并展开最短调用链。
                        </Text>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: leftPaneContentWidth > 0 && leftPaneContentWidth < 760
                          ? 'minmax(0, 1fr)'
                          : 'minmax(0, 1fr) 120px',
                        gap: 10,
                        alignItems: 'center',
                      }}
                    >
                      <Search
                        allowClear
                        value={relationTargetQuery}
                        onChange={(event) => setRelationTargetQuery(event.target.value)}
                        onSearch={(value) => void analyzeCallRelation(value)}
                        placeholder="输入目标函数名，例如 convert_thread_options_to_net"
                        enterButton="分析链路"
                        loading={relationLoading}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text type="secondary">最大深度</Text>
                        <InputNumber
                          min={1}
                          max={24}
                          value={relationMaxDepth}
                          onChange={(value) => setRelationMaxDepth(Math.max(1, Math.min(Number(value) || 8, 24)))}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    {relationLoading && <Spin size="small" />}

                    {!relationLoading && relationResult && (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Alert
                          type={relationResult.reachable ? 'success' : 'warning'}
                          showIcon
                          message={
                            relationResult.reachable
                              ? relationResult.relation === 'same'
                                ? `${relationResult.source.name} 就是 ${relationResult.target?.name || relationResult.targetQuery}`
                                : relationResult.relation === 'direct'
                                  ? `发现直接调用: ${relationResult.source.name} -> ${relationResult.target?.name || relationResult.targetQuery}`
                                  : `发现间接调用: ${relationResult.source.name} -> ${relationResult.target?.name || relationResult.targetQuery}`
                              : `未发现 ${relationResult.source.name} 到 ${relationResult.target?.name || relationResult.targetQuery} 的可达调用链`
                          }
                          description={
                            relationResult.reachable
                              ? `共 ${relationResult.hopCount} 跳，搜索深度上限 ${relationResult.maxDepth}，遍历 ${relationResult.visitedCount} 个函数节点。`
                              : `已在深度 ${relationResult.maxDepth} 内遍历 ${relationResult.visitedCount} 个函数节点，但没有找到到达目标函数的路径。`
                          }
                        />

                        {(relationResult.sourceMatchCount > 1
                          || relationResult.targetMatchCount > 1
                          || relationResult.path.some((item) => item.matchCount > 1)) && (
                          <Alert
                            type="info"
                            showIcon
                            message="检测到同名函数"
                            description="当前调用图按函数名建立；如果同名函数在多个文件里同时存在，链路判断会按函数名级别推断，点击节点时默认打开其中一个定义位置。"
                          />
                        )}

                        {relationResult.reachable && relationResult.path.length > 0 && (
                          <div>
                            <Text type="secondary">最短调用链</Text>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                              {relationResult.path.map((item, index) => (
                                <React.Fragment key={`${item.name}-${index}`}>
                                  <Tag
                                    color={index === 0 ? 'processing' : index === relationResult.path.length - 1 ? 'geekblue' : 'default'}
                                    onClick={() => item.symbol && handleSelectSymbol(item.symbol)}
                                    style={{ cursor: item.symbol ? 'pointer' : 'default', paddingInline: 10 }}
                                  >
                                    {item.name}
                                    {item.matchCount > 1 ? ` (${item.matchCount})` : ''}
                                  </Tag>
                                  {index < relationResult.path.length - 1 && <Text type="secondary">→</Text>}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        )}
                      </Space>
                    )}
                  </Space>
                </div>

                <Collapse ghost defaultActiveKey={[]}>
                  <Panel
                    header={<Text strong>调用者 ({callers.length})</Text>}
                    key="callers"
                  >
                    {loadingCallChain ? (
                      <Spin size="small" />
                    ) : callers.length === 0 ? (
                      <Text type="secondary">未找到调用者</Text>
                    ) : (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {callers.map((caller) => (
                          <div
                            key={caller.id}
                            style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4, background: isDark ? '#1e293b' : '#f1f5f9' }}
                            onClick={() => handleSelectSymbol(caller)}
                          >
                            <Text strong>{caller.name}</Text>
                            <Text type="secondary" style={{ marginLeft: 8 }} code>{caller.path}:{caller.line}</Text>
                          </div>
                        ))}
                      </Space>
                    )}
                  </Panel>
                  <Panel
                    header={<Text strong>被调用者 ({callees.length})</Text>}
                    key="callees"
                  >
                    {loadingCallChain ? (
                      <Spin size="small" />
                    ) : callees.length === 0 ? (
                      <Text type="secondary">未找到被调用者</Text>
                    ) : (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {callees.map((callee) => (
                          <div
                            key={callee.id}
                            style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4, background: isDark ? '#1e293b' : '#f1f5f9' }}
                            onClick={() => handleSelectSymbol(callee)}
                          >
                            <Text strong>{callee.name}</Text>
                            <Text type="secondary" style={{ marginLeft: 8 }} code>{callee.path}:{callee.line}</Text>
                          </div>
                        ))}
                      </Space>
                    )}
                  </Panel>
                </Collapse>

                <div
                  ref={codePanelRef}
                  onWheel={handleCodeWheel}
                  onClick={handleCodeClick}
                  onScroll={handlePanelScroll}
                  style={{
                    height: 820,
                    overflow: 'auto',
                    borderRadius: 8,
                    border: `1px solid ${borderColor}`,
                    background: codeBg,
                    padding: '10px 0',
                  }}
                >
                  {rendering && (
                    <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '0 12px 8px' }}>
                      <Tag color="processing">更新上下文中...</Tag>
                    </div>
                  )}

                  {/* 虚拟化：顶部占位空白 */}
                  {visibleRange.start > 0 && (
                    <div style={{ height: visibleRange.start * APPROX_LINE_HEIGHT }} />
                  )}

                  {rendered.lines.slice(visibleRange.start, visibleRange.end).map((line, relIdx) => {
                    const idx = visibleRange.start + relIdx;
                    return (
                    <div
                      key={line.lineNumber}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '72px 1fr',
                        gap: 12,
                        padding: '0 16px',
                        minHeight: APPROX_LINE_HEIGHT,
                        lineHeight: `${APPROX_LINE_HEIGHT}px`,
                        background: line.isDeclaration
                          ? (isDark ? 'rgba(59, 130, 246, 0.22)' : 'rgba(59, 130, 246, 0.12)')
                          : line.inFunction
                          ? (isDark ? 'rgba(15, 23, 42, 0.38)' : 'rgba(241, 245, 249, 0.92)')
                          : 'transparent',
                      }}
                    >
                      <Text
                        type="secondary"
                        style={{
                          userSelect: 'none',
                          textAlign: 'right',
                          fontFamily: 'JetBrains Mono, Fira Code, monospace',
                          fontSize: 12,
                        }}
                      >
                        {line.lineNumber}
                      </Text>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'JetBrains Mono, Fira Code, monospace',
                          fontSize: 12,
                          color: isDark ? '#e5e7eb' : '#111827',
                        }}
                        dangerouslySetInnerHTML={{ __html: highlightedHtml[idx] || escapeHtmlPlain(line.text) }}
                      />
                    </div>
                    );
                  })}

                  {/* 虚拟化：底部占位空白 */}
                  {rendered.lines.length > visibleRange.end && (
                    <div style={{ height: (rendered.lines.length - visibleRange.end) * APPROX_LINE_HEIGHT }} />
                  )}
                </div>
              </Space>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CodeContextExplorer;
