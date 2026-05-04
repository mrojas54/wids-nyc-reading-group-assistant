import { promises as fs } from "node:fs";
import path from "node:path";

export type PaperSection = {
  title: string;
  summary: string;
  mermaid?: string;
  code?: string;
};

export type VocabularyEntry = {
  term: string;
  definition: string;
};

export type PaperContent = {
  paper_id: number;
  title: string;
  authors: string[];
  paper_url?: string;
  notebook_path: string;
  generated_at: string;
  vocabulary?: VocabularyEntry[];
  sections: PaperSection[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "papers");

// Allowlist URL-safe characters only — `id` arrives unvalidated from the
// dynamic route, so without this guard `path.join` would resolve `..`
// segments and read arbitrary JSON files outside CONTENT_DIR.
const SAFE_ID = /^[\w-]+$/;

export async function readPaperContent(id: string): Promise<PaperContent | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    const filePath = path.join(CONTENT_DIR, `${id}.json`);
    if (!filePath.startsWith(CONTENT_DIR + path.sep)) return null;
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PaperContent;
  } catch {
    return null;
  }
}

export async function listPaperContentIds(): Promise<string[]> {
  try {
    const files = await fs.readdir(CONTENT_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
