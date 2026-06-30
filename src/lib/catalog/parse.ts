import matter from "gray-matter";
import type { CatalogFrontmatter, CatalogNode, CatalogNodeSections } from "./schema";

export function extractSections(body: string): CatalogNodeSections {
  const get = (heading: string): string => {
    const re = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const m = body.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    whenToUse: get("When to use"),
    whenNotToUse: get("When NOT to use"),
    related: get("Related"),
  };
}

export function parseCatalogNode(raw: string, filePath: string): CatalogNode {
  const { data, content } = matter(raw);
  return {
    frontmatter: data as CatalogFrontmatter,
    sections: extractSections(content),
    body: content,
    filePath,
  };
}
