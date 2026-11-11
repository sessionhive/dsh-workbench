import { Fragment, type ReactNode } from 'react';

interface MarkdownProps {
  text: string;
  className?: string;
  /** 空内容时显示的文案。 */
  empty?: string;
}

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\))/g;

function renderInline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const tokenKey = `${key}-i${index}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={tokenKey}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={tokenKey}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const url = link[2].trim();
        nodes.push(
          <a
            key={tokenKey}
            href={url}
            className="md-link"
            title={url}
            onClick={(event) => {
              event.preventDefault();
              if (/^https?:\/\//i.test(url)) void window.desktop?.openExternal(url);
            }}
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = start + token.length;
    index += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function isBlockStart(line: string) {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^([-*+]|\d+\.)\s+/.test(line) ||
    /^---+$/.test(line.trim()) ||
    /^\|.*\|$/.test(line.trim())
  );
}

/** 轻量 Markdown 渲染：标题、列表、代码块、引用、表格、链接与行内样式。 */
export function Markdown({ text, className, empty = '暂无内容' }: MarkdownProps) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) {
    return <div className={`md-view md-empty ${className ?? ''}`}>{empty}</div>;
  }

  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 代码块
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={`code-${i}`} className="md-code" data-lang={lang || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`h-${i}`}>{renderInline(heading[2], `h${i}`)}</Tag>);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${i}`} />);
      i += 1;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={`q-${i}`}>{renderInline(quote.join(' '), `q${i}`)}</blockquote>,
      );
      continue;
    }

    // 表格
    if (
      /^\|.*\|$/.test(line.trim()) &&
      i + 1 < lines.length &&
      /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) &&
      lines[i + 1].includes('-')
    ) {
      const header = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim()),
        );
        i += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${i}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInline(cell, `th${i}-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, `td${i}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 有序 / 无序列表
    const listMatch = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        items.push(item[2]);
        i += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${i}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `li${i}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // 段落：收集到空行或下一个块开始
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`}>
        {paragraph.map((part, partIndex) => (
          <Fragment key={partIndex}>
            {partIndex > 0 && <br />}
            {renderInline(part, `p${i}-${partIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={`md-view ${className ?? ''}`}>{blocks}</div>;
}
