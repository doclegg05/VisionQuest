"use client";

import { useState, useEffect } from "react";

interface LmsLink {
  id: string;
  title: string;
  description: string | null;
  url: string;
  category: string;
  icon: string | null;
}

const CATEGORY_ICONS: Record<string, string> = {
  "Career Training": "💼",
  "Digital Skills": "💻",
  "Education": "🎓",
  "Financial Literacy": "💰",
  "Health & Wellness": "🏥",
  "Job Search": "🔍",
  "Life Skills": "🌱",
  "Certifications": "📜",
};

export default function CoursesHub() {
  const [grouped, setGrouped] = useState<Record<string, LmsLink[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    try {
      const res = await fetch("/api/lms");
      if (res.ok) {
        const data = await res.json();
        setGrouped(data.grouped || {});
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load courses:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading courses...</p>;
  }

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchCourses} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  const categories = Object.keys(grouped);

  if (categories.length === 0) {
    return (
      <div className="surface-section p-8 text-center text-gray-400">
        <p className="text-4xl mb-3">📚</p>
        <p className="text-sm">No courses have been added yet.</p>
        <p className="text-xs mt-1">Your teacher will add learning resources soon.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <div key={category}>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span>{CATEGORY_ICONS[category] || "📁"}</span>
            {category}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {grouped[category].map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="surface-section group block p-4 transition-all hover:-translate-y-0.5 hover:border-[rgba(15,154,146,0.25)]"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{link.icon || "🔗"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                      {link.title}
                    </p>
                    {link.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{link.description}</p>
                    )}
                  </div>
                  <span className="text-gray-300 group-hover:text-blue-400 transition-colors text-sm">↗</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
