export function parseEnvBool(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

export function envFlag(name: string, fallback = false): boolean {
  return parseEnvBool(process.env[name], fallback);
}
