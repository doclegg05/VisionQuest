"use client";

import { useState, useRef, useEffect } from "react";

interface VisionBoardToolbarProps {
  onItemAdded: () => void;
}

interface GoalOption {
  id: string;
  level: string;
  content: string;
}

const NOTE_COLOR_OPTIONS = [
  { id: "yellow", label: "Yellow", className: "bg-amber-200 border-amber-300" },
  { id: "pink", label: "Pink", className: "bg-pink-200 border-pink-300" },
  { id: "blue", label: "Blue", className: "bg-sky-200 border-sky-300" },
  { id: "green", label: "Green", className: "bg-emerald-200 border-emerald-300" },
  { id: "white", label: "White", className: "bg-white border-gray-300" },
];

export default function VisionBoardToolbar({ onItemAdded }: VisionBoardToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showGoalPicker, setShowGoalPicker] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("yellow");
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(false);

  // Upload image
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Step 1: Upload file
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "vision-board");
      const fileRes = await fetch("/api/files", { method: "POST", body: formData });
      if (!fileRes.ok) throw new Error("Upload failed");
      const fileData = await fileRes.json();

      // Step 2: Create vision board item
      const itemRes = await fetch("/api/vision-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "image", fileId: fileData.file.id }),
      });
      if (itemRes.ok) onItemAdded();
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Add note
  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      const res = await fetch("/api/vision-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", content: noteText.trim(), color: noteColor }),
      });
      if (res.ok) {
        setNoteText("");
        setShowNoteForm(false);
        onItemAdded();
      }
    } catch (err) {
      console.error("Add note failed:", err);
    }
  }

  // Load goals for picker
  async function loadGoals() {
    setLoadingGoals(true);
    try {
      const res = await fetch("/api/goals");
      if (res.ok) {
        const data = await res.json();
        setGoals(data.goals || []);
      }
    } catch {}
    setLoadingGoals(false);
  }

  // Link goal
  async function handleLinkGoal(goal: GoalOption) {
    try {
      const res = await fetch("/api/vision-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "goal", goalId: goal.id, content: goal.content }),
      });
      if (res.ok) {
        setShowGoalPicker(false);
        onItemAdded();
      }
    } catch (err) {
      console.error("Link goal failed:", err);
    }
  }

  // Close popovers on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowNoteForm(false);
        setShowGoalPicker(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const LEVEL_LABELS: Record<string, string> = {
    bhag: "Big Vision",
    monthly: "Monthly",
    weekly: "Weekly",
    daily: "Daily",
    task: "Task",
  };

  return (
    <div className="relative">
      {/* Toolbar buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Add Image */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[var(--ink-strong)] shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
        >
          📷 {uploading ? "Uploading..." : "Add Image"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif"
          onChange={handleImageUpload}
          className="hidden"
        />

        {/* Add Note */}
        <button
          onClick={() => { setShowNoteForm(!showNoteForm); setShowGoalPicker(false); }}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[var(--ink-strong)] shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          📝 Add Note
        </button>

        {/* Link Goal */}
        <button
          onClick={() => {
            setShowGoalPicker(!showGoalPicker);
            setShowNoteForm(false);
            if (!showGoalPicker) loadGoals();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[var(--ink-strong)] shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          🎯 Link Goal
        </button>
      </div>

      {/* Note form popover */}
      {showNoteForm && (
        <div className="absolute bottom-full left-0 mb-3 w-80 rounded-2xl border border-[var(--border)] bg-white/95 p-4 shadow-xl backdrop-blur-lg z-50">
          <p className="text-xs font-semibold text-[var(--ink-muted)] mb-2">New Note</p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, 200))}
            placeholder="Write your affirmation, reminder, or inspiration..."
            rows={3}
            className="textarea-field w-full resize-none text-sm"
            autoFocus
          />
          <p className="mt-1 text-right text-[10px] text-[var(--ink-muted)]">{noteText.length}/200</p>

          {/* Color picker */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-[var(--ink-muted)]">Color:</span>
            {NOTE_COLOR_OPTIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => setNoteColor(c.id)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${c.className} ${
                  noteColor === c.id ? "scale-110 ring-2 ring-[var(--accent-strong)] ring-offset-1" : ""
                }`}
                title={c.label}
              />
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleAddNote}
              disabled={!noteText.trim()}
              className="primary-button px-4 py-2 text-xs disabled:opacity-50"
            >
              Pin it
            </button>
            <button
              onClick={() => setShowNoteForm(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-muted)] hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Goal picker popover */}
      {showGoalPicker && (
        <div className="absolute bottom-full left-0 mb-3 w-80 rounded-2xl border border-[var(--border)] bg-white/95 p-4 shadow-xl backdrop-blur-lg z-50">
          <p className="text-xs font-semibold text-[var(--ink-muted)] mb-2">Link a Goal</p>
          {loadingGoals ? (
            <p className="text-xs text-[var(--ink-muted)]">Loading goals...</p>
          ) : goals.length === 0 ? (
            <p className="text-xs text-[var(--ink-muted)]">No goals set yet. Talk to Sage to create your first goal!</p>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {goals.map((goal) => (
                <button
                  key={goal.id}
                  onClick={() => handleLinkGoal(goal)}
                  className="w-full rounded-lg border border-[var(--border)] p-2.5 text-left text-xs transition-colors hover:bg-[rgba(15,154,146,0.06)] hover:border-[rgba(15,154,146,0.2)]"
                >
                  <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-[9px] font-semibold text-[var(--accent-secondary)]">
                    {LEVEL_LABELS[goal.level] || goal.level}
                  </span>
                  <p className="mt-1 text-[var(--ink-strong)]">{goal.content}</p>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowGoalPicker(false)}
            className="mt-3 rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-muted)] hover:bg-gray-50 w-full"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
