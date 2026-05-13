import { createTwoFilesPatch } from 'diff';

interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  fileName?: string;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  value: string;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const linesArr = diff.split('\n');

  for (const line of linesArr) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      lines.push({ type: 'added', value: line.slice(1) });
    } else if (line.startsWith('-')) {
      lines.push({ type: 'removed', value: line.slice(1) });
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'context', value: line.slice(1) });
    } else if (line === '' && lines.length > 0 && lines[lines.length - 1].value !== '') {
      lines.push({ type: 'context', value: '' });
    }
  }

  return lines;
}

export function DiffViewer({ oldValue, newValue, fileName }: DiffViewerProps) {
  const diff = createTwoFilesPatch(
    fileName ?? 'file',
    fileName ?? 'file',
    oldValue,
    newValue
  );

  const diffLines = parseUnifiedDiff(diff);

  if (diffLines.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <pre className="font-mono text-xs whitespace-pre-wrap max-w-full overflow-x-auto px-4 py-2">
        {diffLines.map((line, index) => {
          const sign = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

          return (
            <div
              key={index}
              className={`leading-relaxed ${
                line.type === 'added'
                  ? 'dark:bg-[#00ff00]/10 bg-[#00ff00]/10'
                  : line.type === 'removed'
                    ? 'dark:bg-[#ff0000]/10 bg-[#ff0000]/10'
                    : ''
              }`}
            >
              <span
                className={`select-none mr-3 ${
                  line.type === 'added'
                    ? 'dark:text-green-100 text-green-700'
                    : line.type === 'removed'
                      ? 'dark:text-red-100 text-red-700'
                      : 'text-text-tertiary'
                }`}
              >
                {sign}
              </span>
              <span className="text-text-primary">{line.value}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export default DiffViewer;
