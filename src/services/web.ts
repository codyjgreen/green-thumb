import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { search as ddgSearch, SafeSearchType } from 'duck-duck-scrape';
import { loadConfig } from '../lib/config.js';

// ─── SSRF Protection ────────────────────────────────────────────────
const PRIVATE_IP_PATTERNS = [
  /^127\./,           // Loopback (127.0.0.0/8)
  /^169\.254\./,     // Link-local (169.254.0.0/16)
  /^10\./,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[0-1])\./,  // 172.16.0.0/12
  /^192\.168\./,     // 192.168.0.0/16
  /^::1$/,            // IPv6 loopback
  /^fe80:/i,          // IPv6 link-local
  /^fc00:/i,          // IPv6 unique local
  /^fd00:/i,          // IPv6 unique local
];
const METADATA_ENDPOINTS = [
  '169.254.169.254',   // AWS, GCP, Azure metadata
  'metadata.google.internal', // GCP
  'metadata.googleusercontent.com',
];

export function isPrivateUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'javascript:' || url.protocol === 'data:') return true;
    if (METADATA_ENDPOINTS.includes(url.hostname)) return true;
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(url.hostname)) return true;
    }
    // Resolve DNS and check resolved IPs
    try {
      const dns = require('dns');
      const ips = dns.resolve4Sync(url.hostname);
      for (const ip of ips) {
        for (const pattern of PRIVATE_IP_PATTERNS) {
          if (pattern.test(ip)) return true;
        }
      }
    } catch {
      // Not resolvable via DNS (e.g. single-label name) — be safe
      return true;
    }
    return false;
  } catch {
    return true; // Malformed URL → reject
  }
}
export interface WebArticle {
  url: string;
  title: string;
  content: string;
  excerpt?: string;
}

/**
 * Search using Brave Search API (primary) with DuckDuckGo fallback.
 */
interface BraveResult {
  url: string;
  title: string;
  description: string;
}

export async function braveSearch(query: string, limit: number): Promise<BraveResult[]> {
  const config = loadConfig();
  const apiKey = config.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!res.ok) throw new Error(`Brave ${res.status}`);
    const data = await res.json() as any;
    const results: any[] = data?.web?.results ?? [];
    return results
      .map((r: any) => ({ url: r.url, title: r.title, description: r.description }))
      .filter((r: BraveResult) => r.url && r.description);
  } catch (err) {
    console.error('[BraveSearch] Error:', err);
    return [];
  }
}

/**
 * Fetch a URL and extract the main article content using Mozilla Readability.
 * This ignores navigation, ads, and footers.
 */
export async function fetchArticleText(url: string): Promise<WebArticle> {
  if (isPrivateUrl(url)) {
    throw new Error('SSRF blocked: URL resolves to a private or internal address');
  }
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

export interface PlantEnrichment {
  commonName: string
  scientificName?: string
  description?: string
  sunlight?: string
  waterNeeds?: string
  soilType?: string
  soilPh?: string
  category?: string
  zoneMin?: number
  zoneMax?: number
  frostTolerance?: string
  daysToMaturity?: number
  matureHeight?: string
  growthHabit?: string
  commonPests?: string[]
  commonDiseases?: string[]
  careNotes?: string
  source: string
  sourceUrl?: string
}

/**
 * Search the web for a plant and extract structured growing data.
 * Uses DuckDuckGo search + article fetch + heuristic extraction.
 */
export async function searchAndFetchPlantData(plantName: string): Promise<PlantEnrichment | null> {
  const urls = await searchWeb(`growing ${plantName} care guide`, 1);
  if (urls.length === 0) return null;

  const sourceUrl = urls[0];
  let article: WebArticle;
  try {
    article = await fetchArticleText(sourceUrl);
  } catch {
    return null;
  }

  const text = article.content;
  const lower = text.toLowerCase();

  // Sunlight
  let sunlight: string | undefined;
  if (/full sun/i.test(text)) sunlight = 'full sun';
  else if (/partial shade|part shade/i.test(text)) sunlight = 'partial shade';
  else if (/\bshade\b/i.test(text)) sunlight = 'shade';

  // Water needs
  let waterNeeds: string | undefined;
  if (/drought.tolerant|low water/i.test(text)) waterNeeds = 'low';
  else if (/consistent moisture|evenly moist|regular water/i.test(text)) waterNeeds = 'high';
  else if (/moderate (water|moisture)|average water/i.test(text)) waterNeeds = 'moderate';

  // Soil type
  let soilType: string | undefined;
  if (/well.drain/i.test(text)) soilType = 'well-draining';
  else if (/sandy soil/i.test(text)) soilType = 'sandy';
  else if (/clay soil/i.test(text)) soilType = 'clay';
  else if (/loamy|loam soil/i.test(text)) soilType = 'loamy';

  // Soil pH
  const phMatch = text.match(/pH\s*(?:of\s*)?(\d+\.?\d*)\s*(?:to|-)\s*(\d+\.?\d*)/i);
  const soilPh = phMatch ? `${phMatch[1]}-${phMatch[2]}` : undefined;

  // Scientific name: look for "(Genus species)" or italicised binomials near the plant name
  const sciMatch = text.match(/\(([A-Z][a-z]+ [a-z]+(?:\s+[a-z]+)?)\)/);
  const scientificName = sciMatch ? sciMatch[1] : undefined;

  // Days to maturity
  const maturityMatch = text.match(/(\d+)(?:\s*(?:to|-)\s*\d+)?\s*days?\s+(?:to\s+)?(?:maturity|harvest)/i);
  const daysToMaturity = maturityMatch ? parseInt(maturityMatch[1], 10) : undefined;

  // Mature height
  const heightMatch = text.match(/(\d+(?:\.\d+)?(?:\s*(?:to|-)\s*\d+(?:\.\d+)?)?\s*(?:feet|foot|ft|inches?|in|cm|meter)s?)\s*(?:tall|high|in height)?/i);
  const matureHeight = heightMatch ? heightMatch[1].trim() : undefined;

  // Growth habit
  let growthHabit: string | undefined;
  if (/\bvine\b/i.test(text)) growthHabit = 'vine';
  else if (/\bbush\b|\bshrub\b/i.test(text)) growthHabit = 'bush';
  else if (/\btrailing\b/i.test(text)) growthHabit = 'trailing';
  else if (/\bupright\b/i.test(text)) growthHabit = 'upright';
  else if (/\brosette\b/i.test(text)) growthHabit = 'rosette';

  // Frost tolerance
  let frostTolerance: string | undefined;
  if (/frost.hardy|very hardy/i.test(text)) frostTolerance = 'hardy';
  else if (/light frost|mild frost/i.test(text)) frostTolerance = 'light';
  else if (/moderate frost/i.test(text)) frostTolerance = 'moderate';
  else if (/frost.free|no frost|tender/i.test(text)) frostTolerance = 'none';

  // USDA zones
  const zoneMatch = text.match(/(?:USDA\s+)?(?:hardiness\s+)?zones?\s*(\d+)\s*(?:to|-)\s*(\d+)/i);
  const zoneMin = zoneMatch ? parseInt(zoneMatch[1], 10) : undefined;
  const zoneMax = zoneMatch ? parseInt(zoneMatch[2], 10) : undefined;

  // Category
  let category: string | undefined;
  if (/\bvegetable\b/i.test(text)) category = 'vegetable';
  else if (/\bherb\b/i.test(text)) category = 'herb';
  else if (/\bfruit\b|\bberry\b/i.test(text)) category = 'fruit';
  else if (/\bflower\b|\bornamental\b/i.test(text)) category = 'flower';
  else if (/\btree\b/i.test(text)) category = 'tree';

  // Common pests/diseases — extract bullet-style lists after heading keywords
  const pestSection = text.match(/(?:common\s+)?pests?[:\s]+([^\n.]{10,200})/i);
  const commonPests = pestSection
    ? pestSection[1].split(/,|;|and/).map(s => s.trim()).filter(Boolean).slice(0, 5)
    : undefined;

  const diseaseSection = text.match(/(?:common\s+)?diseases?[:\s]+([^\n.]{10,200})/i);
  const commonDiseases = diseaseSection
    ? diseaseSection[1].split(/,|;|and/).map(s => s.trim()).filter(Boolean).slice(0, 5)
    : undefined;

  // Description: first meaningful sentence block (up to 300 chars)
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) || [];
  const description = sentences.slice(0, 3).join(' ').slice(0, 300).trim() || undefined;

  return {
    commonName: plantName,
    scientificName,
    description,
    sunlight,
    waterNeeds,
    soilType,
    soilPh,
    category,
    zoneMin,
    zoneMax,
    frostTolerance,
    daysToMaturity,
    matureHeight,
    growthHabit,
    commonPests,
    commonDiseases,
    source: 'web',
    sourceUrl,
  };
}

/**
 * Search the web using DuckDuckGo and return the top result links.
 */
export async function searchWeb(query: string, limit = 3, attempt = 1): Promise<string[]> {
  // Try Brave Search first (key from env or .env)
  const config = loadConfig();
  if (config.BRAVE_SEARCH_API_KEY) {
    const results = await braveSearch(query, limit);
    if (results.length > 0) return results.map(r => r.url);
  }

  // Fall back to DuckDuckGo with retry on rate limit
  try {
    const results = await ddgSearch(query, { safeSearch: SafeSearchType.STRICT });
    return results.results.slice(0, limit).map(r => r.url);
  } catch (err: any) {
    const isRateLimit = err?.message?.includes('anomaly') || err?.message?.includes('rate') || err?.message?.includes('429');
    if (isRateLimit && attempt < 3) {
      const delayMs = attempt * 2000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return searchWeb(query, limit, attempt + 1);
    }
    console.error('[WebSearch] Error:', err?.message ?? err);
    return [];
  }
}
