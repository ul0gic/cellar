import { LIMITS } from './limits.ts';

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'negate'; operand: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

export type ExpressionErrorCode =
  | 'empty'
  | 'too_long'
  | 'unexpected_character'
  | 'unexpected_token'
  | 'unexpected_end'
  | 'unclosed_parenthesis'
  | 'unknown_name'
  | 'forward_reference';

export interface ExpressionError {
  code: ExpressionErrorCode;
  position: number;
  message: string;
}

export type ParseResult = { ok: true; expr: Expr; names: string[] } | { ok: false; error: ExpressionError };

export interface CalculatorIssue {
  path: string;
  error: { code: ExpressionErrorCode | 'duplicate_key' | 'invalid_key'; position: number; message: string };
}

export interface CalculatorOutputValue {
  key: string;
  value: number | null;
  text: string;
  error: string | null;
}

interface CalculatorFieldsInput {
  readonly key: string;
  readonly label: string;
  readonly defaultValue: number;
}

interface CalculatorFieldsOutput {
  readonly key: string;
  readonly expression: string;
  readonly decimals: number;
  readonly suffix: string;
}

interface CalculatorFields {
  readonly inputs: readonly CalculatorFieldsInput[];
  readonly outputs: readonly CalculatorFieldsOutput[];
}

type Operator = '+' | '-' | '*' | '/';
type Token =
  | { kind: 'number'; value: number; text: string; position: number }
  | { kind: 'name'; text: string; position: number }
  | { kind: 'operator'; text: Operator; position: number }
  | { kind: 'open' | 'close'; text: string; position: number };

interface NameUse {
  name: string;
  position: number;
}

type InternalParse = { ok: true; expr: Expr; uses: NameUse[] } | { ok: false; error: ExpressionError };

class ExpressionFailure extends Error {
  readonly detail: ExpressionError;

  constructor(detail: ExpressionError) {
    super(detail.message);
    this.detail = detail;
  }
}

const NAME_PATTERN = /^[a-z_][a-z0-9_]{0,31}$/;
const NAME_MAX = 32;

const messages = {
  empty: () => 'Enter a formula.',
  tooLong: () => 'Keep the formula under 200 characters.',
  unexpectedCharacter: (char: string) => `“${char}” can't be used in a formula.`,
  unexpectedToken: (token: string) => `Something is missing before “${token}”.`,
  unexpectedEnd: () => 'The formula ends too early.',
  unclosedParenthesis: () => 'A bracket is never closed.',
  unknownName: (name: string) => `There's no input called “${name}”.`,
  forwardReference: (name: string) => `“${name}” is worked out further down. Move this line below it.`,
  duplicateKey: (key: string) => `Two lines use the name “${key}”.`,
  invalidKey: () => 'Use lowercase letters, numbers and _ , starting with a letter.',
  dividesByZero: () => 'Divides by zero.',
  enterNumber: (label: string) => `Enter a number for ${label}.`,
};

function fail(code: ExpressionErrorCode, position: number, message: string): never {
  throw new ExpressionFailure({ code, position, message });
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isNameStart(char: string): boolean {
  return (char >= 'a' && char <= 'z') || char === '_';
}

function isNamePart(char: string | undefined): boolean {
  return char !== undefined && (isNameStart(char) || isDigit(char));
}

function readNumber(source: string, start: number): Token {
  let end = start;
  while (isDigit(source[end])) {
    end += 1;
  }
  if (source[end] === '.' && isDigit(source[end + 1])) {
    end += 1;
    while (isDigit(source[end])) {
      end += 1;
    }
  }
  const text = source.slice(start, end);
  return { kind: 'number', value: Number(text), text, position: start };
}

function readName(source: string, start: number): Token {
  let end = start;
  while (isNamePart(source[end])) {
    if (end - start === NAME_MAX) {
      fail('unexpected_character', end, messages.unexpectedCharacter(source.charAt(end)));
    }
    end += 1;
  }
  return { kind: 'name', text: source.slice(start, end), position: start };
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
    } else if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const token = readNumber(source, index);
      tokens.push(token);
      index += token.text.length;
    } else if (isNameStart(char)) {
      const token = readName(source, index);
      tokens.push(token);
      index += token.text.length;
    } else if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ kind: 'operator', text: char, position: index });
      index += 1;
    } else if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'open' : 'close', text: char, position: index });
      index += 1;
    } else {
      fail('unexpected_character', index, messages.unexpectedCharacter(char));
    }
  }
  return tokens;
}

class Parser {
  private readonly tokens: readonly Token[];
  private readonly end: number;
  private index = 0;
  readonly uses: NameUse[] = [];

  constructor(tokens: readonly Token[], end: number) {
    this.tokens = tokens;
    this.end = end;
  }

  parse(): Expr {
    const expr = this.expression();
    const extra = this.tokens[this.index];
    if (extra !== undefined) {
      fail('unexpected_token', extra.position, messages.unexpectedToken(extra.text));
    }
    return expr;
  }

  private peekOperator(...operators: Operator[]): Operator | null {
    const token = this.tokens[this.index];
    return token?.kind === 'operator' && operators.includes(token.text) ? token.text : null;
  }

  private expression(): Expr {
    let left = this.term();
    for (let op = this.peekOperator('+', '-'); op !== null; op = this.peekOperator('+', '-')) {
      this.index += 1;
      left = { kind: 'binary', op, left, right: this.term() };
    }
    return left;
  }

  private term(): Expr {
    let left = this.unary();
    for (let op = this.peekOperator('*', '/'); op !== null; op = this.peekOperator('*', '/')) {
      this.index += 1;
      left = { kind: 'binary', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.peekOperator('-') !== null) {
      this.index += 1;
      return { kind: 'negate', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Expr {
    const token = this.tokens[this.index];
    if (token === undefined) {
      return fail('unexpected_end', this.end, messages.unexpectedEnd());
    }
    this.index += 1;
    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: token.value };
      case 'name':
        this.uses.push({ name: token.text, position: token.position });
        return { kind: 'name', name: token.text };
      case 'open': {
        const inner = this.expression();
        const close = this.tokens[this.index];
        if (close === undefined) {
          return fail('unclosed_parenthesis', token.position, messages.unclosedParenthesis());
        }
        if (close.kind !== 'close') {
          return fail('unexpected_token', close.position, messages.unexpectedToken(close.text));
        }
        this.index += 1;
        return inner;
      }
      case 'operator':
      case 'close':
        return fail('unexpected_token', token.position, messages.unexpectedToken(token.text));
    }
  }
}

function parseWithUses(source: string): InternalParse {
  if (source.trim() === '') {
    return { ok: false, error: { code: 'empty', position: 0, message: messages.empty() } };
  }
  if (source.length > LIMITS.expression.max) {
    return {
      ok: false,
      error: { code: 'too_long', position: LIMITS.expression.max, message: messages.tooLong() },
    };
  }
  try {
    const parser = new Parser(tokenize(source), source.length);
    const expr = parser.parse();
    return { ok: true, expr, uses: parser.uses };
  } catch (error) {
    if (error instanceof ExpressionFailure) {
      return { ok: false, error: error.detail };
    }
    throw error;
  }
}

export function parseExpression(source: string): ParseResult {
  const result = parseWithUses(source);
  if (!result.ok) {
    return result;
  }
  return { ok: true, expr: result.expr, names: [...new Set(result.uses.map((use) => use.name))] };
}

export function validateCalculator(calculator: CalculatorFields): CalculatorIssue[] {
  const issues: CalculatorIssue[] = [];
  const seen = new Set<string>();
  const checkKey = (key: string, path: string): void => {
    if (!NAME_PATTERN.test(key)) {
      issues.push({ path, error: { code: 'invalid_key', position: 0, message: messages.invalidKey() } });
    } else if (seen.has(key)) {
      issues.push({ path, error: { code: 'duplicate_key', position: 0, message: messages.duplicateKey(key) } });
    }
    seen.add(key);
  };
  for (const [index, input] of calculator.inputs.entries()) {
    checkKey(input.key, `inputs.${index}.key`);
  }
  for (const [index, output] of calculator.outputs.entries()) {
    checkKey(output.key, `outputs.${index}.key`);
  }

  const inputKeys = new Set(calculator.inputs.map((input) => input.key));
  const outputIndex = new Map<string, number>();
  for (const [index, output] of calculator.outputs.entries()) {
    if (!outputIndex.has(output.key)) {
      outputIndex.set(output.key, index);
    }
  }
  for (const [index, output] of calculator.outputs.entries()) {
    const issue = expressionIssue(output.expression, index, inputKeys, outputIndex);
    if (issue !== null) {
      issues.push({ path: `outputs.${index}.expression`, error: issue });
    }
  }
  return issues;
}

function expressionIssue(
  expression: string,
  index: number,
  inputKeys: ReadonlySet<string>,
  outputIndex: ReadonlyMap<string, number>,
): ExpressionError | null {
  const parsed = parseWithUses(expression);
  if (!parsed.ok) {
    return parsed.error;
  }
  for (const use of parsed.uses) {
    if (inputKeys.has(use.name)) {
      continue;
    }
    const defined = outputIndex.get(use.name);
    if (defined === undefined) {
      return { code: 'unknown_name', position: use.position, message: messages.unknownName(use.name) };
    }
    if (defined >= index) {
      return { code: 'forward_reference', position: use.position, message: messages.forwardReference(use.name) };
    }
  }
  return null;
}

type Evaluated = { value: number } | { error: string };

function evaluate(expr: Expr, scope: ReadonlyMap<string, Evaluated>): Evaluated {
  switch (expr.kind) {
    case 'number':
      return { value: expr.value };
    case 'name':
      return scope.get(expr.name) ?? { error: messages.unknownName(expr.name) };
    case 'negate': {
      const operand = evaluate(expr.operand, scope);
      return 'error' in operand ? operand : { value: -operand.value };
    }
    case 'binary': {
      const left = evaluate(expr.left, scope);
      if ('error' in left) {
        return left;
      }
      const right = evaluate(expr.right, scope);
      if ('error' in right) {
        return right;
      }
      switch (expr.op) {
        case '+':
          return { value: left.value + right.value };
        case '-':
          return { value: left.value - right.value };
        case '*':
          return { value: left.value * right.value };
        case '/':
          return right.value === 0 ? { error: messages.dividesByZero() } : { value: left.value / right.value };
      }
    }
  }
}

export function evaluateCalculator(
  calculator: CalculatorFields,
  values: Readonly<Record<string, number | null>>,
): CalculatorOutputValue[] {
  const scope = new Map<string, Evaluated>();
  for (const input of calculator.inputs) {
    const value = Object.hasOwn(values, input.key) ? values[input.key] : input.defaultValue;
    scope.set(
      input.key,
      value === null || !Number.isFinite(value) ? { error: messages.enterNumber(input.label) } : { value },
    );
  }
  return calculator.outputs.map((output) => {
    const parsed = parseWithUses(output.expression);
    const result: Evaluated = parsed.ok ? evaluate(parsed.expr, scope) : { error: parsed.error.message };
    scope.set(output.key, result);
    if ('error' in result) {
      return { key: output.key, value: null, text: '—', error: result.error };
    }
    const text = result.value.toFixed(output.decimals);
    return {
      key: output.key,
      value: result.value,
      text: output.suffix === '' ? text : `${text} ${output.suffix}`,
      error: null,
    };
  });
}
