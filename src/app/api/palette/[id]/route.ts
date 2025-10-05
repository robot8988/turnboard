// src/app/api/palette/[id]/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs'; // ✅ Edge 환경일 경우 환경변수 접근 방지용

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> } // ✅ Next.js 15.5 타입 규칙 반영
) {
  const { id } = await params; // ✅ Promise 해제
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE!;
  const sb = createClient(url, key);

  // 0) 파일 정보 조회
  const { data, error } = await sb.from('palette').select('image_url').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 1) 보드 셀에서 참조 해제 (FK 에러 방지)
  const nulled = await sb.from('board_cells').update({ palette_id: null }).eq('palette_id', id);
  if (nulled.error) return NextResponse.json({ error: nulled.error.message }, { status: 500 });

  // 2) 스토리지 삭제
  if (data?.image_url) {
    const prefix = `${url}/storage/v1/object/public/palette/`;
    const path = data.image_url.startsWith(prefix) ? data.image_url.slice(prefix.length) : '';
    if (path) {
      const rm = await sb.storage.from('palette').remove([path]);
      if (rm.error) return NextResponse.json({ error: rm.error.message }, { status: 500 });
    }
  }

  // 3) 레코드 삭제
  const del = await sb.from('palette').delete().eq('id', id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
