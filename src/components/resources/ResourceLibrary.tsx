"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { FORMS, FORM_CATEGORIES, FormCategory } from "@/lib/spokes/forms";
import ResourceCard from "./ResourceCard";

const allCategoryKeys = Object.keys(FORM_CATEGORIES) as FormCategory[];

interface ResourceLibraryProps {
  categories?: FormCategory[];
  targetStudentId?: string;
  helperText?: string;
  helperHref?: string | null;
  helperLabel?: string;
}

export default function ResourceLibrary({
  categories,
  targetStudentId,
  helperText,
  helperHref,
  helperLabel,
}: ResourceLibraryProps = {}) {
  const categoryKeys = categories ?? allCategoryKeys;
  const filteredByCategory = categories
    ? FORMS.filter((f) => categories.includes(f.category))
    : FORMS;
  const [selectedCategory, setSelectedCategory] = useState<FormCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [formStatuses, setFormStatuses] = useState<Record<string, string>>({});

  const fetchFormStatuses = useCallback(() => {
    const params = targetStudentId ? `?studentId=${encodeURIComponent(targetStudentId)}` : "";
    fetch(`/api/forms/status${params}`)
      .then(res => res.ok ? res.json() : { submissions: [] })
      .then(data => {
        const statusMap: Record<string, string> = {};
        for (const sub of data.submissions) {
          statusMap[sub.formId] = sub.status;
        }
        setFormStatuses(statusMap);
      })
      .catch(() => {});
  }, [targetStudentId]);

  useEffect(() => {
    fetchFormStatuses();
  }, [fetchFormStatuses]);

  const filteredForms = useMemo(() => {
    let result = filteredByCategory;

    if (selectedCategory !== "all") {
      result = result.filter((f) => f.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q),
      );
    }

    return result;
  }, [selectedCategory, searchQuery, filteredByCategory]);

  const grouped = useMemo(() => {
    const map = new Map<FormCategory, typeof filteredForms>();
    for (const form of filteredForms) {
      const list = map.get(form.category) ?? [];
      list.push(form);
      map.set(form.category, list);
    }
    return map;
  }, [filteredForms]);

  return (
    <div className="space-y-8">
      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search forms by title or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-3 text-sm text-[var(--ink-strong)] placeholder:text-[var(--muted)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent-secondary)]/40"
        />
      </div>

      {/* Filter tabs — hidden when only one category */}
      {categoryKeys.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              selectedCategory === "all"
                ? "bg-[var(--accent-strong)] text-white"
                : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
            }`}
          >
            All
          </button>
          {categoryKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedCategory(key)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                selectedCategory === key
                  ? "bg-[var(--accent-strong)] text-white"
                  : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {FORM_CATEGORIES[key].icon} {FORM_CATEGORIES[key].label}
            </button>
          ))}
        </div>
      )}

      {/* Category sections */}
      {filteredForms.length === 0 && (
        <p className="py-12 text-center text-sm text-[var(--ink-muted)]">
          No forms match your search.
        </p>
      )}

      {categoryKeys.map((key) => {
        const forms = grouped.get(key);
        if (!forms || forms.length === 0) return null;
        const cat = FORM_CATEGORIES[key];

        return (
          <CategorySection
            key={key}
            icon={cat.icon}
            label={cat.label}
            description={cat.description}
            count={forms.length}
          >
            {forms
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((form) => (
                <ResourceCard
                  key={form.id}
                  form={form}
                  submissionStatus={formStatuses[form.id] ?? null}
                  onUploadComplete={fetchFormStatuses}
                  targetStudentId={targetStudentId}
                  helperText={helperText}
                  helperHref={helperHref}
                  helperLabel={helperLabel}
                />
              ))}
          </CategorySection>
        );
      })}
    </div>
  );
}

function CategorySection({
  icon,
  label,
  description,
  count,
  children,
}: {
  icon: string;
  label: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg text-[var(--ink-strong)]">
              {label}
            </h2>
            <span className="rounded-full bg-[var(--accent-strong)] px-2.5 py-0.5 text-xs font-semibold text-white">
              {count}
            </span>
          </div>
          <p className="text-xs text-[var(--ink-muted)]">{description}</p>
        </div>
        <span className="text-[var(--ink-muted)] transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {children}
        </div>
      )}
    </section>
  );
}
