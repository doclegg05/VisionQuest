import type { JobSourceAdapter, NormalizedJob } from "../types";
import { fetchText, stripHtml, truncateDescription, xmlTag } from "./shared";

const FEED_URL = "https://weworkremotely.com/remote-jobs.rss";

function splitTitle(rawTitle: string): { company: string; title: string } {
  const parts = rawTitle.split(/\s*[:|–—-]\s*/);
  if (parts.length >= 2) {
    return { company: parts[0]?.trim() || "Unknown", title: parts.slice(1).join(" - ").trim() };
  }
  return { company: "Unknown", title: rawTitle.trim() };
}

export const weWorkRemotelyAdapter: JobSourceAdapter = {
  source: "weworkremotely",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(): Promise<NormalizedJob[]> {
    const xml = await fetchText(FEED_URL);
    if (!xml) return [];

    const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1] ?? "");

    return items
      .map((item) => {
        const rawTitle = stripHtml(xmlTag(item, "title"));
        const link = stripHtml(xmlTag(item, "link"));
        const guid = stripHtml(xmlTag(item, "guid")) || link || rawTitle;
        const description = stripHtml(xmlTag(item, "description"));
        const { company, title } = splitTitle(rawTitle);

        const pubDate = stripHtml(xmlTag(item, "pubDate"));
        const postedAt = (() => {
          if (!pubDate) return undefined;
          const d = new Date(pubDate);
          return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
        })();
        return {
          title: title || rawTitle,
          company,
          location: "Remote",
          workMode: "remote" as const,
          salary: null,
          salaryMin: null,
          description: truncateDescription(description),
          url: link,
          source: "weworkremotely",
          sourceType: "api" as const,
          sourceId: `weworkremotely:${guid}`,
          postedAt,
        };
      })
      .filter((job) => job.title && job.url)
      .slice(0, 60);
  },
};
