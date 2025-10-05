import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE!;
  const sb = createClient(url, key);

  const { data } = await sb.from('palette').select('id,name').ilike('name', 'wall').limit(1).maybeSingle();
  if (data) return NextResponse.json({ id: data.id });

  const ins = await sb.from('palette').insert({ name: 'WALL', image_url: null }).select('id').single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  return NextResponse.json({ id: ins.data.id });
}
