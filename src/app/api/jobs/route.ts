import { NextResponse } from 'next/server';
import { loadStore } from '@/lib/store';
export const dynamic = 'force-dynamic';
export function GET() { const s = loadStore(); return NextResponse.json(s.jobs.slice(-50).reverse()); }
