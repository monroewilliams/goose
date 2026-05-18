import { createTwoFilesPatch } from 'diff';
import * as Prism from 'prismjs';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-markup.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-toml.js';
import { useEffect, useState } from 'react';

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
}

const extMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  py: 'python',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'markup',
  xml: 'markup',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  toml: 'toml',
};

function detectLanguage(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const lang = extMap[ext];
  if (!lang) return undefined;
  return lang;
}

const MAX_HIGHLIGHTED_LINES = 500;

function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
    }
    return true;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setDark((e as MediaQueryListEvent)?.matches ?? (e as MediaQueryList).matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return dark;
}

const darkTokenColors: Record<string, React.CSSProperties> = {
  comment: { color: '#6a737d', fontStyle: 'italic' },
  punctuation: { color: '#d4d4d4' },
  property: { color: '#ce9178' },
  number: { color: '#b5cea8' },
  string: { color: '#ce9178' },
  keyword: { color: '#569cd6' },
  boolean: { color: '#569cd6' },
  function: { color: '#dcdcaa' },
  'class-name': { color: '#4ec9b0' },
  constant: { color: '#4fc1ff' },
};

const lightTokenColors: Record<string, React.CSSProperties> = {
  comment: { color: '#008000', fontStyle: 'italic' },
  punctuation: { color: '#000000' },
  property: { color: '#a31515' },
  number: { color: '#098658' },
  string: { color: '#a31515' },
  keyword: { color: '#af00db' },
  boolean: { color: '#0000ff' },
  function: { color: '#795e26' },
  'class-name': { color: '#267f99' },
  constant: { color: '#0000ff' },
};

function getTokenColors(dark: boolean): Record<string, React.CSSProperties> {
  return dark ? darkTokenColors : lightTokenColors;
}

function renderTokens(
  tokens: Prism.TokenStream,
  tokenColors: Record<string, React.CSSProperties>,
): React.ReactNode {
  if (typeof tokens === 'string') return tokens;
  if (Array.isArray(tokens)) return tokens.map((t) => renderTokens(t, tokenColors));
  // It's a Token object
  if (!tokens) return null;
  // Filter out "no newline at end of file" annotations
  if (tokens.type === 'no newline') return null;
  const style = tokenColors[tokens.type] || {};
  return <span style={style}>{renderTokens(tokens.content, tokenColors)}</span>;
}

interface DiffLineWithSyntaxProps {
  line: DiffLine;
  language?: string;
  index: number;
  dark: boolean;
}

function DiffLineWithSyntax({ line, language, index, dark }: DiffLineWithSyntaxProps) {
  // Remove just the first character (+/-/space) to get the actual content
  const content = line.content.slice(1);
  const bg = line.type === 'added'
    ? (dark ? 'rgba(0,255,0,0.1)' : 'rgba(0,255,0,0.1)')
    : line.type === 'removed'
      ? (dark ? 'rgba(255,0,0,0.1)' : 'rgba(255,0,0,0.1)')
      : 'transparent';
  const textColor = dark ? '#c9d1d9' : '#1e1e1e';
  const prefixColor = line.type === 'added'
    ? (dark ? '#bbf7d0' : '#15803d')
    : line.type === 'removed'
      ? (dark ? '#fecaca' : '#b91c1c')
      : textColor;
  const prefix = line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ';
  const tc = getTokenColors(dark);

  if (!language || index >= MAX_HIGHLIGHTED_LINES) {
    return (
      <div
        style={{
          display: 'flex',
          background: bg,
          color: textColor,
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: '18px',
          whiteSpace: 'pre',
          padding: '0 8px',
        }}
      >
        <span style={{ color: prefixColor }}>{prefix}</span>
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>
      </div>
    );
  }

  const tokens = Prism.tokenize(content, Prism.languages[language]);
  return (
    <div
      style={{
        display: 'flex',
        background: bg,
        color: textColor,
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'pre',
        padding: '0 8px',
      }}
    >
      <span style={{ color: prefixColor }}>{prefix}</span>
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderTokens(tokens, tc)}</span>
    </div>
  );
}

interface DiffViewerProps {
  oldValue?: string;
  newValue?: string;
  fileName?: string;
}

export function DiffViewer({ oldValue, newValue, fileName }: DiffViewerProps) {
  const lines: DiffLine[] = [];
  const dark = useDarkMode();

  if (oldValue !== undefined && newValue !== undefined) {
    try {
      const patch = createTwoFilesPatch(fileName || 'file', fileName || 'file', oldValue, newValue, 'old', 'new');
      const diffLines = patch.split('\n').slice(4);
      for (const raw of diffLines) {
        if (raw.length === 0) continue;
        if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) continue;
        if (raw.startsWith('\\')) continue; // e.g. "\ No newline at end of file"
        const type: DiffLine['type'] = raw[0] === '+' ? 'added' : raw[0] === '-' ? 'removed' : 'context';
        lines.push({ type, content: raw });
      }
    } catch {
      // empty diff
    }
  }

  const language = detectLanguage(fileName);

  return (
    <div
      style={{
        border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
        borderRadius: '6px',
        overflow: 'auto',
        background: dark ? '#0d1117' : '#ffffff',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
          color: dark ? '#c9d1d9' : '#1e1e1e',
          fontFamily: 'monospace',
          fontSize: '13px',
        }}
      >
        {fileName}
      </div>
      <div style={{ fontSize: '12px' }}>
        {lines.map((line, i) => (
          <DiffLineWithSyntax key={i} line={line} language={language} index={i} dark={dark} />
        ))}
      </div>
    </div>
  );
}
