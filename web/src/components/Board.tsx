import { useState } from 'react';
import { BOARD_SIZE, type ScoredMove, type Stone } from '@/game/types';
import { cn } from '@/lib/utils';

interface BoardProps {
  board: Stone[];
  lastMove: [number, number] | null;
  winLine: [number, number][] | null;
  candidates?: ScoredMove[];
  hoverColor?: Stone;
  onPlay?: (x: number, y: number) => void;
  disabled?: boolean;
}

const PAD = 28;
const CELL = 40;
const DIM = PAD * 2 + CELL * (BOARD_SIZE - 1);

const STAR_POINTS: [number, number][] = [
  [3, 3],
  [11, 3],
  [3, 11],
  [11, 11],
  [7, 7],
];

// Rank palette: saturated colors, readable on tan board.
// Each candidate gets a solid-white backing disc so numbers are always legible.
export const CAND_COLORS = [
  '#dc2626', // red-600
  '#ea580c', // orange-600
  '#2563eb', // blue-600
  '#16a34a', // green-600
  '#7c3aed', // violet-600
];

export function Board({
  board,
  lastMove,
  winLine,
  candidates = [],
  hoverColor = 1,
  onPlay,
  disabled,
}: BoardProps) {
  const [hover, setHover] = useState<[number, number] | null>(null);

  const winSet = new Set<string>();
  if (winLine) for (const [x, y] of winLine) winSet.add(`${x},${y}`);

  const handleMouseMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const svg = ev.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * DIM;
    const py = ((ev.clientY - rect.top) / rect.height) * DIM;
    const x = Math.round((px - PAD) / CELL);
    const y = Math.round((py - PAD) / CELL);
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
      setHover([x, y]);
    } else {
      setHover(null);
    }
  };

  const handleClick = () => {
    if (!hover || disabled) return;
    const [x, y] = hover;
    if (board[y * BOARD_SIZE + x] !== 0) return;
    onPlay?.(x, y);
  };

  return (
    <svg
      viewBox={`0 0 ${DIM} ${DIM}`}
      className={cn(
        'block w-full h-full select-none rounded-2xl border border-black/10',
        'shadow-[0_10px_30px_-12px_rgba(0,0,0,0.22),0_2px_6px_-2px_rgba(0,0,0,0.08)]',
        disabled ? 'cursor-default' : 'cursor-pointer',
      )}
      style={{ background: 'var(--color-board)' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
      onClick={handleClick}
    >
      <defs>
        <radialGradient id="stoneBlack" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#4b5563" />
          <stop offset="35%" stopColor="#1f2937" />
          <stop offset="100%" stopColor="#030712" />
        </radialGradient>
        <radialGradient id="stoneWhite" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f3f4f6" />
          <stop offset="100%" stopColor="#d1d5db" />
        </radialGradient>
      </defs>
      <g stroke="var(--color-board-line)" strokeWidth="1" opacity="0.85">
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <line
            key={`h${i}`}
            x1={PAD}
            y1={PAD + i * CELL}
            x2={PAD + (BOARD_SIZE - 1) * CELL}
            y2={PAD + i * CELL}
          />
        ))}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <line
            key={`v${i}`}
            x1={PAD + i * CELL}
            y1={PAD}
            x2={PAD + i * CELL}
            y2={PAD + (BOARD_SIZE - 1) * CELL}
          />
        ))}
      </g>
      <g fill="var(--color-board-line)">
        {STAR_POINTS.map(([x, y]) => (
          <circle key={`s-${x}-${y}`} cx={PAD + x * CELL} cy={PAD + y * CELL} r={3.5} />
        ))}
      </g>
      {candidates.map((m, i) => {
        const cx = PAD + m.x * CELL;
        const cy = PAD + m.y * CELL;
        if (board[m.y * BOARD_SIZE + m.x] !== 0) return null;
        const color = CAND_COLORS[i] ?? '#64748b';
        return (
          <g key={`cand-${i}`}>
            {/* white backing disc for contrast on tan board */}
            <circle cx={cx} cy={cy} r={17} fill="#ffffff" opacity={0.92} />
            <circle cx={cx} cy={cy} r={17} fill="none" stroke={color} strokeWidth={2.5} />
            <text
              x={cx}
              y={cy + 5.5}
              textAnchor="middle"
              fontSize={15}
              fontWeight={800}
              fill={color}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {board.map((v, i) => {
        if (v === 0) return null;
        const x = i % BOARD_SIZE;
        const y = Math.floor(i / BOARD_SIZE);
        const cx = PAD + x * CELL;
        const cy = PAD + y * CELL;
        const isLast = lastMove && lastMove[0] === x && lastMove[1] === y;
        const inWin = winSet.has(`${x},${y}`);
        const gradientId = v === 1 ? 'stoneBlack' : 'stoneWhite';
        const strokeColor = v === 1 ? '#000' : '#9ca3af';
        return (
          <g key={i}>
            <circle
              cx={cx}
              cy={cy}
              r={CELL * 0.43}
              fill={`url(#${gradientId})`}
              stroke={strokeColor}
              strokeOpacity={v === 1 ? 0.4 : 0.6}
              strokeWidth={0.75}
            />
            {isLast && !inWin && <circle cx={cx} cy={cy} r={4.5} fill="#ef4444" />}
            {inWin && (
              <circle
                cx={cx}
                cy={cy}
                r={CELL * 0.43}
                fill="none"
                stroke="#ef4444"
                strokeWidth={2.5}
              />
            )}
          </g>
        );
      })}
      {hover && !disabled && board[hover[1] * BOARD_SIZE + hover[0]] === 0 && (
        <circle
          cx={PAD + hover[0] * CELL}
          cy={PAD + hover[1] * CELL}
          r={CELL * 0.43}
          fill={`url(#${hoverColor === 1 ? 'stoneBlack' : 'stoneWhite'})`}
          stroke={hoverColor === 1 ? '#000' : '#9ca3af'}
          strokeOpacity={0.4}
          strokeWidth={0.75}
          opacity={0.45}
        />
      )}
    </svg>
  );
}
