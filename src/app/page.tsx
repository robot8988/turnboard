// src/app/page.tsx
import Board from "../components/Board";

export default function Home() {
  return (
    <main className="p-6 md:p-10">
      <div className="max-w-[1400px] mx-auto">
        {/* 상단 제목은 제거. (중앙 제목은 Board 내부에서 표시) */}
        <Board />
      </div>
    </main>
  );
}
