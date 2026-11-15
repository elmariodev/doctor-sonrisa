// RAG over the clinic's public documents: the question becomes an embedding
// and Vectorize returns the closest paragraphs. Patient data is never here.
export const EMBED_MODEL = "@cf/baai/bge-m3";

export async function searchDocs(env: { AI: Ai; VECTORIZE: VectorizeIndex }, question: string, topK = 4) {
  const { data } = (await env.AI.run(EMBED_MODEL, { text: [question] })) as { data: number[][] };
  const res = await env.VECTORIZE.query(data[0], { topK, returnMetadata: "all" });
  return res.matches
    .filter((m) => m.score >= 0.4)
    .map((m) => ({ doc: String(m.metadata?.doc), text: String(m.metadata?.text), score: Number(m.score.toFixed(3)) }));
}
