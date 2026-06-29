// Canonical email normalization — apply on EVERY read and write path so a
// case/whitespace variant can never create a second account or lock one out.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
