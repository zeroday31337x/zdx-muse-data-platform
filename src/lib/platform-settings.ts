// Platform settings policy (revised spec §2.5). LOCKED keys are shown
// read-only and REJECTED (403 SETTING_LOCKED), never silently
// ignored. A value above the hard ceiling is rejected at write time
// (400 SETTING_ABOVE_HARD_CEILING) and clamped at call time (the
// resolver already takes min(per-job, admin, hard) — see
// model-resolver). Editable keys in v1 are deliberately narrow:
// announcement/support contact only. Tier allowlists and resource
// limits are server config in v1 and are exposed read-only by their
// admin routes; dashboard edits to them are locked (SETTING_LOCKED)
// until a separate decision makes them settings-backed.
export const LOCKED_SETTING_KEYS = new Set([
  'compositionRatio70_30', 'tenantIsolation', 'provenanceRequired',
  'auditAppendOnly', 'entitlementDerivation', 'secrets',
  'tierAllowlist', 'resourceLimits', 'hardCeiling',
  'stripe', 'cognito', 'metaApiKey',
]);

export const EDITABLE_SETTING_KEYS: Record<string, 'string' | 'string|null' | 'boolean'> = {
  announcement: 'string|null',
  supportEmail: 'string',
  maintenanceMode: 'boolean',
};

export function isLockedSettingKey(key: string): boolean {
  if (LOCKED_SETTING_KEYS.has(key)) return true;
  // Prefix guards: no setting may shadow a secret or ceiling namespace.
  return /^(stripe|cognito|metaApi|hardCeiling|secret)/i.test(key);
}

/** Validate an editable setting value's shape. Returns an error code or null. */
export function validateSettingValue(key: string, value: unknown): string | null {
  const kind = EDITABLE_SETTING_KEYS[key];
  if (!kind) return 'SETTING_LOCKED';
  if (kind === 'string' && typeof value !== 'string') return 'INVALID_REQUEST';
  if (kind === 'string|null' && value !== null && typeof value !== 'string') return 'INVALID_REQUEST';
  if (kind === 'boolean' && typeof value !== 'boolean') return 'INVALID_REQUEST';
  if (typeof value === 'string' && value.length > 2000) return 'INVALID_REQUEST';
  return null;
}

/**
 * Hard-ceiling write guard (revised §2.5): any numeric cap setting
 * above the hard ceiling is rejected. In v1 no editable key is a cap,
 * so this is defense-in-depth for future cap settings, and it is
 * unit-tested as such. Compliance correction: when the hard ceiling
 * is NOT configured, cap writes are rejected outright
 * (HARD_CEILING_NOT_CONFIGURED) instead of passing unchecked — an
 * unconfigured ceiling must never silently permit a cap above it.
 */
export function ceilingCheck(key: string, value: unknown, hardCeilingUsd: number | null): string | null {
  if (!/cap/i.test(key)) return null;
  if (typeof value !== 'number') return null;
  if (hardCeilingUsd === null) return 'HARD_CEILING_NOT_CONFIGURED';
  if (value > hardCeilingUsd) return 'SETTING_ABOVE_HARD_CEILING';
  return null;
}
