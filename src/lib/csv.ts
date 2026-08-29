function normalizeHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

function pushNonEmptyRow(rows: string[][], row: string[]) {
  if (row.some((value) => value.trim() !== '')) {
    rows.push(row);
  }
}

function isEscapedQuote(source: string, index: number, inQuotes: boolean) {
  return inQuotes && source[index + 1] === '"';
}

function isUnquotedDelimiter(char: string, inQuotes: boolean) {
  return char === ',' && !inQuotes;
}

function isUnquotedLineBreak(char: string, inQuotes: boolean) {
  return (char === '\n' || char === '\r') && !inQuotes;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  const source = text.replace(/^\uFEFF/, '');

  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

    if (char === '"') {
      if (isEscapedQuote(source, index, inQuotes)) {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (isUnquotedDelimiter(char, inQuotes)) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (isUnquotedLineBreak(char, inQuotes)) {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }

      currentRow.push(currentValue);
      pushNonEmptyRow(rows, currentRow);
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  currentRow.push(currentValue);
  pushNonEmptyRow(rows, currentRow);

  return rows;
}

export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0]!.map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index]?.trim() ?? '';
    });
    return record;
  });
}
