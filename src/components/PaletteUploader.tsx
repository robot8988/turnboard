'use client';
import { useRef, useState } from 'react';

export type UploadedPalette = { id: string; name: string | null; image_url: string | null };

type Props = { onUploaded?: (p: UploadedPalette) => void };

export default function PaletteUploader({ onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name.replace(/\.[^.]+$/, ''));

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'upload failed');

      const added: UploadedPalette = json?.palette;
      setMsg('업로드 완료!');
      onUploaded?.(added);
    } catch (err:any) {
      setMsg(`업로드 실패: ${err.message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="mb-2">
      <input ref={fileRef} type="file" accept="image/*" onChange={onChange} disabled={busy} />
      <div className="text-sm text-gray-600 mt-2 mb-6">
        {busy ? '업로드 중…' : (msg ?? '선택된 파일 없음')}
      </div>
    </div>
  );
}