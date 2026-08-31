const SECRET_ASSIGNMENT =
  /\b(ARK_API_KEY|APP_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|OPENAI_API_KEY|BYTEPLUS_API_KEY)\b\s*([=:])\s*([^\s"'`]+)/gi;
const BEARER_TOKEN = /\b(Bearer\s+)([A-Za-z0-9._~+\/-]{8,})/gi;
const GENERIC_SK_TOKEN = /\b(sk-[A-Za-z0-9_-]{8,})\b/g;

export function redactSecrets(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT, (_match, key: string, separator: string) => {
      return key + separator + "[REDACTED]";
    })
    .replace(BEARER_TOKEN, "$1[REDACTED]")
    .replace(GENERIC_SK_TOKEN, "[REDACTED]");
}

export function summarizeSafely(value: string, maxLength = 500): string {
  const compact = redactSecrets(value).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return compact.slice(0, maxLength - 1) + "…";
}