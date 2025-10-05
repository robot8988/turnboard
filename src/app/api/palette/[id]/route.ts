import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE!;
  const sb = createClient(url, key);
  const id = params.id;

  // 0) 어떤 파일인지 확인
  const { data, error } = await sb.from('palette').select('image_url').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 1) 보드 셀에서 참조 해제 (FK 에러 방지)
  const nulled = await sb.from('board_cells').update({ palette_id: null }).eq('palette_id', id);
  if (nulled.error) return NextResponse.json({ error: nulled.error.message }, { status: 500 });

  // 2) Storage 삭제
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
