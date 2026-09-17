/**
 * Where the study chat looks things up in the instructor's course materials.
 *
 * The chat does not do retrieval itself: it offers the model a
 * `search_course_materials` tool and hands the query to a `CourseKnowledge`.
 * The team's retrieval work plugs in here without the chat changing. Shipped
 * today: an adapter for an Amazon Bedrock Knowledge Base, whose data source is
 * the S3 bucket the instructor's files and folders are uploaded to. Anything
 * else that returns passages (the course library's S3 Vectors retriever, a
 * RAG service) is one more implementation of the same interface.
 */

export interface Passage {
  /** Stable within one response; the chat cites passages by it. */
  id: string;
  /** What a student would recognise: a file name, a document title. */
  title: string;
  text: string;
  /** Where it came from, such as the S3 object URI. Shown, never fetched. */
  source?: string;
}

export interface KnowledgeScope {
  packId: string;
  assetId?: string;
}

export interface CourseKnowledge {
  search(query: string, scope: KnowledgeScope): Promise<Passage[]>;
}

/** Longest passage handed to the model; retrieval chunks are usually far shorter. */
export const PASSAGE_MAX_CHARS = 1500;
export const SEARCH_RESULTS = 5;

/** The part of `@aws-sdk/client-bedrock-agent-runtime`'s Retrieve this needs, so tests can fake it. */
export type RetrieveCall = (input: {
  knowledgeBaseId: string;
  retrievalQuery: { text: string };
  retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: number } };
}) => Promise<{
  retrievalResults?: Array<{
    content?: { text?: string };
    location?: { s3Location?: { uri?: string }; webLocation?: { url?: string } };
    metadata?: Record<string, unknown>;
  }>;
}>;

/** A Bedrock Knowledge Base, typically over the S3 bucket instructors upload course files to. */
export function bedrockKnowledgeBase(knowledgeBaseId: string, retrieve: RetrieveCall): CourseKnowledge {
  return {
    async search(query) {
      const response = await retrieve({
        knowledgeBaseId,
        retrievalQuery: { text: query.slice(0, 1000) },
        retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: SEARCH_RESULTS } },
      });
      const passages: Passage[] = [];
      for (const result of response.retrievalResults ?? []) {
        const text = result.content?.text?.trim();
        if (!text) continue;
        const source = result.location?.s3Location?.uri ?? result.location?.webLocation?.url;
        passages.push({
          id: `source-${passages.length + 1}`,
          title: titleFrom(source),
          text: text.slice(0, PASSAGE_MAX_CHARS),
          ...(source ? { source } : {}),
        });
      }
      return passages;
    },
  };
}

/** `s3://bucket/course/week-3/Lecture notes.pdf` reads as `Lecture notes.pdf`. */
function titleFrom(source: string | undefined): string {
  if (!source) return 'Course material';
  const last = decodeURIComponent(source.split('/').filter(Boolean).at(-1) ?? '');
  return last || 'Course material';
}
