import { ValidationError } from "./errors";

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function checkDigit(base: string): number {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const first = checkDigit(digits.slice(0, 12));
  const second = checkDigit(digits.slice(0, 12) + first);
  return digits.endsWith(`${first}${second}`);
}

/** Returns the 14-digit CNPJ or throws. */
export function normalizeCnpj(value: string): string {
  const digits = onlyDigits(value);
  if (!isValidCnpj(digits)) throw new ValidationError(`Invalid CNPJ: ${value}`);
  return digits;
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value).padStart(14, "0");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
