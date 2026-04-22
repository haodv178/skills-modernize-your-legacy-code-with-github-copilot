const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const OPERATION_CODES = {
  TOTAL: 'TOTAL ',
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT ',
  READ: 'READ',
  WRITE: 'WRITE',
};

const MAX_BALANCE_CENTS = 99999999;

class DataProgram {
  constructor() {
    this.storageBalanceCents = 100000;
  }

  run(operationType, balanceCents) {
    if (operationType === OPERATION_CODES.READ) {
      return this.storageBalanceCents;
    }

    if (operationType === OPERATION_CODES.WRITE) {
      this.storageBalanceCents = balanceCents;
      return this.storageBalanceCents;
    }

    return this.storageBalanceCents;
  }
}

class Operations {
  constructor(dataProgram, rl) {
    this.dataProgram = dataProgram;
    this.rl = rl;
  }

  async run(passedOperation) {
    const operationType = passedOperation;

    if (operationType === OPERATION_CODES.TOTAL) {
      const finalBalanceCents = this.dataProgram.run(OPERATION_CODES.READ);
      output.write(`Current balance: ${formatAmount(finalBalanceCents)}\n`);
      return;
    }

    if (operationType === OPERATION_CODES.CREDIT) {
      const amountCents = await promptForAmount(this.rl, 'Enter credit amount: ');
      if (amountCents === null) {
        output.write('Invalid numeric input.\n');
        return;
      }

      let finalBalanceCents = this.dataProgram.run(OPERATION_CODES.READ);
      finalBalanceCents += amountCents;

      if (!isValidCobolAmount(finalBalanceCents)) {
        output.write('Amount exceeds PIC 9(6)V99 range. Transaction rejected.\n');
        return;
      }

      this.dataProgram.run(OPERATION_CODES.WRITE, finalBalanceCents);
      output.write(`Amount credited. New balance: ${formatAmount(finalBalanceCents)}\n`);
      return;
    }

    if (operationType === OPERATION_CODES.DEBIT) {
      const amountCents = await promptForAmount(this.rl, 'Enter debit amount: ');
      if (amountCents === null) {
        output.write('Invalid numeric input.\n');
        return;
      }

      const finalBalanceCents = this.dataProgram.run(OPERATION_CODES.READ);
      if (finalBalanceCents >= amountCents) {
        const updatedBalanceCents = finalBalanceCents - amountCents;

        if (!isValidCobolAmount(updatedBalanceCents)) {
          output.write('Amount exceeds PIC 9(6)V99 range. Transaction rejected.\n');
          return;
        }

        this.dataProgram.run(OPERATION_CODES.WRITE, updatedBalanceCents);
        output.write(`Amount debited. New balance: ${formatAmount(updatedBalanceCents)}\n`);
      } else {
        output.write('Insufficient funds for this debit.\n');
      }
    }
  }
}

function formatAmount(cents) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

function parseAmountToCents(rawInput) {
  const normalized = rawInput.trim();
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const value = normalized.replace(/^[-+]/, '');
  const [wholePart, fractionalPart = ''] = value.split('.');
  const cents = Number.parseInt(wholePart, 10) * 100
    + Number.parseInt(fractionalPart.padEnd(2, '0') || '0', 10);
  return sign * cents;
}

function isValidCobolAmount(cents) {
  return Number.isInteger(cents) && cents >= -MAX_BALANCE_CENTS && cents <= MAX_BALANCE_CENTS;
}

async function promptForAmount(rl, message) {
  const rawAmount = await rl.question(`${message}`);
  return parseAmountToCents(rawAmount);
}

async function main() {
  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
  });
  const dataProgram = new DataProgram();
  const operations = new Operations(dataProgram, rl);

  let continueFlag = 'YES';

  try {
    while (continueFlag !== 'NO') {
      output.write('--------------------------------\n');
      output.write('Account Management System\n');
      output.write('1. View Balance\n');
      output.write('2. Credit Account\n');
      output.write('3. Debit Account\n');
      output.write('4. Exit\n');
      output.write('--------------------------------\n');

      const userChoice = await rl.question('Enter your choice (1-4): ');
      const choice = Number.parseInt(userChoice, 10);

      if (choice === 1) {
        await operations.run(OPERATION_CODES.TOTAL);
      } else if (choice === 2) {
        await operations.run(OPERATION_CODES.CREDIT);
      } else if (choice === 3) {
        await operations.run(OPERATION_CODES.DEBIT);
      } else if (choice === 4) {
        continueFlag = 'NO';
      } else {
        output.write('Invalid choice, please select 1-4.\n');
      }
    }

    output.write('Exiting the program. Goodbye!\n');
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { DataProgram, Operations, formatAmount, parseAmountToCents, isValidCobolAmount, OPERATION_CODES };