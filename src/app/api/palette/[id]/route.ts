import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Ctx = { params: Promise<{ id: string }> };

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE; // ✅ env 이름 확인
    if (!url) return err('Missing NEXT_PUBLIC_SUPABASE_URL', 500);
    if (!serviceKey) return err('Missing SUPABASE_SERVICE_ROLE', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { id } = await params; // ✅ Next15: await params

    // 팔레트를 쓰던 셀 모두 비우기
    const { error: e1 } = await supabase
      .from('board_cells')
      .update({ palette_id: null })
      .eq('palette_id', id);
    if (e1) return err(`board_cells update failed: ${e1.message}`, 500);

    // 팔레트 삭제 (테이블명: palette)
    const { error: e2 } = await supabase
      .from('palette')
      .delete()
      .eq('id', id);
    if (e2) return err(`palette delete failed: ${e2.message}`, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return err(`route crashed: ${e.message ?? String(e)}`, 500);
  }
}

// 디버그용
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ ok: true, id });
}
