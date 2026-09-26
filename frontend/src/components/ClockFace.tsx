import { formatClock, type ClockTime } from '../lib/germanTime'

export function ClockFace({ time, size = 220 }: { time: ClockTime; size?: number }) {
  const hourDeg = ((time.h % 12) + time.m / 60) * 30
  const minDeg = time.m * 6

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 200 200" width={size} height={size} className="drop-shadow-[0_0_30px_rgba(163,230,53,0.25)]">
        <defs>
          <radialGradient id="face" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#065f46" />
            <stop offset="100%" stopColor="#022c22" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="94" fill="url(#face)" stroke="#a3e635" strokeWidth="4" />
        {Array.from({ length: 60 }).map((_, i) => {
          const major = i % 5 === 0
          return (
            <line key={i} x1="100" y1={major ? 14 : 12} x2="100" y2={major ? 28 : 18}
              stroke={major ? '#bef264' : '#6ee7b7'} strokeOpacity={major ? 1 : 0.4}
              strokeWidth={major ? 3.5 : 1.5} strokeLinecap="round"
              transform={`rotate(${i * 6} 100 100)`} />
          )
        })}
        {Array.from({ length: 12 }).map((_, i) => {
          const n = i + 1
          const a = (n * 30 * Math.PI) / 180
          return (
            <text key={n} x={100 + 58 * Math.sin(a)} y={100 - 58 * Math.cos(a)}
              textAnchor="middle" dominantBaseline="central"
              className="fill-emerald-100 text-[15px] font-bold">{n}</text>
          )
        })}
        <line x1="100" y1="100" x2="100" y2="52" stroke="#ecfccb" strokeWidth="7" strokeLinecap="round"
          transform={`rotate(${hourDeg} 100 100)`} />
        <line x1="100" y1="100" x2="100" y2="26" stroke="#a3e635" strokeWidth="4" strokeLinecap="round"
          transform={`rotate(${minDeg} 100 100)`} />
        <circle cx="100" cy="100" r="6" fill="#a3e635" />
      </svg>
      <div className="display text-3xl font-extrabold tracking-wider text-lime-300">{formatClock(time)}</div>
    </div>
  )
}
