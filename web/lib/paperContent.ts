import { promises as fs } from "node:fs";
import path from "node:path";

export type PaperSection = {
  title: string;
  summary: string;
  mermaid: string;
  code: string;
};

export type VocabularyEntry = {
  term: string;
  definition: string;
};

export type PaperContent = {
  paper_id: number;
  title: string;
  authors: string[];
  arxiv_url?: string;
  notebook_path: string;
  generated_at: string;
  vocabulary?: VocabularyEntry[];
  sections: PaperSection[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "papers");

export async function readPaperContent(id: string): Promise<PaperContent | null> {
  try {
    const raw = await fs.readFile(path.join(CONTENT_DIR, `${id}.json`), "utf-8");
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
