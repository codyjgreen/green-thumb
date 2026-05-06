import { z } from 'zod';

/**
 * Standard search query schema used across /search, /search/plants, /search/pests, /search/tips
 */
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.preprocess(
    (val) => (val === undefined ? undefined : Number(val)),
    z.number().int().min(1).max(50).default(10)
  ),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * Standard search query with optional type filter
 */
export const searchQueryWithTypeSchema = searchQuerySchema.extend({
  type: z.enum(['plant', 'pest', 'disease', 'composting', 'tip', 'task', 'general']).optional(),
  bookId: z.string().optional(),
});

export type SearchQueryWithType = z.infer<typeof searchQueryWithTypeSchema>;
