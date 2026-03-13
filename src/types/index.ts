export interface SessionUser {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
  parentId: string | null;
  children?: GoalData[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  module: string;
  stage: string;
  title: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
