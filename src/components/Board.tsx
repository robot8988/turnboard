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
const SIZE = 11;            // ✅ 11x11
const GAP = 2;
const PAD = 2;
const BOARD_W = SIZE * CELL + (SIZE - 1) * GAP + PAD * 2;

type Mode = 'wall' | 'reset' | 'image';

export default function Board() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [palettes, setPalettes] = useState<DBPalette[]>([]);
  const [mode, setMode] = useState<Mode>('wall');
  const [wallId, setWallId] = useState<string | null>(null);
  const [imageSel, setImageSel] = useState<{ id: string; url: string } | null>(null);
  const [err, setErr] = useState<string>();
  const [paint, setPaint] = useState<Record<number, 'wall' | 'reset' | { url: string }>>({});
  const [rt, setRt] = useState<RealtimeChannel | null>(null);
  const [lastPlacedId, setLastPlacedId] = useState<number | null>(null);

  // 단일 셀 재조회
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

  // WALL 팔레트 id
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/wall', { cache: 'no-store' });
        const j = await res.json();
        if (res.ok) setWallId(j.id ?? null);
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

  // Realtime: cells
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
        setPaint(prev => {
          if (!(n.id in prev)) return prev;
          const { [n.id]: _omit, ...rest } = prev;
          return rest;
        });
        refetchCell(n.id);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_cells' }, (p) => {
        const oldId = (p.old as any)?.id as number | undefined;
        if (!oldId) return;
        setCells(prev => prev.filter(c => c.id !== oldId));
        setPaint(prev => {
          if (!(oldId in prev)) return prev;
          const { [oldId]: _omit, ...rest } = prev;
          return rest;
        });
      })
      .subscribe();

    const chPal = supabase
      .channel('palettes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'palette' }, async (p) => {
        const { data } = await supabase
          .from('palette')
          .select('id,name,image_url')
          .order('created_at', { ascending: false });
        setPalettes((data ?? []) as any);

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

  // Broadcast – 탭 간 동기화
  useEffect(() => {
    const ch = supabase.channel('board-sync', { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'cell:update' }, (msg) => {
      const { id } = msg.payload as any;
      setLastPlacedId(id); // ✅ 수신자도 강조
      setPaint(prev => {
        if (!(id in prev)) return prev;
        const { [id]: _omit, ...rest } = prev;
        return rest;
      });
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

  // ✅ 항상 11×11 전칸을 그리되, DB에 있는 칸은 덮어씌움
  const grid = useMemo(() => {
    const byKey = new Map<string, Cell>();
    for (const c of cells) byKey.set(`${c.x},${c.y}`, c);

    return Array.from({ length: SIZE * SIZE }).map((_, i) => {
      const x = i % SIZE, y = Math.floor(i / SIZE);
      return byKey.get(`${x},${y}`) ?? { id: -1 - i, x, y, palette_id: null, palette: null };
    });
  }, [cells]);

  // 클릭 처리: DB가 없던 칸이면 생성 후 반영
  async function onCellClick(cell: Cell) {
    setPaint(p => ({
      ...p,
      [cell.id]: mode === 'image' ? { url: imageSel?.url || '' } : mode
    }));

    // 선택된 팔레트
    let nextPaletteId: string | null = null;
    if (mode === 'wall') nextPaletteId = wallId ?? null;
    if (mode === 'image') nextPaletteId = imageSel?.id ?? null;
    if (mode === 'reset') nextPaletteId = null;

    try {
      // DB 행이 없던 칸(음수 id) → 생성하면서 값 반영
      if (cell.id < 0) {
        const { data, error } = await supabase
          .from('board_cells')
          .insert({ x: cell.x, y: cell.y, palette_id: nextPaletteId })
          .select('id')
          .single();
        if (error) throw error;
        const newId = (data as any)?.id as number;
        setLastPlacedId(newId);
        rt?.send({ type: 'broadcast', event: 'cell:update', payload: { id: newId }});
        await refetchCell(newId);
        return;
      }

      // 기존 칸 업데이트
      if (mode === 'reset') {
        const { error } = await supabase.from('board_cells').update({ palette_id: null }).eq('id', cell.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('board_cells').update({ palette_id: nextPaletteId }).eq('id', cell.id);
        if (error) throw error;
      }

      setLastPlacedId(cell.id); // 본인 화면 강조
      rt?.send({ type: 'broadcast', event: 'cell:update', payload: { id: cell.id }});
    } catch (e:any) {
      setErr(e.message || '업데이트 실패');
    }
  }

  // 스타일
  function cellStyle(cell: Cell): React.CSSProperties {
    const base: React.CSSProperties = { width: CELL, height: CELL, position: 'relative' };
    const p = paint[cell.id];
    let bg: React.CSSProperties = {};

    if (p) {
      if (p === 'reset') bg = { backgroundColor: '#ffffff' };
      else if (p === 'wall') bg = { backgroundColor: '#111827' };
      else bg = {
        backgroundImage: `url(${(p as any).url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#ffffff',
      };
    } else if (cell.palette?.name?.toLowerCase() === 'wall') {
      bg = { backgroundColor: '#111827' };
    } else if (cell.palette?.image_url) {
      bg = {
        backgroundImage: `url(${cell.palette.image_url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#ffffff',
      };
    } else {
      bg = { backgroundColor: '#ffffff' };
    }

    const highlight = (lastPlacedId === cell.id)
      ? { boxShadow: 'inset 0 0 0 4px rgba(34,197,94,0.95), 0 0 0 2px rgba(34,197,94,1)', transition: 'box-shadow 0.15s ease' }
      : null;

    return { ...base, ...bg, ...(highlight || {}) };
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
            &lt;3~4인용 어빌리티 4목 판&gt;
          </h1>

          {err && (
            <div className="mb-4 p-3 rounded-lg bg-rose-100 text-rose-900 text-sm border border-rose-200">
              오류: {err}
            </div>
          )}

          {/* ✅ 동적 클래스 대신 인라인 grid */}
          <div
            className="rounded-md bg-neutral-400"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${SIZE}, ${CELL}px)`,
              gap: `${GAP}px`,
              padding: `${PAD}px`,
            }}
          >
            {grid.map(cell => (
              <button
                key={`${cell.x},${cell.y}`}   // ✅ 좌표를 키로: 위치 일관성
                onClick={() => onCellClick(cell)}
                className="relative border border-neutral-300/60"
                style={cellStyle(cell)}
                title={`${cell.x},${cell.y}`}  // ✅ 마우스오버 좌표 정확
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
            <button
              onClick={() => setMode('wall')}
              className={`rounded-md border flex items-center justify-center text-lg font-semibold ${mode==='wall' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL, backgroundColor:'#111827', color:'#ffffff' }}
              title="가장자리/벽 칠하기"
            >
              WALL
            </button>
            <button
              onClick={() => setMode('reset')}
              className={`rounded-md border flex items-center justify-center text-lg font-semibold bg-neutral-100 ${mode==='reset' ? 'ring-2 ring-black' : ''}`}
              style={{ width: CELL, height: CELL }}
              title="초기화"
            >
              RESET
            </button>
          </div>

          <div className="max-h-[520px] overflow-y-auto px-1 pt-2 pb-6 rounded-md bg-white/40">
            <div className="grid grid-cols-3 gap-4">
              {palettes
                .filter(p => (p.name || '').toLowerCase() !== 'wall')
                .map(p => (
                  <div key={p.id} className="relative" style={{ width: CELL, height: CELL }}>
                    <button
                      onClick={() => { if (p.image_url) { setMode('image'); setImageSel({ id: p.id, url: p.image_url }); }}}
                      className={`rounded-md border overflow-hidden bg-white w-full h-full ${mode==='image' && imageSel?.id===p.id ? 'ring-2 ring-black' : ''}`}
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
