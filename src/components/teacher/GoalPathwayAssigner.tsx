"use client";

import { useState, useEffect, useCallback } from "react";
import type { GoalData } from "./student-detail/types";

interface PathwaySuggestion {
  pathwayId: string;
  label: string;
  score: number;
  reason: string;
}

interface PathwayOption {
  id: string;
  label: string;
}

interface SuggestionsResponse {
  goalId: string;
  currentPathwayId: string | null;
  suggestions: PathwaySuggestion[];
  allPathways: PathwayOption[];
}

interface GoalPathwayAssignerProps {
  studentId: string;
  goals: GoalData[];
  onGoalAction: (goalId: string, action: { pathwayId?: string | null }) => Promise<void>;
}

// Goals that should have a pathway assigned
const PATHWAY_ELIGIBLE_STATUSES = ["confirmed", "active", "in_progress"];
const PATHWAY_ELIGIBLE_LEVELS = ["bhag", "long_term", "monthly"];

export default function GoalPathwayAssigner({
  studentId,
  goals,
  onGoalAction,
}: GoalPathwayAssignerProps) {
  const eligibleGoals = goals.filter(
    (g) =>
      PATHWAY_ELIGIBLE_STATUSES.includes(g.status) &&
      PATHWAY_ELIGIBLE_LEVELS.includes(g.level),
  );

  const unmatchedGoals = eligibleGoals.filter((g) => !g.pathwayId);
  const matchedGoals = eligibleGoals.filter((g) => g.pathwayId);

  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const loadSuggestions = useCallback(async (goalId: string) => {
    setLoadingSuggestions(true);
    try {
      const res = await fetch(
        `/api/teacher/students/${studentId}/goals/${goalId}/pathway-suggestions`,
      );
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingSuggestions(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (expandedGoalId) {
      loadSuggestions(expandedGoalId);
    } else {
      setSuggestions(null);
    }
  }, [expandedGoalId, loadSuggestions]);

  async function assignPathway(goalId: string, pathwayId: string | null) {
    setAssigning(true);
    try {
      await onGoalAction(goalId, { pathwayId });
      setExpandedGoalId(null);
    } finally {
      setAssigning(false);
    }
  }

  if (eligibleGoals.length === 0) return null;

  return (
    <div id="pathway-assignment" className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Pathway Assignment</h3>
          <p className="mt-1 text-sm text-gray-500">
            Assign approved pathways to student goals. Unmatched goals need instructor review.
          </p>
        </div>
        {unmatchedGoals.length > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {unmatchedGoals.length} unmatched
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {/* Unmatched goals first */}
        {unmatchedGoals.map((goal) => (
          <div
            key={goal.id}
            className="rounded-lg border border-amber-200 bg-amber-50/50 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{goal.content}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {goal.level} &middot; {goal.status} &middot; No pathway assigned
                </p>
              </div>
              <button
                onClick={() => setExpandedGoalId(expandedGoalId === goal.id ? null : goal.id)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 shrink-0"
              >
                {expandedGoalId === goal.id ? "Close" : "Assign"}
              </button>
            </div>

            {expandedGoalId === goal.id && (
              <PathwaySuggestionPanel
                suggestions={suggestions}
                loading={loadingSuggestions}
                assigning={assigning}
                onAssign={(pathwayId) => assignPathway(goal.id, pathwayId)}
              />
            )}
          </div>
        ))}

        {/* Already matched goals */}
        {matchedGoals.map((goal) => (
          <div
            key={goal.id}
            className="rounded-lg border border-gray-200 bg-gray-50/50 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{goal.content}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {goal.level} &middot; {goal.status}
                  {goal.pathway && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs">
                      {goal.pathway.label}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setExpandedGoalId(expandedGoalId === goal.id ? null : goal.id)}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 shrink-0"
              >
                {expandedGoalId === goal.id ? "Close" : "Change"}
              </button>
            </div>

            {expandedGoalId === goal.id && (
              <PathwaySuggestionPanel
                suggestions={suggestions}
                loading={loadingSuggestions}
                assigning={assigning}
                onAssign={(pathwayId) => assignPathway(goal.id, pathwayId)}
                onClear={() => assignPathway(goal.id, null)}
                currentPathwayId={goal.pathwayId}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PathwaySuggestionPanel({
  suggestions,
  loading,
  assigning,
  onAssign,
  onClear,
  currentPathwayId,
}: {
  suggestions: SuggestionsResponse | null;
  loading: boolean;
  assigning: boolean;
  onAssign: (pathwayId: string) => void;
  onClear?: () => void;
  currentPathwayId?: string | null;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return <p className="mt-3 text-xs text-gray-400">Loading suggestions...</p>;
  }

  if (!suggestions) {
    return <p className="mt-3 text-xs text-gray-400">Could not load pathway suggestions.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {suggestions.suggestions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Suggested pathways</p>
          <div className="space-y-1.5">
            {suggestions.suggestions.map((s) => (
              <div
                key={s.pathwayId}
                className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.label}</p>
                  <p className="text-xs text-gray-500">{s.reason} &middot; {Math.round(s.score * 100)}% match</p>
                </div>
                <button
                  onClick={() => onAssign(s.pathwayId)}
                  disabled={assigning || s.pathwayId === currentPathwayId}
                  className="text-xs font-medium text-green-700 hover:text-green-900 px-2 py-1 disabled:opacity-40"
                >
                  {s.pathwayId === currentPathwayId ? "Current" : "Assign"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showAll && suggestions.allPathways.length > suggestions.suggestions.length && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Show all {suggestions.allPathways.length} pathways
        </button>
      )}

      {showAll && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">All pathways</p>
          <div className="space-y-1">
            {suggestions.allPathways
              .filter((p) => !suggestions.suggestions.some((s) => s.pathwayId === p.id))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                >
                  <p className="text-sm text-gray-700">{p.label}</p>
                  <button
                    onClick={() => onAssign(p.id)}
                    disabled={assigning || p.id === currentPathwayId}
                    className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 disabled:opacity-40"
                  >
                    {p.id === currentPathwayId ? "Current" : "Assign"}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {currentPathwayId && onClear && (
        <button
          onClick={onClear}
          disabled={assigning}
          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
        >
          Remove pathway assignment
        </button>
      )}

      {suggestions.suggestions.length === 0 && suggestions.allPathways.length === 0 && (
        <p className="text-xs text-gray-400">
          No pathways exist yet. Create pathways in Program Setup &gt; Learning &gt; Pathways.
        </p>
      )}
    </div>
  );
}
