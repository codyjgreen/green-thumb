/**
 * getChapter callback text may be undefined — wrap in a properly-typed helper.
 */
function getChapterText(book: InstanceType<typeof import('epub2').EPub>, chapterId: string | undefined): Promise<string> {
  if (!chapterId) return Promise.resolve('');
  return new Promise((resolve) => {
    book.getChapter(chapterId, (_err: Error, text?: string) => {
      resolve(text ?? '');
    });
  });
}

export interface Section {
  title: string;
  content: string;
  pageNumber?: number;
}

/**
 * Detect the likely content type of a text section using lightweight heuristics.
 * No LLM needed for this — books usually have clear section headers.
 */
export function classifySection(title: string, content: string): string {
  const combined = (title + ' ' + content).toLowerCase();

  if (/pest|insect|aphid|beetle|caterpillar|worm|bug/i.test(combined)) return 'pest';
  if (/disease|mold|blight|rot|powdery|fungus|rust/i.test(combined)) return 'disease';
  if (/compost|composting|organic matter|decompose/i.test(combined)) return 'composting';
  if (/planting|sow|seed|transplant|space|depth|harvest/i.test(combined)) return 'plant';
  if (/tip|advice|remember|note|warning|important|don't forget/i.test(combined)) return 'tip';
  if (/task|do this|apply|spray|prune|water|feed|work/i.test(combined)) return 'task';

  return 'general';
}

/**
 * Split a long section into smaller chunks (300-500 tokens each).
 * Uses paragraph-based splitting with a fallback to sentence or word splitting for huge blocks.
 */
export function splitIntoChunks(
  text: string,
  chunkSize = 400,
  overlap = 50
): string[] {
  const maxChars = chunkSize * 4;
  const overlapChars = overlap * 4;

  const chunks: string[] = [];
  
  // First, split by paragraphs to maintain semantic boundaries where possible
  const rawParagraphs = text.split(/\n\n+/);
  
  // Refine paragraphs: if any single paragraph is too long, split it by sentences
  const refinedParagraphs: string[] = [];
  for (const para of rawParagraphs) {
    if (para.length > maxChars) {
      // Split huge paragraph by sentences (rough approximation with period + space)
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (sentence.length > maxChars) {
          // Even a sentence is too long? Split by words (last resort)
          const words = sentence.split(/\s+/);
          let currentSub = '';
          for (const word of words) {
            if (currentSub.length + word.length > maxChars && currentSub.length > 0) {
              refinedParagraphs.push(currentSub.trim());
              currentSub = word;
            } else {
              currentSub += (currentSub ? ' ' : '') + word;
            }
          }
          if (currentSub) refinedParagraphs.push(currentSub.trim());
        } else {
          refinedParagraphs.push(sentence);
        }
      }
    } else {
      refinedParagraphs.push(para);
    }
  }

  let currentChunk = '';

  for (const para of refinedParagraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (currentChunk.length + trimmedPara.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Start next chunk with overlap from the end of currentChunk
      const overlapText = currentChunk.slice(-overlapChars);
      currentChunk = overlapText + '\n' + trimmedPara;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Extract text from a file based on its type.
 * Currently supports: PDF, EPUB, TXT.
 */
export async function extractTextFromFile(
  filePath: string,
  fileType: string
): Promise<{ title: string; author?: string; sections: Section[] }> {
  if (fileType === 'pdf') {
    return extractPDF(filePath);
  } else if (fileType === 'epub') {
    return extractEPUB(filePath);
  } else {
    return extractTXT(filePath);
  }
}

async function extractPDF(filePath: string): Promise<{
  title: string;
  author?: string;
  sections: Section[];
}> {
  const { readFileSync } = await import('node:fs');
  const pdfParse = (await import('pdf-parse')).default;

  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);

  let title = data.info?.Title ?? filePath.split('/').pop()?.replace('.pdf', '') ?? 'Unknown';
  const author = data.info?.Author;

  // Split pages into sections using double newlines as paragraph breaks
  const fullText = data.text;

  // Try to detect chapter headings — short lines (3-60 chars) that start with caps
  // and don't end with punctuation, followed by a blank line
  const lines = fullText.split(/\n/);
  const sections: Section[] = [];
  let currentTitle = title;
  let currentContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const isHeader = line.length >= 3
      && line.length <= 80
      && /^[A-Z]/.test(line)
      && !line.endsWith('.')
      && !line.endsWith(',')
      && !line.match(/^\d+\./); // skip numbered lists

    if (isHeader && currentContent.length > 100) {
      sections.push({ title: currentTitle, content: currentContent.trim() });
      currentTitle = line;
      currentContent = '';
    } else {
      currentContent += '\n' + line;
    }
  }

  if (currentContent.trim()) {
    sections.push({ title: currentTitle, content: currentContent.trim() });
  }

  return { title, author, sections };
}

async function extractEPUB(filePath: string): Promise<{
  title: string;
  author?: string;
  sections: Section[];
}> {
  const title = filePath.split('/').pop()?.replace('.epub', '') ?? 'Unknown';
  const sections: Section[] = [];

  try {
    const { EPub } = await import('epub2');
    const book = new EPub(filePath);

    await new Promise<void>((resolve, reject) => {
      book.on('end', resolve);
      book.on('error', reject);
      book.parse();
    });

    const metadata = book.metadata;
    const chapters = book.flow;

    for (const chapter of chapters) {
      const chapterData = await getChapterText(book, chapter.id);

      if (chapterData.trim()) {
        sections.push({
          title: chapter.title ?? `Chapter ${sections.length + 1}`,
          content: chapterData.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        });
      }
    }

    return {
      title: metadata.title ?? title,
      author: metadata.creator,
      sections,
    };
  } catch {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(filePath, 'utf-8');
    return { title, sections: [{ title: 'Content', content: text.slice(0, 50000) }] };
  }
}

async function extractTXT(filePath: string): Promise<{
  title: string;
  sections: Section[];
}> {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(filePath, 'utf-8');

  const firstNewline = text.indexOf('\n');
  const title = firstNewline > 0 && firstNewline < 200
    ? text.slice(0, firstNewline).trim()
    : 'Untitled';

  const body = firstNewline > 0 ? text.slice(firstNewline) : text;
  const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 0);

  // Split into chunks by paragraph groups
  const sections: Section[] = [];
  let currentTitle = 'Introduction';
  let currentContent = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if it looks like a header
    const isHeader = trimmed.length < 80
      && !trimmed.endsWith('.')
      && /^[A-Z]/.test(trimmed);

    if (isHeader && currentContent.length > 100) {
      sections.push({ title: currentTitle, content: currentContent.trim() });
      currentTitle = trimmed;
      currentContent = '';
    } else {
      currentContent += '\n' + trimmed;
    }
  }

  if (currentContent.trim()) {
    sections.push({ title: currentTitle, content: currentContent.trim() });
  }

  return { title, sections };
}
