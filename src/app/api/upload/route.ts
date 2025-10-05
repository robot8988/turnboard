import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const name = (form.get('name') as string | null)?.trim() || 'palette';
  if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE!;
  const sb = createClient(url, key);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.split('.').pop() || 'png';
  const path = `uploaded/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const up = await sb.storage.from('palette').upload(path, bytes, { contentType: file.type || 'image/png' });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const { data: pub } = sb.storage.from('palette').getPublicUrl(path);
  const image_url = pub?.publicUrl;
  if (!image_url) return NextResponse.json({ error: '공개 URL 실패' }, { status: 500 });

  const ins = await sb.from('palette').insert({ name, image_url }).select('id,name,image_url').single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, palette: ins.data });
}
