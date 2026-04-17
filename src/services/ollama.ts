export interface OllamaEmbeddingResponse {
  embedding: number[];
}

export interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
}

/**
 * Get an embedding vector for a text string from the local Ollama instance.
 */
export async function queryOllamaEmbedding(
  text: string,
  baseUrl: string,
  model: string
): Promise<number[]> {
  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.statusText}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  return data.embedding;
}

/**
 * Get a chat completion from the local Ollama instance.
 */
export async function queryOllamaChat(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.statusText}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  return data.message.content;
}
