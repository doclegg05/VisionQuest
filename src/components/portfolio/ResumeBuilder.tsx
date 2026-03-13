"use client";

import { useState, useEffect } from "react";

interface Experience {
  title: string;
  company: string;
  dates: string;
  description: string;
}

interface Education {
  school: string;
  degree: string;
  dates: string;
}

interface ResumeContent {
  objective: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  references: string;
}

const EMPTY_RESUME: ResumeContent = {
  objective: "",
  skills: [],
  experience: [],
  education: [],
  references: "",
};

export default function ResumeBuilder() {
  const [resume, setResume] = useState<ResumeContent>(EMPTY_RESUME);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillInput, setSkillInput] = useState("");

  async function fetchResume() {
    try {
      const res = await fetch("/api/resume");
      if (res.ok) {
        const data = await res.json();
        setResume(data.resume || EMPTY_RESUME);
        setDisplayName(data.displayName || "");
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load resume:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchResume();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save resume:", err);
    } finally {
      setSaving(false);
    }
  }

  function addSkill() {
    if (!skillInput.trim()) return;
    setResume({ ...resume, skills: [...resume.skills, skillInput.trim()] });
    setSkillInput("");
  }

  function removeSkill(index: number) {
    setResume({ ...resume, skills: resume.skills.filter((_, i) => i !== index) });
  }

  function addExperience() {
    setResume({
      ...resume,
      experience: [...resume.experience, { title: "", company: "", dates: "", description: "" }],
    });
  }

  function updateExperience(index: number, field: keyof Experience, value: string) {
    const updated = [...resume.experience];
    updated[index] = { ...updated[index], [field]: value };
    setResume({ ...resume, experience: updated });
  }

  function removeExperience(index: number) {
    setResume({ ...resume, experience: resume.experience.filter((_, i) => i !== index) });
  }

  function addEducation() {
    setResume({
      ...resume,
      education: [...resume.education, { school: "", degree: "", dates: "" }],
    });
  }

  function updateEducation(index: number, field: keyof Education, value: string) {
    const updated = [...resume.education];
    updated[index] = { ...updated[index], [field]: value };
    setResume({ ...resume, education: updated });
  }

  function removeEducation(index: number) {
    setResume({ ...resume, education: resume.education.filter((_, i) => i !== index) });
  }

  if (loading) return <p className="text-sm text-gray-400">Loading resume...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchResume} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="surface-section p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Resume Builder</h3>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`text-sm px-4 py-1.5 rounded-lg transition-colors ${
              saved
                ? "bg-green-100 text-green-700"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Save Resume"}
          </button>
        </div>
        <p className="text-lg font-bold text-gray-900">{displayName}</p>
      </div>

      {/* Objective */}
      <div className="surface-section p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Career Objective</h4>
        <textarea
          value={resume.objective}
          onChange={(e) => setResume({ ...resume, objective: e.target.value })}
          placeholder="Describe your career goals and what you bring to an employer..."
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Skills */}
      <div className="surface-section p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Skills</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {resume.skills.map((skill, i) => (
            <span key={i} className="bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full flex items-center gap-1">
              {skill}
              <button onClick={() => removeSkill(i)} className="text-blue-400 hover:text-blue-600 ml-0.5">&times;</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
            placeholder="Add a skill (e.g., Microsoft Office, Customer Service)"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={addSkill} className="text-sm bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 text-gray-600">Add</button>
        </div>
      </div>

      {/* Experience */}
      <div className="surface-section p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Work Experience</h4>
        <div className="space-y-4">
          {resume.experience.map((exp, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input type="text" placeholder="Job Title" value={exp.title}
                  onChange={(e) => updateExperience(i, "title", e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => removeExperience(i)} className="text-xs text-red-500 px-2">Remove</button>
              </div>
              <div className="flex gap-2">
                <input type="text" placeholder="Company/Organization" value={exp.company}
                  onChange={(e) => updateExperience(i, "company", e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="text" placeholder="Dates (e.g., Jan 2024 - Present)" value={exp.dates}
                  onChange={(e) => updateExperience(i, "dates", e.target.value)}
                  className="w-48 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <textarea placeholder="Describe your responsibilities and achievements..." value={exp.description}
                onChange={(e) => updateExperience(i, "description", e.target.value)} rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          ))}
        </div>
        <button onClick={addExperience}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800">+ Add Experience</button>
      </div>

      {/* Education */}
      <div className="surface-section p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Education</h4>
        <div className="space-y-3">
          {resume.education.map((edu, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 flex gap-2 items-start">
              <div className="flex-1 space-y-2">
                <input type="text" placeholder="School/Institution" value={edu.school}
                  onChange={(e) => updateEducation(i, "school", e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex gap-2">
                  <input type="text" placeholder="Degree/Program" value={edu.degree}
                    onChange={(e) => updateEducation(i, "degree", e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="text" placeholder="Dates" value={edu.dates}
                    onChange={(e) => updateEducation(i, "dates", e.target.value)}
                    className="w-40 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <button onClick={() => removeEducation(i)} className="text-xs text-red-500 px-2 mt-1">Remove</button>
            </div>
          ))}
        </div>
        <button onClick={addEducation}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800">+ Add Education</button>
      </div>

      {/* References */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">References</h4>
        <textarea
          value={resume.references}
          onChange={(e) => setResume({ ...resume, references: e.target.value })}
          placeholder="List your references or write 'Available upon request'"
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full py-3 rounded-xl text-sm font-medium transition-colors ${
          saved ? "bg-green-100 text-green-700" : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {saved ? "Resume Saved!" : saving ? "Saving..." : "Save Resume"}
      </button>
    </div>
  );
}
