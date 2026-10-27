import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export function GET() { return NextResponse.json({service:'zdx-muse-data-platform',status:'bootstrapped',inference:'not-configured',dataProcessing:'not-configured'}, {headers:{'Cache-Control':'no-store'}}); }
