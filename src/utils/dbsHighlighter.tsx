import React from 'react';

type HighlightRule = {
  regex: RegExp;
  style: React.CSSProperties;
};

// Distributed Block Storage (DBS) 领域专用高亮规则库
const RULES: HighlightRule[] = [
  // GDB 提示符
  { regex: /^\(gdb\)/gm, style: { color: '#fbbf24', fontWeight: 'bold' } },
  // GDB 致命信号
  { regex: /Program received signal SIGSEGV.*/g, style: { color: '#ef4444', fontWeight: 'bold', background: '#450a0a' } },
  // GDB 调试栈地址
  { regex: /#\d+\s+0x[0-9a-fA-F]+/g, style: { color: '#f87171' } },
  // FIO 核心指标 (IOPS & Bandwidth)
  { regex: /IOPS=\d+(\.\d+)?[kK]?[M]?, BW=\d+(\.\d+)?[KMGT]?iB\/s/g, style: { color: '#10b981', fontWeight: 'bold' } },
  // FIO 延迟指标
  { regex: /lat\s+\([^)]+\):\s+min=\d+(\.\d+)?, max=\d+(\.\d+)?, avg=\d+(\.\d+)?/g, style: { color: '#f59e0b', fontWeight: 'bold' } },
  // CRC / Checksums
  { regex: /\b(?:crc(?:32[c]?)?|checksum)=?[0-9a-fA-F]+\b/gi, style: { color: '#d946ef', fontWeight: 'bold' } },
  // File Systems / Block Devices
  { regex: /\/dev\/(vd[a-z]+[0-9]*|md[0-9]+|sd[a-z]+[0-9]*)/g, style: { color: '#22c55e' } },
  { regex: /\b(?:xfs|ext4|btrfs)\b/gi, style: { color: '#86efac' } },
  // Network IP / Ports
  { regex: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]{1,5})?\b/g, style: { color: '#06b6d4' } },
  // UUIDs
  { regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, style: { color: '#8b5cf6' } },
  // WWN
  { regex: /\b(?:0x)?[0-9a-fA-F]{16}\b/g, style: { color: '#a855f7' } },
];

export const highlightDBSText = (text: string): React.ReactNode[] => {
  if (!text) return [];

  let elements: React.ReactNode[] = [text];

  RULES.forEach((rule, ruleIndex) => {
    const newElements: React.ReactNode[] = [];
    
    elements.forEach((el, elIndex) => {
      if (typeof el !== 'string') {
        newElements.push(el);
        return;
      }

      // 针对每个文本节点应用当前正则
      const matches = [...el.matchAll(rule.regex)];
      if (matches.length === 0) {
        newElements.push(el);
        return;
      }

      let lastIndex = 0;
      matches.forEach((match, matchIndex) => {
        const matchStart = match.index!;
        const matchEnd = matchStart + match[0].length;
        
        // Push preceding text
        if (matchStart > lastIndex) {
          newElements.push(el.substring(lastIndex, matchStart));
        }

        // Push highlighted span
        newElements.push(
          <span key={`hl-${ruleIndex}-${elIndex}-${matchIndex}`} style={rule.style}>
            {match[0]}
          </span>
        );

        lastIndex = matchEnd;
      });

      // Push remaining text
      if (lastIndex < el.length) {
        newElements.push(el.substring(lastIndex));
      }
    });

    elements = newElements;
  });

  return elements;
};

interface DBSHighlighterProps {
  text: string;
}

export const DBSHighlighter: React.FC<DBSHighlighterProps> = ({ text }) => {
  return <>{highlightDBSText(text)}</>;
};
