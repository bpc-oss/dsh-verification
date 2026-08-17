/**
 * 测试输出解析：从测试运行器的真实 stdout 提取 pass/fail 计数与失败清单。
 * 直接移植自 Bobby `packages/kernel/src/conscience/test-feedback.ts`。
 */
export interface TestFailure {
  title: string;
  file: string;
  message: string;
}

export interface ParsedTestOutput {
  passCount: number;
  failCount: number;
  failures: TestFailure[];
  files: string[];
  errorMessages: string[];
}

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
const MAX_MESSAGE_LINES = 3;
const TEST_HEADER = /^(?:FAIL|\u2717|\u00d7)\s+/i;
const TAP_HEADER = /^\s*not ok\s+\d+\s+-\s+/i;
const SUBTEST_HEADER = /^\s*#\s*Subtest:\s+/;
const FILE_PATTERN =
  /(?:[A-Za-z]:\\)?[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)*\.(?:test|spec)\.[jt]sx?(?:\?[^>\s]*)?/i;
const STACK_FILE_PATTERN = /\(([^()]+\.(?:test|spec)\.[jt]sx?(?:\?[^)]*)?):\d+:\d+\)/i;
const SUMMARY_LINE = /^\s*Test Files\b/i;

const normalize = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, '').trim();
const normalizeOutput = (text: string): string[] =>
  text.replace(/\r/g, '').split('\n').map((line) => normalize(line));

const parseSummaryCount = (line: string): { passCount?: number; failCount?: number } => {
  const passMatch = line.match(/(\d+)\s+pass(?:ed)?\b/i);
  const failMatch = line.match(/(\d+)\s+fail(?:ed)?\b/i);
  const nodePassMatch = line.match(/^#\s*pass\s+(\d+)/i);
  const nodeFailMatch = line.match(/^#\s*fail\s+(\d+)/i);

  return {
    passCount: passMatch ? Number.parseInt(passMatch[1], 10) : nodePassMatch
      ? Number.parseInt(nodePassMatch[1], 10)
      : undefined,
    failCount: failMatch ? Number.parseInt(failMatch[1], 10) : nodeFailMatch
      ? Number.parseInt(nodeFailMatch[1], 10)
      : undefined
  };
};

const isFailureHeader = (line: string): string | null => {
  if (TEST_HEADER.test(line) || TAP_HEADER.test(line) || SUBTEST_HEADER.test(line)) {
    return line;
  }
  return null;
};

const extractFileFromText = (text: string): string | null => {
  const fileMatch = text.match(FILE_PATTERN);
  return fileMatch ? fileMatch[0] : null;
};

const extractFileFromStack = (line: string): string | null => {
  const match = line.match(STACK_FILE_PATTERN);
  return match ? match[1].split(':')[0] : null;
};

const splitFailureTitle = (text: string): { title: string; file: string } => {
  const segments = text
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length > 1) {
    const file = extractFileFromText(segments[0]) ?? 'unknown';
    return {
      title: segments.slice(1).join(' > '),
      file
    };
  }

  const file = extractFileFromText(text);
  if (file) {
    const title = text.replace(file, '').replace(/^>\s*/, '').trim();
    return { title: title || 'failed test', file };
  }

  return { title: text || 'failed test', file: 'unknown' };
};

const shouldKeepMessageLine = (line: string): boolean => {
  if (!line || line.length === 0) {
    return false;
  }
  if (SUMMARY_LINE.test(line)) {
    return false;
  }
  if (/^\s*at\s+/.test(line)) {
    return false;
  }
  if (/^\s*(?:\d+\s+\||\u2500{2,}|[-=]{3,}|.*\.\.\/|.*\((?:node|internal)\.|.*\[(?:node|internal)\])/i.test(line)) {
    return false;
  }
  return true;
};

const formatFailureForSummary = (failure: TestFailure): string =>
  `${failure.file} :: ${failure.title}${failure.message ? ` \u2014 ${failure.message}` : ''}`;

interface ParseState {
  result: ParsedTestOutput;
  currentFailure: TestFailure | null;
  currentMessageLines: string[];
  failures: TestFailure[];
  files: Set<string>;
  errorMessages: Set<string>;
}

const createParseState = (): ParseState => ({
  result: {
    passCount: 0,
    failCount: 0,
    failures: [],
    files: [],
    errorMessages: []
  },
  currentFailure: null,
  currentMessageLines: [],
  failures: [],
  files: new Set<string>(),
  errorMessages: new Set<string>()
});

const flushCurrentFailure = (state: ParseState): void => {
  if (!state.currentFailure) {
    return;
  }

  const message = state.currentMessageLines.slice(0, MAX_MESSAGE_LINES).join(' -> ');
  const withMessage = message ? { ...state.currentFailure, message } : state.currentFailure;
  state.failures.push(withMessage);
  if (withMessage.file !== 'unknown') {
    state.files.add(withMessage.file);
  }
  if (withMessage.message) {
    state.errorMessages.add(withMessage.message);
  }
  state.currentFailure = null;
  state.currentMessageLines = [];
};

const applySummaryCount = (state: ParseState, line: string): void => {
  const summaryCount = parseSummaryCount(line);
  if (summaryCount.passCount !== undefined) {
    state.result.passCount = Math.max(state.result.passCount, summaryCount.passCount);
  }
  if (summaryCount.failCount !== undefined) {
    state.result.failCount = Math.max(state.result.failCount, summaryCount.failCount);
  }
};

const normalizeFailureHeader = (header: string): string => {
  if (TEST_HEADER.test(header)) {
    return header.replace(TEST_HEADER, '');
  }
  if (TAP_HEADER.test(header)) {
    return header.replace(TAP_HEADER, '');
  }
  if (SUBTEST_HEADER.test(header)) {
    return header.replace(SUBTEST_HEADER, '');
  }
  return header;
};

const startFailure = (state: ParseState, header: string): void => {
  flushCurrentFailure(state);
  const parsedHeader = splitFailureTitle(normalizeFailureHeader(header));
  state.currentFailure = {
    title: parsedHeader.title || 'failed test',
    file: parsedHeader.file || 'unknown',
    message: ''
  };
};

const inferFileFromStackLine = (state: ParseState, line: string): void => {
  if (!state.currentFailure || state.currentFailure.file !== 'unknown') {
    return;
  }

  const inferred = extractFileFromStack(line);
  if (inferred) {
    state.currentFailure.file = inferred;
    state.files.add(inferred);
  }
};

const consumeFailureDetailLine = (state: ParseState, line: string): void => {
  if (!state.currentFailure) {
    return;
  }
  if (/^\s*at\s+/.test(line)) {
    inferFileFromStackLine(state, line);
    return;
  }
  if (shouldKeepMessageLine(line) && state.currentMessageLines.length < MAX_MESSAGE_LINES) {
    state.currentMessageLines.push(line);
  }
};

export function parseTestOutput(text: string): ParsedTestOutput {
  const state = createParseState();
  for (const rawLine of normalizeOutput(text)) {
    applySummaryCount(state, rawLine);
    const header = isFailureHeader(rawLine);
    if (header) {
      startFailure(state, header);
      continue;
    }
    consumeFailureDetailLine(state, rawLine);
  }

  flushCurrentFailure(state);
  state.result.failures = state.failures.filter((failure) => failure.title || failure.file);
  state.result.files = Array.from(state.files);
  state.result.errorMessages = Array.from(state.errorMessages);
  return state.result;
}

export const formatTestFailureContext = (parsed: ParsedTestOutput): string => {
  const filteredFailures = parsed.failures.filter((entry) => entry.title || entry.file || entry.message);

  if (parsed.failCount === 0 && filteredFailures.length === 0) {
    return `pass=${parsed.passCount}, fail=${parsed.failCount}`;
  }

  const headers = [
    'Previous test failures (retry context):',
    `pass=${parsed.passCount}`,
    `fail=${parsed.failCount}`
  ];
  const failureLines = filteredFailures
    .slice(0, 5)
    .map((failure, index) => `${index + 1}. ${formatFailureForSummary(failure)}`);

  return [...headers, ...failureLines].join('\n');
};
