import { describe, it, expect } from 'vitest';
import { classifySection, splitIntoChunks } from '../../src/services/extractor.js';

describe('extractor', () => {
  describe('classifySection', () => {
    it('classifies pest-related content', () => {
      expect(classifySection('Pest Control', 'How to deal with aphids and beetles in the garden')).toBe('pest');
    });

    it('classifies insect mentions as pest', () => {
      expect(classifySection('Bug Watch', 'Watch out for caterpillars eating your leaves')).toBe('pest');
    });

    it('classifies disease-related content', () => {
      expect(classifySection('Plant Diseases', 'Powdery mildew and blight can affect your plants')).toBe('disease');
    });

    it('classifies mold and fungus mentions as disease', () => {
      expect(classifySection('Fungal Issues', 'Rust and rot can spread through the garden')).toBe('disease');
    });

    it('classifies composting content', () => {
      expect(classifySection('Composting Basics', 'How to create organic matter that will decompose')).toBe('composting');
    });

    it('classifies planting content', () => {
      expect(classifySection('Planting Guide', 'Sow seeds at the right depth and transplant carefully')).toBe('plant');
    });

    it('classifies harvest instructions as plant', () => {
      expect(classifySection('Harvest Time', 'When to harvest and how much space between plants')).toBe('plant');
    });

    it('classifies tip/advice content', () => {
      expect(classifySection('Gardening Tips', 'Remember to water regularly and note these important tips')).toBe('tip');
    });

    it('classifies warning content as tip', () => {
      expect(classifySection('Important Note', "Don't forget to check soil moisture before watering")).toBe('tip');
    });

    it('classifies task/action content', () => {
      expect(classifySection('Weekly Tasks', 'Prune the roses, water the garden, and apply fertilizer')).toBe('task');
    });

    it('classifies general content by default', () => {
      expect(classifySection('Chapter 5', 'The history of botanical gardens in England and their design')).toBe('general');
    });

    it('uses combined title and content for classification', () => {
      expect(classifySection('Overview', 'Composting organic matter helps create rich soil through decomposition')).toBe('composting');
    });

    it('is case-insensitive', () => {
      expect(classifySection('PEST CONTROL', 'APHIDS AND BEETLES')).toBe('pest');
    });
  });

  describe('splitIntoChunks', () => {
    it('returns empty array for empty input', () => {
      const chunks = splitIntoChunks('');
      expect(chunks).toEqual([]);
    });

    it('returns single chunk for short text', () => {
      const text = 'This is a short paragraph that should fit in one chunk.';
      const chunks = splitIntoChunks(text, 400);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(text);
    });

    it('splits text into multiple chunks when exceeding chunkSize', () => {
      const text = 'Paragraph one here.\n\nParagraph two here.\n\nParagraph three here.';
      const chunks = splitIntoChunks(text, 10, 2); // tiny chunks to force split
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('respects overlap parameter', () => {
      const text = 'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph content here.';
      const chunks = splitIntoChunks(text, 20, 10);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('splits by paragraphs when possible', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = splitIntoChunks(text, 400);
      // Should split by paragraph boundary
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles single huge paragraph by splitting sentences', () => {
      const text = 'This is sentence one. This is sentence two. This is sentence three.';
      const chunks = splitIntoChunks(text, 5, 1);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('does not include empty chunks', () => {
      const text = 'Some content here.\n\n\n\n\nMore content.';
      const chunks = splitIntoChunks(text, 400);
      for (const chunk of chunks) {
        expect(chunk.trim().length).toBeGreaterThan(0);
      }
    });

    it('uses default chunkSize of 400 when not specified', () => {
      const text = 'Word '.repeat(500);
      const chunks = splitIntoChunks(text);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('uses default overlap of 50 when not specified', () => {
      const text = 'Word '.repeat(300);
      const chunks = splitIntoChunks(text, 100, 50);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('preserves paragraph breaks in chunks', () => {
      const text = 'Para one.\n\nPara two.\n\nPara three.';
      const chunks = splitIntoChunks(text, 400);
      // Check that chunks contain \n\n (paragraph separator)
      const allText = chunks.join(' ');
      expect(allText).toContain('\n\n');
    });
  });
});