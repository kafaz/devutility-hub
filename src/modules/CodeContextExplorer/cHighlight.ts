/**
 * 轻量 C / C++ 语法高亮器 — 零依赖、纯正则
 *
 * 返回 HTML 片段字符串，需配合 dangerouslySetInnerHTML 使用。
 * 上下文安全：输入先 HTML-escape，再用 <span> 着色。
 */

const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else',
  'enum', 'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict',
  'return', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
  'volatile', 'while', '_Alignas', '_Alignof', '_Atomic', '_Bool',
  '_Complex', '_Generic', '_Imaginary', '_Noreturn', '_Static_assert',
  '_Thread_local',
  // C++ extras
  'class', 'namespace', 'template', 'typename', 'public', 'private',
  'protected', 'virtual', 'override', 'final', 'noexcept', 'constexpr',
  'nullptr', 'new', 'delete', 'try', 'catch', 'throw', 'using',
  'explicit', 'friend', 'mutable', 'operator', 'this',
]);

const C_TYPES = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed',
  'unsigned', 'bool', 'size_t', 'ssize_t', 'int8_t', 'int16_t', 'int32_t',
  'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'intptr_t',
  'uintptr_t', 'ptrdiff_t', 'wchar_t', 'FILE', 'NULL',
  'true', 'false',
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Token {
  type: 'keyword' | 'type' | 'string' | 'comment' | 'number' | 'preproc' | 'func' | 'plain';
  text: string;
}

/**
 * 单行分词器 — 用于行内高亮（不跨行）
 *
 * 注意：C 的多行注释跨行处理很复杂。这里做了简化处理：
 * 对已经处于多行注释中的行，调用方应传入 inBlockComment=true，
 * 高亮器会把整行作为注释输出。
 */
export function tokenizeCLine(line: string, inBlockComment = false): { tokens: Token[]; endsInBlockComment: boolean } {
  const tokens: Token[] = [];
  let pos = 0;
  let blockComment = inBlockComment;

  if (blockComment) {
    const endIdx = line.indexOf('*/');
    if (endIdx === -1) {
      tokens.push({ type: 'comment', text: line });
      return { tokens, endsInBlockComment: true };
    }
    tokens.push({ type: 'comment', text: line.slice(0, endIdx + 2) });
    pos = endIdx + 2;
    blockComment = false;
  }

  while (pos < line.length) {
    const rest = line.slice(pos);

    // 预处理指令
    if (pos === 0 || line.slice(0, pos).trim() === '') {
      const ppMatch = rest.match(/^(\s*#\s*\w+.*)/);
      if (ppMatch && (pos === 0 || line.slice(0, pos).trim() === '')) {
        tokens.push({ type: 'preproc', text: ppMatch[1] });
        pos += ppMatch[1].length;
        continue;
      }
    }

    // 行注释
    if (rest.startsWith('//')) {
      tokens.push({ type: 'comment', text: rest });
      pos = line.length;
      break;
    }

    // 块注释开始
    if (rest.startsWith('/*')) {
      const endIdx = rest.indexOf('*/', 2);
      if (endIdx === -1) {
        tokens.push({ type: 'comment', text: rest });
        pos = line.length;
        blockComment = true;
        break;
      }
      tokens.push({ type: 'comment', text: rest.slice(0, endIdx + 2) });
      pos += endIdx + 2;
      continue;
    }

    // 字符串
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === '\\') { end += 2; continue; }
        if (rest[end] === quote) { end += 1; break; }
        end += 1;
      }
      tokens.push({ type: 'string', text: rest.slice(0, end) });
      pos += end;
      continue;
    }

    // 数字
    const numMatch = rest.match(/^(0[xX][0-9a-fA-F]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*)/);
    if (numMatch) {
      tokens.push({ type: 'number', text: numMatch[1] });
      pos += numMatch[1].length;
      continue;
    }

    // 标识符
    const idMatch = rest.match(/^([A-Za-z_]\w*)/);
    if (idMatch) {
      const word = idMatch[1];
      const afterWord = rest.slice(word.length);
      if (C_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (C_TYPES.has(word)) {
        tokens.push({ type: 'type', text: word });
      } else if (/^\s*\(/.test(afterWord)) {
        tokens.push({ type: 'func', text: word });
      } else {
        tokens.push({ type: 'plain', text: word });
      }
      pos += word.length;
      continue;
    }

    // 其它字符（运算符、空格等）
    tokens.push({ type: 'plain', text: rest[0] });
    pos += 1;
  }

  return { tokens, endsInBlockComment: blockComment };
}

const DARK_COLORS: Record<Token['type'], string> = {
  keyword:  '#c586c0',
  type:     '#4ec9b0',
  string:   '#ce9178',
  comment:  '#6a9955',
  number:   '#b5cea8',
  preproc:  '#9cdcfe',
  func:     '#dcdcaa',
  plain:    '#d4d4d4',
};

const LIGHT_COLORS: Record<Token['type'], string> = {
  keyword:  '#af00db',
  type:     '#267f99',
  string:   '#a31515',
  comment:  '#008000',
  number:   '#098658',
  preproc:  '#0000ff',
  func:     '#795e26',
  plain:    '#1e1e1e',
};

export function highlightCLine(line: string, inBlockComment: boolean, isDark: boolean): { html: string; endsInBlockComment: boolean } {
  if (!line) return { html: ' ', endsInBlockComment: inBlockComment };

  const { tokens, endsInBlockComment } = tokenizeCLine(line, inBlockComment);
  const palette = isDark ? DARK_COLORS : LIGHT_COLORS;

  const html = tokens
    .map((t) => {
      const escaped = escapeHtml(t.text);
      if (t.type === 'plain') return escaped;
      const fontWeight = t.type === 'keyword' ? ';font-weight:600' : '';
      const fontStyle = t.type === 'comment' ? ';font-style:italic' : '';
      return `<span style="color:${palette[t.type]}${fontWeight}${fontStyle}">${escaped}</span>`;
    })
    .join('');

  return { html, endsInBlockComment };
}

/**
 * 对一组行批量高亮，正确处理跨行的 /* ... * / 块注释
 */
export function highlightCLines(lines: { text: string }[], isDark: boolean): string[] {
  let inBlock = false;
  return lines.map((line) => {
    const result = highlightCLine(line.text, inBlock, isDark);
    inBlock = result.endsInBlockComment;
    return result.html;
  });
}
