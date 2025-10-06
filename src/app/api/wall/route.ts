import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // WALL 행 조회
    const { data: found, error: e1 } = await supabase
      .from('palette')
      .select('id,name,image_url')
      .ilike('name', 'wall')
      .maybeSingle();
    if (e1) throw e1;
    if (found) return NextResponse.json({ id: found.id });

    // 없으면 생성 (이미지 없이 name=WALL)
    const { data: created, error: e2 } = await supabase
      .from('palette')
      .insert({ name: 'WALL', image_url: null })
      .select('id')
      .single();
    if (e2) throw e2;

    return NextResponse.json({ id: created.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
