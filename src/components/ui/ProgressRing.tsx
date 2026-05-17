/**
 * SVG 进度环：外环底色 + 内环按进度填充 + 中心百分比文字。
 *
 * 颜色随进度变：
 *   - 0-29   灰 (ink-400)
 *   - 30-69  橙 (warning-500)
 *   - 70-99  浅绿 (success-500)
 *   - 100    深绿 (success-600)
 *
 * 用 currentColor 让 stroke 跟随 className 的 text-* 颜色。
 */

import { cn } from "@/lib/utils";

interface ProgressRingProps {
  /** 0-100 整数 */
  percent: number;
  /** 像素尺寸（含 stroke）。默认 36。 */
  size?: number;
  /** 环宽。默认 3.5。 */
  stroke?: number;
  /** 是否显示中心百分比文字。默认 true；调用方想自己叠内容就传 false */
  showCenterText?: boolean;
  className?: string;
}

function colorClass(percent: number): string {
  if (percent >= 100) return "text-success-600";
  if (percent >= 70) return "text-success-500";
  if (percent >= 30) return "text-warning-500";
  return "text-ink-400";
}

export function ProgressRing({
  percent,
  size = 36,
  stroke = 3.5,
  showCenterText = true,
  className,
}: ProgressRingProps) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - stroke) / 2;
  const c = r * 2 * Math.PI;
  const offset = c * (1 - p / 100);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(colorClass(p), className)}
      role="img"
      aria-label={`完成度 ${p}%`}
    >
      {/* 底环 */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={stroke}
      />
      {/* 进度环 */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 200ms ease" }}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.max(8, Math.round(size * 0.36))}
        fontWeight={600}
        fill="currentColor"
        opacity={showCenterText ? 1 : 0}
      >
        {p}
      </text>
    </svg>
  );
}
