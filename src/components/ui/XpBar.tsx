"use client";

interface XpBarProps {
  current: number;
  nextTarget: number;
  prevTarget: number;
  ratio: number;
  level: number;
}

export default function XpBar({ current, nextTarget, ratio, level }: XpBarProps) {
  const percentage = Math.round(ratio * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700">Level {level}</span>
        <span className="text-gray-400">{current} / {nextTarget} XP</span>
      </div>
      <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
