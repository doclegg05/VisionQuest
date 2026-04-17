export type ChatRole = "student" | "teacher" | "admin";

export interface SlashCommand {
  slash: string;
  label: string;
  description: string;
  prefill: string;
  roles: ChatRole[];
}

export interface StarterChip {
  label: string;
  prefill: string;
}

export const COMMANDS: SlashCommand[] = [
  // Student
  {
    slash: "/goal",
    label: "Set a goal",
    description: "Capture a new goal with Sage's help",
    prefill: "Help me set a new goal for ",
    roles: ["student"],
  },
  {
    slash: "/plan",
    label: "Plan my week",
    description: "Build a plan for the week ahead",
    prefill: "Plan my week — here's what I'm working on: ",
    roles: ["student"],
  },
  {
    slash: "/reflect",
    label: "Reflect on today",
    description: "Talk through how your day went",
    prefill: "Here's how today went: ",
    roles: ["student"],
  },
  {
    slash: "/stuck",
    label: "I'm stuck",
    description: "Ask Sage for help getting unstuck",
    prefill: "I'm stuck on ",
    roles: ["student"],
  },
  {
    slash: "/next",
    label: "What's next?",
    description: "Ask what to work on next",
    prefill: "What should I work on next?",
    roles: ["student"],
  },
  {
    slash: "/cert",
    label: "Ask about a certification",
    description: "Get info about a SPOKES certification",
    prefill: "Tell me about the ",
    roles: ["student"],
  },

  // Teacher
  {
    slash: "/student",
    label: "Ask about a student",
    description: "Discuss a specific student's progress",
    prefill: "Tell me about ",
    roles: ["teacher"],
  },
  {
    slash: "/class",
    label: "Class snapshot",
    description: "Overview of your current class",
    prefill: "Give me a snapshot of my current class.",
    roles: ["teacher"],
  },
  {
    slash: "/intervene",
    label: "Draft an intervention",
    description: "Draft an intervention message",
    prefill: "Draft an intervention message for ",
    roles: ["teacher"],
  },
  {
    slash: "/email",
    label: "Draft a student email",
    description: "Compose communication for a student",
    prefill: "Draft a student email about ",
    roles: ["teacher"],
  },
  {
    slash: "/policy",
    label: "Policy lookup",
    description: "Look up a SPOKES program policy",
    prefill: "What's the SPOKES policy on ",
    roles: ["teacher"],
  },
  {
    slash: "/form",
    label: "Find a form",
    description: "Locate a program form and its purpose",
    prefill: "Where's the ",
    roles: ["teacher"],
  },

  // Admin
  {
    slash: "/usage",
    label: "Platform usage",
    description: "Review platform usage data",
    prefill: "Show me platform usage for ",
    roles: ["admin"],
  },
  {
    slash: "/report",
    label: "Generate a report",
    description: "Build a custom report",
    prefill: "Generate a report on ",
    roles: ["admin"],
  },
  {
    slash: "/outcomes",
    label: "Student outcomes",
    description: "Review student outcome trends",
    prefill: "Show me student outcomes for ",
    roles: ["admin"],
  },
  {
    slash: "/audit",
    label: "Audit activity",
    description: "Review recent admin activity",
    prefill: "Audit recent activity in ",
    roles: ["admin"],
  },
];

export const STARTER_CHIPS: Record<ChatRole, StarterChip[]> = {
  student: [
    { label: "Set a goal", prefill: "Help me set a new goal for " },
    { label: "Plan my week", prefill: "Plan my week — here's what I'm working on: " },
    { label: "I'm stuck", prefill: "I'm stuck on " },
    { label: "What's next?", prefill: "What should I work on next?" },
  ],
  teacher: [
    { label: "Class snapshot", prefill: "Give me a snapshot of my current class." },
    { label: "Draft an intervention", prefill: "Draft an intervention message for " },
    { label: "Policy lookup", prefill: "What's the SPOKES policy on " },
    { label: "Find a form", prefill: "Where's the " },
  ],
  admin: [
    { label: "Usage this week", prefill: "Show me platform usage for this week." },
    { label: "Report", prefill: "Generate a report on " },
    { label: "Outcomes", prefill: "Show me student outcomes for " },
    { label: "Audit activity", prefill: "Audit recent activity in " },
  ],
};

export function filterCommands(input: string, role: ChatRole): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const needle = input.toLowerCase();
  return COMMANDS.filter(
    (c) => c.roles.includes(role) && c.slash.toLowerCase().startsWith(needle),
  );
}

export function getStarterChips(role: ChatRole): StarterChip[] {
  return STARTER_CHIPS[role];
}
