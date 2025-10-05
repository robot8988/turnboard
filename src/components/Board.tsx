'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import PaletteUploader, { UploadedPalette } from './PaletteUploader';

type DBPalette = { id: string; name: string | null; image_url: string | null };
type Cell = {
  id: number; x: number; y: number;
  palette_id: string | null;
  palette?: { name: string | null; image_url: string | null } | null;
};

const CELL = 72;
const BOARD_W = 9 * CELL + 16 + 4;

type Selected =
  | { kind: 'wall'; wallId: string | null }
  | { kind: 'reset' }
  | { kind: 'image'; id: string; url: string };

export default function Board() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [palettes, setPalettes] = useState<DBPalette[]>([]);
  const [sel, setSel] = useState<Selected>({ kind: 'wall', wallId: null });
  const [err, setErr] = useState<string>();
  const [paint, setPaint] = useState<Record<number, 'wall' | 'reset' | { url: string }>>({});

  // WALL id 준비
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/wall', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) setSel({ kind: 'wall', wallId: j.id });
      else setErr(j?.error || 'WALL 준비 실패');
    })();
  }, []);

  // 데이터 로딩/구독
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('board_cells')
        .select('id,x,y,palette_id, palette:palette_id (name,image_url)')
        .order('y').order('x');
      if (!alive) return;
      if (error) setErr(error.message);
      setCells((data ?? []) as any);
    })();
    (async () => {
      const { data, error } = await supabase
        .from('palette').select('id,name,image_url').order('created_at', { ascending: false });
      if (!alive) return;
      if (error) setErr(error.message);
      setPalettes((data ?? []) as any);
    })();

    const ch1 = supabase.channel('cells')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_cells' }, (p) => {
        const n = p.new as any;
        setCells(prev => {
          const i = prev.findIndex(c => c.id === n.id);
          if (i >= 0) { const next = [...prev]; next[i] = n; return next; }
          return prev;
        });
      }).subscribe();

    const ch2 = supabase.channel('palettes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'palette' }, async () => {
        const { data } = await supabase.from('palette').select('id,name,image_url').order('created_at', { ascending: false });
        setPalettes((data ?? []) as any);
      }).subscribe();

    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); alive = false; };
  }, []);

  // 빈 보드라도 9x9
  const grid = useMemo(() => {
    if (cells.length) return [...cells];
    return Array.from({ length: 81 }).map((_, i) => {
      const x = i % 9, y = Math.floor(i / 9);
      return { id: -1 - i, x, y, palette_id: null, palette: null } as Cell;
    });
  }, [cells]);

  const isEdge = (x: number, y: number) => (x === 0 || y === 0 || x === 8 || y === 8);

  // 가장자리 자동 WALL 초기화(비어있는 칸만)
  useEffect(() => {
    (async () => {
      // ⬇️ 'wallId' 속성이 있는 경우에만 사용하도록 안전하게 가드
      if (!cells.length || !('wallId' in sel) || !sel.wallId) return;
  
      const needs = cells.some((c) => isEdge(c.x, c.y));
      if (!needs) return;
  
      await supabase /* ... 기존 로직 ... */;
    })();
  }, [sel, cells]);

  // 클릭 → 로컬 페인트 + DB 반영
  async function onCellClick(cell: Cell) {
    setPaint(p => ({ ...p, [cell.id]: sel.kind === 'image' ? { url: sel.url } : sel.kind }));
    if (cell.id < 0) return;

    try {
      if (sel.kind === 'reset') {
        const { error } = await supabase.from('board_cells').update({ palette_id: null }).eq('id', cell.id);
        if (error) throw error;
      } else if (sel.kind === 'wall') {
        if (!sel.wallId) return;
        const { error } = await supabase.from('board_cells').update({ palette_id: sel.wallId }).eq('id', cell.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('board_cells').update({ palette_id: sel.id }).eq('id', cell.id);
        if (error) throw error;
      }
    } catch (e:any) { setErr(e.message || '업데이트 실패'); }
  }

  // 버튼 자체에 배경을 그려 "칸 100% 채움"
  function cellStyle(cell: Cell): React.CSSProperties {
    const p = paint[cell.id];

    // 로컬 페인트 우선
    if (p) {
      if (p === 'reset') {
        return { width: CELL, height: CELL, backgroundColor: '#ffffff' };
      }
      if (p === 'wall') {
        return { width: CELL, height: CELL, backgroundColor: '#111827' };
      }
      return {
        width: CELL, height: CELL,
        backgroundImage: `url(${p.url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#ffffff'
      };
    }

    // DB 값
    if (cell.palette?.name?.toLowerCase() === 'wall') {
      return { width: CELL, height: CELL, backgroundColor: '#111827' };
    }
    if (cell.palette?.image_url) {
      return {
        width: CELL, height: CELL,
        backgroundImage: `url(${cell.palette.image_url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#ffffff'
      };
    }

    // 기본
    return { width: CELL, height: CELL, backgroundColor: '#ffffff' };
  }

  // 삭제
  async function deletePalette(id: string) {
    const ok = confirm('이 이미지를 팔레트에서 삭제할까요? (보드에서 사용 중인 셀은 흰색으로 바뀝니다)');
    if (!ok) return;
    const res = await fetch(`/api/palette/${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) return alert(j?.error || '삭제 실패');
    setPalettes(prev => prev.filter(p => p.id !== id)); // 즉시 제거
  }
  // 업로드 직후 즉시 반영
  function handleUploaded(p: UploadedPalette) {
    if (!p) return;
    setPalettes(prev => [p as DBPalette, ...prev]);
  }

  return (
    <div className="flex gap-10 items-start">
      {/* 보드 + 중앙 제목만 남김 */}
      <section className="flex-1">
        <div style={{ width: BOARD_W }} className="mx-auto">
          <h1 className="text-3xl font-extrabold mb-4 text-center">
            &lt;3인용 어빌리티 4목 판&gt;
          </h1>

          {err && <div className="mb-3 p-2 rounded bg-rose-100 text-rose-900 text-sm border border-rose-200">오류: {err}</div>}

          <div className="inline-grid grid-cols-9 gap-[2px] p-[2px] bg-neutral-400 rounded-md">
            {grid.map(cell => (
              <button
                key={cell.id}
                onClick={() => onCellClick(cell)}
                className="relative border border-neutral-300/60"
                style={cellStyle(cell)}
                title={`${cell.x},${cell.y}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 팔레트 */}
      <aside className="w-[360px]">
        <div className="border rounded-xl p-4 space-y-4">
          <h3 className="text-2xl font-extrabold mb-4">팔레트</h3>

          {/* 업로더 – 내부에서 상태문구 mb-6이 들어감 */}
          <div>
            <PaletteUploader onUploaded={handleUploaded} />
          </div>

          {/* WALL / RESET – 아래 여백 강화 */}
          <div className="grid grid-cols-2 gap-4 mb-2">
            <button
              onClick={() => setSel({ kind: 'wall', wallId: sel.kind === 'wall' ? sel.wallId : null })}
              className={`rounded-md border flex items-center justify-center text-lg font-semibold ${sel.kind==='wall' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL, backgroundColor:'#111827', color:'#ffffff' }}
            >
              WALL
            </button>
            <button
              onClick={() => setSel({ kind: 'reset' })}
              className={`rounded-md border flex items-center justify-center text-lg font-semibold bg-neutral-200 ${sel.kind==='reset' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL }}
            >
              RESET
            </button>
          </div>

          {/* ▼ WALL/RESET과 목록 사이 간격 확실히 띄우기 */}
          <div className="h-4" />

          {/* 업로드된 팔레트 – 목록 위쪽에 여백/패딩 보강(겹침 방지) */}
          <div className="max-h-[460px] overflow-y-auto pr-1 mt-2 pt-4">
            <div className="grid grid-cols-3 gap-3">
              {palettes
                .filter(p => (p.name || '').toLowerCase() !== 'wall')
                .map(p => (
                  <div key={p.id} className="relative" style={{ width: CELL, height: CELL }}>
                    <button
                      onClick={() => p.image_url && setSel({ kind: 'image', id: p.id, url: p.image_url })}
                      className={`rounded-md border overflow-hidden bg-white w-full h-full ${sel.kind==='image' && 'id' in sel && sel.id===p.id ? 'ring-2 ring-black' : ''}`}
                      style={{
                        backgroundImage: p.image_url ? `url(${p.image_url})` : undefined,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                      title={p.name ?? ''}
                    />
                    {/* X 버튼은 셀 바깥 모서리 */}
                    <button
                      onClick={() => deletePalette(p.id)}
                      className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-bold shadow"
                      title="삭제"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
