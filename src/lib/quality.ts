export type QualityReport = {
  total: number;
  completeness: number; // 0-1, non-empty fields / total fields
  uniqueness: number; // 0-1, unique record keys / total
  missingFields: Record<string, number>;
  duplicateKeys: number;
  issues: string[];
};

export function qualityReport(records: Record<string, unknown>[], keyField?: string): QualityReport {
  const total = records.length;
  if (total === 0) return { total: 0, completeness: 0, uniqueness: 0, missingFields: {}, duplicateKeys: 0, issues: ['EMPTY_DATASET'] };
  const fields = new Set<string>();
  records.forEach((r) => Object.keys(r).forEach((k) => fields.add(k)));
  let filled = 0; let cells = 0;
  const missing: Record<string, number> = {};
  for (const r of records) {
    for (const f of fields) {
      cells++;
      const v = r[f];
      if (v === null || v === undefined || v === '') missing[f] = (missing[f] ?? 0) + 1;
      else filled++;
    }
  }
  const seen = new Set<string>(); let dup = 0;
  for (const r of records) {
    const k = keyField ? String(r[keyField] ?? '') : JSON.stringify(r);
    if (seen.has(k)) dup++; else seen.add(k);
  }
  const issues: string[] = [];
  if (dup > 0) issues.push(`${dup} duplicate record keys`);
  if (filled / cells < 0.8) issues.push('Completeness below 80%');
  return { total, completeness: cells ? filled / cells : 0, uniqueness: total ? (total - dup) / total : 0, missingFields: missing, duplicateKeys: dup, issues };
}
