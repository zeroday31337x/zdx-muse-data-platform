// Branch 3 (admin / model-tier, revised spec §2) unit tests — pure
// policy helpers only. Route behaviour needs a DB and is a staging
// validation item, not claimed from these tests.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { operatorMfaVerifiedFromClaims, hashOperatorToken, OPERATOR_COOKIE } from './operator-auth';
import { isLockedSettingKey, validateSettingValue, ceilingCheck, EDITABLE_SETTING_KEYS } from './platform-settings';
import { canTransition, isStalledLease } from './worker-transitions';

describe('operator MFA interpretation (strict)', () => {
  it('otp/sms/webauthn amr verifies; pwd-only or absent does not', () => {
    expect(operatorMfaVerifiedFromClaims({ amr: ['pwd', 'otp'] })).toBe(true);
    expect(operatorMfaVerifiedFromClaims({ amr: ['pwd'] })).toBe(false);
    expect(operatorMfaVerifiedFromClaims({})).toBe(false);
    expect(operatorMfaVerifiedFromClaims({ amr: ['sms'] })).toBe(true);
    expect(operatorMfaVerifiedFromClaims({ amr: ['webauthn'] })).toBe(true);
  });
  it('operator cookie is distinct from the tenant session cookie', () => {
    expect(OPERATOR_COOKIE).toBe('zdx_operator_session');
    expect(OPERATOR_COOKIE).not.toBe('zdx_session');
  });
  it('token hashing is deterministic and does not return the raw token', () => {
    const raw = 'a'.repeat(64);
    expect(hashOperatorToken(raw)).toBe(hashOperatorToken(raw));
    expect(hashOperatorToken(raw)).not.toBe(raw);
    expect(hashOperatorToken(raw)).toHaveLength(64);
  });
});

describe('platform settings policy', () => {
  it('locked keys are rejected, including secret/ceiling namespaces', () => {
    for (const k of ['compositionRatio70_30', 'tenantIsolation', 'provenanceRequired', 'auditAppendOnly', 'entitlementDerivation', 'secrets', 'tierAllowlist', 'resourceLimits', 'hardCeiling', 'stripeSecret', 'cognitoClient']) {
      expect(isLockedSettingKey(k)).toBe(true);
    }
    expect(isLockedSettingKey('announcement')).toBe(false);
  });
  it('editable keys validate their shapes', () => {
    expect(validateSettingValue('announcement', 'hello')).toBeNull();
    expect(validateSettingValue('announcement', null)).toBeNull();
    expect(validateSettingValue('announcement', 42)).toBe('INVALID_REQUEST');
    expect(validateSettingValue('maintenanceMode', true)).toBeNull();
    expect(validateSettingValue('maintenanceMode', 'yes')).toBe('INVALID_REQUEST');
    expect(validateSettingValue('supportEmail', 'ops@example.com')).toBeNull();
    expect(Object.keys(EDITABLE_SETTING_KEYS)).toEqual(expect.arrayContaining(['announcement', 'supportEmail', 'maintenanceMode']));
  });
  it('a cap above the hard ceiling is rejected; at/below passes; non-cap keys unaffected', () => {
    expect(ceilingCheck('dailyCapUsd', 100, 50)).toBe('SETTING_ABOVE_HARD_CEILING');
    expect(ceilingCheck('dailyCapUsd', 50, 50)).toBeNull();
    expect(ceilingCheck('announcement', 'x', 50)).toBeNull();
    // Compliance correction (C5 fail-closed): an unconfigured ceiling
    // no longer lets cap writes pass unchecked.
    expect(ceilingCheck('dailyCapUsd', 100, null)).toBe('HARD_CEILING_NOT_CONFIGURED');
  });
});

describe('admin workflow transitions (canonical state machine)', () => {
  it('pause/resume/cancel/retry map to legal transitions only', () => {
    expect(canTransition('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransition('QUEUED', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'QUEUED')).toBe(true);
    expect(canTransition('FAILED', 'QUEUED')).toBe(true);
    expect(canTransition('PARTIAL', 'QUEUED')).toBe(true);
    expect(canTransition('COMPLETED', 'PAUSED')).toBe(false);
    expect(canTransition('CANCELLED', 'QUEUED')).toBe(false);
  });
  it('reclaim-lease only for stalled (expired) RUNNING leases', () => {
    const past = new Date(Date.now() - 60000);
    const future = new Date(Date.now() + 60000);
    expect(isStalledLease({ status: 'RUNNING', leaseExpiresAt: past })).toBe(true);
    expect(isStalledLease({ status: 'RUNNING', leaseExpiresAt: future })).toBe(false);
    expect(isStalledLease({ status: 'QUEUED', leaseExpiresAt: past })).toBe(false);
    expect(isStalledLease({ status: 'RUNNING', leaseExpiresAt: null })).toBe(false);
  });
});

describe('schema contract (branch 3)', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  it('declares the operator/setting/audit models', () => {
    for (const m of ['model PlatformOperator', 'model PlatformOperatorSession', 'model PlatformSetting', 'model PlatformSettingVersion', 'model PlatformAuditLog']) {
      expect(schema).toContain(m);
    }
  });
  it('operator session has MFA record + expiry, no tenant-session reuse', () => {
    expect(schema).toContain('mfaVerifiedAt');
    expect(schema).toContain('tokenHash');
  });
});
