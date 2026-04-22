'use strict';

const {
  DataProgram,
  Operations,
  formatAmount,
  parseAmountToCents,
  isValidCobolAmount,
  OPERATION_CODES,
} = require('./index');

// Helper: create an Operations instance with a mock readline
function makeOperations(dataProgram, answers = []) {
  let callIndex = 0;
  const rl = {
    question: jest.fn(() => Promise.resolve(answers[callIndex++] ?? '0')),
  };
  const ops = new Operations(dataProgram, rl);
  return { ops, rl };
}

// Capture stdout writes during a test
function captureOutput(fn) {
  const lines = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (msg) => { lines.push(msg); return true; };
  const result = fn();
  const restore = () => { process.stdout.write = original; };
  if (result && typeof result.then === 'function') {
    return result.finally(restore).then(() => lines);
  }
  restore();
  return lines;
}

// ─── DataProgram ─────────────────────────────────────────────────────────────

describe('DataProgram', () => {
  test('TC-001: initial balance is 1000.00 (100000 cents)', () => {
    const dp = new DataProgram();
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-002: READ is non-mutating', () => {
    const dp = new DataProgram();
    const first = dp.run(OPERATION_CODES.READ);
    const second = dp.run(OPERATION_CODES.READ);
    expect(first).toBe(second);
  });

  test('WRITE stores a new balance, READ retrieves it', () => {
    const dp = new DataProgram();
    dp.run(OPERATION_CODES.WRITE, 50000);
    expect(dp.run(OPERATION_CODES.READ)).toBe(50000);
  });

  test('TC-014: each new DataProgram instance resets to default 1000.00', () => {
    const dp1 = new DataProgram();
    dp1.run(OPERATION_CODES.WRITE, 200000);
    const dp2 = new DataProgram();
    expect(dp2.run(OPERATION_CODES.READ)).toBe(100000);
  });
});

// ─── Operations – View Balance (TOTAL) ───────────────────────────────────────

describe('Operations.run – TOTAL (view balance)', () => {
  test('TC-001/TC-002: displays initial balance of 1000.00', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.TOTAL));
    expect(lines.join('')).toContain('1000.00');
  });

  test('TC-002: calling TOTAL twice returns same balance', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp);
    const lines1 = await captureOutput(() => ops.run(OPERATION_CODES.TOTAL));
    const lines2 = await captureOutput(() => ops.run(OPERATION_CODES.TOTAL));
    expect(lines1.join('')).toBe(lines2.join(''));
  });
});

// ─── Operations – Credit ─────────────────────────────────────────────────────

describe('Operations.run – CREDIT', () => {
  test('TC-003: credit 250.00 raises balance from 1000.00 to 1250.00', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['250.00']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.CREDIT));
    expect(lines.join('')).toContain('1250.00');
    expect(dp.run(OPERATION_CODES.READ)).toBe(125000);
  });

  test('TC-004: multiple credits accumulate correctly (100 + 50 = 1150.00)', async () => {
    const dp = new DataProgram();
    const { ops: ops1 } = makeOperations(dp, ['100.00']);
    await captureOutput(() => ops1.run(OPERATION_CODES.CREDIT));
    const { ops: ops2 } = makeOperations(dp, ['50.00']);
    await captureOutput(() => ops2.run(OPERATION_CODES.CREDIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(115000);
  });

  test('TC-009: zero-value credit is accepted; balance unchanged', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['0.00']);
    await captureOutput(() => ops.run(OPERATION_CODES.CREDIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-015: large credit within PIC 9(6)V99 range is accepted', async () => {
    const dp = new DataProgram();
    dp.run(OPERATION_CODES.WRITE, 0);
    const { ops } = makeOperations(dp, ['999999.99']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.CREDIT));
    expect(lines.join('')).toContain('999999.99');
    expect(dp.run(OPERATION_CODES.READ)).toBe(99999999);
  });

  test('TC-018: non-numeric credit input is rejected with error message', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['abc']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.CREDIT));
    expect(lines.join('')).toContain('Invalid numeric input');
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-020: negative credit amount is accepted by current implementation', async () => {
    const dp = new DataProgram();
    const initialBalance = dp.run(OPERATION_CODES.READ);
    const { ops } = makeOperations(dp, ['-100.00']);
    await captureOutput(() => ops.run(OPERATION_CODES.CREDIT));
    // Current code has no rule blocking negatives; record the actual outcome
    const newBalance = dp.run(OPERATION_CODES.READ);
    expect(newBalance).toBe(initialBalance - 10000);
  });
});

// ─── Operations – Debit ──────────────────────────────────────────────────────

describe('Operations.run – DEBIT', () => {
  test('TC-005: debit 200.00 reduces balance from 1000.00 to 800.00', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['200.00']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    expect(lines.join('')).toContain('800.00');
    expect(dp.run(OPERATION_CODES.READ)).toBe(80000);
  });

  test('TC-006: debit equal to balance leaves balance at 0.00', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['1000.00']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    expect(lines.join('')).toContain('0.00');
    expect(dp.run(OPERATION_CODES.READ)).toBe(0);
  });

  test('TC-007: debit exceeding balance is rejected with insufficient-funds message', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['1000.01']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    expect(lines.join('')).toContain('Insufficient funds');
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-008: failed debit leaves balance unchanged; subsequent credit succeeds', async () => {
    const dp = new DataProgram();
    const { ops: debitOps } = makeOperations(dp, ['1500.00']);
    await captureOutput(() => debitOps.run(OPERATION_CODES.DEBIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);

    const { ops: creditOps } = makeOperations(dp, ['200.00']);
    await captureOutput(() => creditOps.run(OPERATION_CODES.CREDIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(120000);
  });

  test('TC-010: zero-value debit is accepted; balance unchanged', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['0.00']);
    await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-016: debit reads latest stored balance, not stale value', async () => {
    const dp = new DataProgram();
    const { ops: creditOps } = makeOperations(dp, ['200.00']);
    await captureOutput(() => creditOps.run(OPERATION_CODES.CREDIT));
    const { ops: debitOps } = makeOperations(dp, ['100.00']);
    await captureOutput(() => debitOps.run(OPERATION_CODES.DEBIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(110000);
  });

  test('TC-019: non-numeric debit input is rejected with error message', async () => {
    const dp = new DataProgram();
    const { ops } = makeOperations(dp, ['xyz']);
    const lines = await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    expect(lines.join('')).toContain('Invalid numeric input');
    expect(dp.run(OPERATION_CODES.READ)).toBe(100000);
  });

  test('TC-021: negative debit amount behavior – recorded for stakeholder review', async () => {
    const dp = new DataProgram();
    const initialBalance = dp.run(OPERATION_CODES.READ);
    const { ops } = makeOperations(dp, ['-100.00']);
    await captureOutput(() => ops.run(OPERATION_CODES.DEBIT));
    // Negative amount passes balance >= amount check; records actual runtime behavior
    const newBalance = dp.run(OPERATION_CODES.READ);
    expect(newBalance).toBe(initialBalance + 10000);
  });
});

// ─── Multi-operation session ──────────────────────────────────────────────────

describe('Multi-operation session (TC-013)', () => {
  test('credit then debit in same session reflects correct running balance', async () => {
    const dp = new DataProgram();

    const { ops: creditOps } = makeOperations(dp, ['300.00']);
    await captureOutput(() => creditOps.run(OPERATION_CODES.CREDIT));
    expect(dp.run(OPERATION_CODES.READ)).toBe(130000);

    const { ops: debitOps } = makeOperations(dp, ['50.00']);
    await captureOutput(() => debitOps.run(OPERATION_CODES.CREDIT));
    // Actually should be debit per TC-013 — use DEBIT:
    // Re-run with correct operation
    const dp2 = new DataProgram();
    const { ops: c } = makeOperations(dp2, ['300.00']);
    await captureOutput(() => c.run(OPERATION_CODES.CREDIT));
    const { ops: d } = makeOperations(dp2, ['50.00']);
    await captureOutput(() => d.run(OPERATION_CODES.DEBIT));
    expect(dp2.run(OPERATION_CODES.READ)).toBe(125000);
  });
});

// ─── Helper functions ────────────────────────────────────────────────────────

describe('formatAmount', () => {
  test('formats 100000 cents as "1000.00"', () => {
    expect(formatAmount(100000)).toBe('1000.00');
  });
  test('formats 0 cents as "0.00"', () => {
    expect(formatAmount(0)).toBe('0.00');
  });
  test('formats negative cents with minus sign', () => {
    expect(formatAmount(-50)).toBe('-0.50');
  });
});

describe('parseAmountToCents', () => {
  test('parses "250.00" to 25000', () => {
    expect(parseAmountToCents('250.00')).toBe(25000);
  });
  test('parses "0.00" to 0', () => {
    expect(parseAmountToCents('0.00')).toBe(0);
  });
  test('returns null for non-numeric input', () => {
    expect(parseAmountToCents('abc')).toBeNull();
  });
  test('parses negative amounts', () => {
    expect(parseAmountToCents('-100.00')).toBe(-10000);
  });
});

describe('isValidCobolAmount', () => {
  test('accepts 0', () => expect(isValidCobolAmount(0)).toBe(true));
  test('accepts MAX_BALANCE_CENTS (99999999)', () => expect(isValidCobolAmount(99999999)).toBe(true));
  test('rejects value above MAX', () => expect(isValidCobolAmount(100000000)).toBe(false));
  test('rejects non-integer', () => expect(isValidCobolAmount(1.5)).toBe(false));
});
