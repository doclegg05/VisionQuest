"use client";

interface Achievement {
  key: string;
  label: string;
  desc: string;
}

interface AchievementListProps {
  achievements: Achievement[];
}

export default function AchievementList({ achievements }: AchievementListProps) {
  if (achievements.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        No achievements yet — keep talking to Sage and working on your goals!
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {achievements.map((a) => (
        <div
          key={a.key}
          className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-3 text-center"
        >
          <p className="text-lg mb-1">🏅</p>
          <p className="text-sm font-semibold text-gray-900">{a.label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{a.desc}</p>
        </div>
      ))}
    </div>
  );
}
