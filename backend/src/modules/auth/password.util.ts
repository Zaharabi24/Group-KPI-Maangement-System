/**
 * Password policy and hashing — FR-AUTH-05, NFR-SEC-02.
 * Argon2id hashing with a live-policy validator used by both the API and the UI
 * checklist (the checklist mirrors `evaluatePasswordPolicy` in the frontend).
 */
import { hash, verify, Algorithm } from '@node-rs/argon2';

export interface PasswordPolicyResult {
  valid: boolean;
  failures: string[];
  checks: {
    length: boolean;
    upper: boolean;
    lower: boolean;
    digit: boolean;
    symbol: boolean;
    noEmailName: boolean;
    noWhitespace: boolean;
  };
}

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP baseline for Argon2id
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const evaluatePasswordPolicy = (password: string, email?: string): PasswordPolicyResult => {
  const min = Number(process.env.PASSWORD_MIN_LENGTH ?? 10);
  const max = Number(process.env.PASSWORD_MAX_LENGTH ?? 64);
  const checks = {
    length: password.length >= min && password.length <= max,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
    noEmailName: email ? !containsEmailName(password, email) : true,
    noWhitespace: !/\s/.test(password),
  };

  const labels: Record<keyof typeof checks, string> = {
    length: `${min}–${max} characters`,
    upper: 'At least one upper-case letter',
    lower: 'At least one lower-case letter',
    digit: 'At least one digit',
    symbol: 'At least one symbol',
    noEmailName: 'Must not contain your e-mail name',
    noWhitespace: 'No spaces',
  };

  const failures = (Object.keys(checks) as Array<keyof typeof checks>)
    .filter((k) => !checks[k])
    .map((k) => labels[k]);

  return { valid: failures.length === 0, failures, checks };
};

export const containsEmailName = (password: string, email: string): boolean => {
  const local = email.split('@')[0]?.trim().toLowerCase();
  if (!local || local.length < 3) return false;
  const lowerPassword = password.toLowerCase();
  // Guard short/naive local parts such as "hr" that would over-match.
  if (local.length < 4) return false;
  return lowerPassword.includes(local);
};

export const hashPassword = async (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

export const verifyPassword = async (hashed: string, password: string): Promise<boolean> => {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
};

/** A stable "needs rehash" heuristic used after a successful login. */
export const needsRehash = (hashed: string): boolean => !hashed.startsWith('$argon2id$');
