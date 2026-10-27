import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, compositionOf } from '@/lib/store';
export const dynamic = 'force-dynamic';
const createSchema = z.object({ name: z.string().min(1).max(200), purpose: z.enum(['training', 'simulation']).default('training'), sourceName: z.string().max(200).default(''), sourceLicense: z.string().max(500).default('') });
export function GET() {
  const s = loadStore();
  return NextResponse.json(s.datasets.map((d) => ({ ...d, composition: compositionOf(s, d.id) })));
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  const s = loadStore();
  const ds = { id: newId('ds'), name: parsed.data.name, purpose: parsed.data.purpose, tenant: 'demo-tenant', createdAt: new Date().toISOString(), sourceName: parsed.data.sourceName, sourceLicense: parsed.data.sourceLicense, sourceChecksum: '' };
  s.datasets.push(ds); saveStore(s);
  return NextResponse.json(ds, { status: 201 });
}
