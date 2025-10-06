'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import PaletteUploader, { UploadedPalette } from './PaletteUploader';

type DBPalette = { id: string; name: string | null; image_url: string | null };
type Cell = {
  id: number; x: number; y: number;
  palette_id: string | null;
  palette?: { name: string | null; image_url: string | null } | null;
};

const CELL = 72;
const BOARD_W = 9 * CELL + 16 + 4;

// ✅ wall 모드까지 포함한 선택 상태 유니온 타입
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
  const [rt, setRt] = useState<RealtimeChannel | null>(null); // broadcast

  // 개별 셀 재조회(조인 포함)
  async function refetchCell(id: number) {
    const { data, error } = await supabase
      .from('board_cells')
      .select('id,x,y,palette_id, palette:palette_id (name,image_url)')
      .eq('id', id)
      .single();
    if (!error && data) {
      setCells(prev => {
        const i = prev.findIndex(c => c.id === id);
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = data as any;
        return next;
      });
    }
  }

  // ✅ WALL id 확보 (없으면 서버가 생성)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/wall', { cache: 'no-store' });
        const j = await res.json();
        if (res.ok) setSel({ kind: 'wall', wallId: j.id });
        else setErr(j?.error || 'WALL 준비 실패');
      } catch (e: any) { setErr(e.message || 'WALL 준비 실패'); }
    })();
  }, []);

  // 초기 로드
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
        .from('palette')
        .select('id,name,image_url')
        .order('created_at', { ascending: false });
      if (!alive) return;
      if (error) setErr(error.message);
      setPalettes((data ?? []) as any);
    })();
    return () => { alive = false; };
  }, []);

  // DB Realtime – 보드 셀
  useEffect(() => {
    const chCells = supabase
      .channel('cells')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_cells' }, (p) => {
        const n = p.new as any as Cell;
        setCells(prev => {
          if (prev.some(c => c.id === n.id)) return prev;
          return [...prev, n].sort((a,b)=> a.y-b.y || a.x-b.x);
        });
        refetchCell(n.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_cells' }, (p) => {
        const n = p.new as any as Cell;
        refetchCell(n.id);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_cells' }, (p) => {
        const oldId = (p.old as any)?.id;
        if (!oldId) return;
        setCells(prev => prev.filter(c => c.id !== oldId));
      })
      .subscribe();

    // DB Realtime – 팔레트
    const chPal = supabase
      .channel('palettes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'palette' }, async (p) => {
        const { data } = await supabase
          .from('palette')
          .select('id,name,image_url')
          .order('created_at', { ascending: false });
        setPalettes((data ?? []) as any);

        // ✅ 팔레트 삭제/이미지 비움 즉시 반영
        if (p.eventType === 'DELETE') {
          const deletedId = (p.old as any)?.id as string | undefined;
          if (deletedId) {
            setCells(prev => prev.map(c => c.palette_id === deletedId ? { ...c, palette_id: null, palette: null } : c));
          }
        }
        if (p.eventType === 'UPDATE') {
          const after = p.new as any;
          if (!after?.image_url) {
            const pid = after?.id as string | undefined;
            if (pid) {
              setCells(prev => prev.map(c => c.palette_id === pid ? { ...c, palette: { name: after?.name ?? null, image_url: null } } : c));
            }
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(chCells);
      supabase.removeChannel(chPal);
    };
  }, []);

  // Broadcast – 탭 간 반영
  useEffect(() => {
    const ch = supabase.channel('board-sync', { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'cell:update' }, (msg) => {
      const { id } = msg.payload as any;
      refetchCell(id);
    });

    ch.on('broadcast', { event: 'palette:list:refresh' }, async () => {
      const { data } = await supabase
        .from('palette')
        .select('id,name,image_url')
        .order('created_at', { ascending: false });
      setPalettes((data ?? []) as any);
    });

    ch.subscribe();
    setRt(ch);
    return () => { supabase.removeChannel(ch); };
  }, []);

  // 9x9 기본 그리드
  const grid = useMemo(() => {
    if (cells.length) return [...cells];
    return Array.from({ length: 81 }).map((_, i) => {
      const x = i % 9, y = Math.floor(i / 9);
      return { id: -1 - i, x, y, palette_id: null, palette: null } as Cell;
    });
  }, [cells]);

  const isEdge = (x: number, y: number) => (x === 0 || y === 0 || x === 8 || y === 8);

  // 가장자리 자동 WALL
  useEffect(() => {
    (async () => {
      if (!cells.length || sel.kind !== 'wall' || !sel.wallId) return;
      const edgeIds = cells.filter(c => isEdge(c.x, c.y) && !c.palette_id).map(c => c.id);
      if (edgeIds.length === 0) return;
      const { error } = await supabase
        .from('board_cells')
        .update({ palette_id: sel.wallId })
        .in('id', edgeIds);
      if (error) setErr(error.message);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, sel]);

  // 셀 클릭
  async function onCellClick(cell: Cell) {
    setPaint(p => ({ ...p, [cell.id]: sel.kind === 'image' ? { url: (sel as any).url } : sel.kind }));
    if (cell.id < 0) return;

    try {
      if (sel.kind === 'reset') {
        const { error } = await supabase.from('board_cells').update({ palette_id: null }).eq('id', cell.id);
        if (error) throw error;
        rt?.send({ type: 'broadcast', event: 'cell:update', payload: { id: cell.id }});
      } else if (sel.kind === 'wall') {
        if (!sel.wallId) return;
        const { error: e2 } = await supabase.from('board_cells').update({ palette_id: sel.wallId }).eq('id', cell.id);
        if (e2) throw e2;
        rt?.send({ type: 'broadcast', event: 'cell:update', payload: { id: cell.id }});
      } else {
        const imgSel = sel as { id: string; url: string };
        const { error: e2 } = await supabase.from('board_cells').update({ palette_id: imgSel.id }).eq('id', cell.id);
        if (e2) throw e2;
        rt?.send({ type: 'broadcast', event: 'cell:update', payload: { id: cell.id }});
      }
    } catch (e:any) { setErr(e.message || '업데이트 실패'); }
  }

  // 버튼 스타일
  function cellStyle(cell: Cell): React.CSSProperties {
    const p = paint[cell.id];
    if (p) {
      if (p === 'reset') return { width: CELL, height: CELL, backgroundColor: '#ffffff' };
      if (p === 'wall')  return { width: CELL, height: CELL, backgroundColor: '#111827' };
      return {
        width: CELL, height: CELL,
        backgroundImage: `url(${(p as any).url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#ffffff',
      };
    }
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
        backgroundColor: '#ffffff',
      };
    }
    return { width: CELL, height: CELL, backgroundColor: '#ffffff' };
  }

  // 팔레트 삭제
  async function deletePalette(id: string) {
    const ok = confirm('이 이미지를 팔레트에서 삭제할까요? (보드에서 사용 중인 셀은 흰색으로 바뀝니다)');
    if (!ok) return;

    try {
      const res = await fetch(`/api/palette/${id}`, {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' },
      });

      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `API ${res.status}`);

      setPalettes(prev => prev.filter(p => p.id !== id));
      setCells(prev => prev.map(c => c.palette_id === id ? ({ ...c, palette_id: null, palette: null }) : c));
      rt?.send({ type: 'broadcast', event: 'palette:list:refresh', payload: { at: Date.now() }});
    } catch (e: any) {
      alert(`삭제 실패: ${e.message}`);
    }
  }

  // 업로드 직후 즉시 반영
  function handleUploaded(p: UploadedPalette) {
    if (!p) return;
    setPalettes(prev => [p as DBPalette, ...prev]);
    rt?.send({ type: 'broadcast', event: 'palette:list:refresh', payload: { at: Date.now() }});
  }

  return (
    <div className="flex gap-10 items-start">
      {/* 보드 */}
      <section className="flex-1">
        <div style={{ width: BOARD_W }} className="mx-auto">
          <h1 className="text-3xl font-extrabold mb-4 text-center">
            &lt;3인용 어빌리티 4목 판&gt;
          </h1>

          {err && (
            <div className="mb-4 p-3 rounded-lg bg-rose-100 text-rose-900 text-sm border border-rose-200">
              오류: {err}
            </div>
          )}

          <div className="inline-grid grid-cols-9 gap-[2px] p-[2px] bg-neutral-400 rounded-md">
            {grid.map(cell => (
              <button
                key={`${cell.id}-${cell.x}-${cell.y}`}
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
        <div className="border rounded-2xl p-5 space-y-4">
          <h3 className="text-2xl font-extrabold">팔레트</h3>

          <div className="pb-2 mb-4 border-b">
            <PaletteUploader onUploaded={handleUploaded} />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* ✅ 깔끔한 토글: wall ↔ 유지 */}
            <button
              onClick={() =>
                setSel(prev => prev.kind === 'wall'
                  ? { ...prev }
                  : { kind: 'wall', wallId: sel.kind === 'wall' ? sel.wallId : (sel as any)?.wallId ?? sel.wallId ?? null })
              }
              className={`rounded-md border flex items-center justify-center text-lg font-semibold ${sel.kind==='wall' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL, backgroundColor:'#111827', color:'#ffffff' }}
              title="가장자리/벽 칠하기"
            >
              WALL
            </button>
            <button
              onClick={() => setSel({ kind: 'reset' })}
              className={`rounded-md border flex items-center justify-center text-lg font-semibold bg-neutral-100 ${sel.kind==='reset' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL }}
              title="초기화"
            >
              RESET
            </button>
          </div>

          <div className="h-2" />

          <div className="max-h-[520px] overflow-y-auto px-1 pt-2 pb-6 rounded-md bg-white/40">
            <div className="grid grid-cols-3 gap-4">
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
                    <button
                      onClick={() => deletePalette(p.id)}
                      className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-rose-600 text-white text-xs font-bold shadow"
                      title="삭제"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
            <div className="h-2" />
          </div>
        </div>
      </aside>
    </div>
  );
}
