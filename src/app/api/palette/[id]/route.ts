// ✅ 항상 Node 런타임 + 동적 처리 + 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 500) {
  // 절대 HTML을 내지 않고 JSON만 반환
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    // 🔐 환경변수 점검 (없으면 바로 JSON 에러 반환)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
    if (!url)         return jsonError('Missing NEXT_PUBLIC_SUPABASE_URL', 500);
    if (!serviceKey)  return jsonError('Missing SUPABASE_SERVICE_ROLE', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const id = params.id;
    if (!id) return jsonError('Missing palette id', 400);

    // 1) 이 팔레트를 사용 중인 보드 셀 참조 끊기
    const { error: e1 } = await supabase
      .from('board_cells')
      .update({ palette_id: null })
      .eq('palette_id', id);
    if (e1) return jsonError(`board_cells update failed: ${e1.message}`, 500);

    // 2) 팔레트 행 삭제
    const { error: e2 } = await supabase
      .from('palette')
      .delete()
      .eq('id', id);
    if (e2) return jsonError(`palette delete failed: ${e2.message}`, 500);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    // 어떤 경우에도 HTML 말고 JSON으로
    return jsonError(`route crashed: ${String(err?.message ?? err)}`, 500);
  }
}

// (선택) GET 프로브: http://localhost:3000/api/palette/test 열면 JSON 떠야 정상
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: true, id: params.id });
}
