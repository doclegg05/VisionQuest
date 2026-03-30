import {
  ChartBar,
  Target,
  ClipboardText,
  BookOpen,
  Briefcase,
  Rocket,
  CalendarDots,
  Gear,
  Users,
  Buildings,
  Wrench,
  FolderOpen,
  ImageSquare,
  Archive,
  Star,
  Fire,
  ChatCircle,
  DotsThreeOutline,
  type Icon,
} from "@phosphor-icons/react";

export const ICON_MAP: Record<string, Icon> = {
  "📊": ChartBar,
  "🎯": Target,
  "📋": ClipboardText,
  "📚": BookOpen,
  "💼": Briefcase,
  "🚀": Rocket,
  "🗓️": CalendarDots,
  "⚙️": Gear,
  "👥": Users,
  "🏫": Buildings,
  "🛠️": Wrench,
  "📁": FolderOpen,
  "🖼️": ImageSquare,
  "📦": Archive,
  "⭐": Star,
  "🔥": Fire,
  "💬": ChatCircle,
  "•••": DotsThreeOutline,
};

export {
  ChartBar, Target, ClipboardText, BookOpen, Briefcase, Rocket,
  CalendarDots, Gear, Users, Buildings, Wrench, FolderOpen,
  ImageSquare, Archive, Star, Fire, ChatCircle, DotsThreeOutline,
};

export type { Icon };
