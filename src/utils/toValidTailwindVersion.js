export function toValidTailwindVersion(value, defaultVersion = 2) {
  if (value === 1 || value === 2) return value
  return defaultVersion
}
