import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { search, SafeSearchType } from 'duck-duck-scrape';

export interface WebArticle {
  url: string;
  title: string;
  content: string;
  excerpt?: string;
}

/**
 * Fetch a URL and extract the main article content using Mozilla Readability.
 * This ignores navigation, ads, and footers.
 */
export async function fetchArticleText(url: string): Promise<WebArticle> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error('Failed to parse article content. The page might not be in a readable format.');
  }

  return {
    url,
    title: article.title || 'Untitled Web Article',
    content: article.textContent.replace(/\s+/g, ' ').trim(),
    excerpt: article.excerpt,
  };
}

/**
 * Search the web using DuckDuckGo and return the top result links.
 */
export async function searchWeb(query: string, limit = 3): Promise<string[]> {
  try {
    const results = await search(query, { safeSearch: SafeSearchType.STRICT });
    return results.results.slice(0, limit).map(r => r.url);
  } catch (err) {
    console.error('[WebSearch] Error:', err);
    return [];
  }
}
