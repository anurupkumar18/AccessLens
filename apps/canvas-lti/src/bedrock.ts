import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Fallback logic if environment variables are missing
const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  sessionToken: process.env.AWS_SESSION_TOKEN || ''
};

// Initialize the Bedrock client
const client = new BedrockRuntimeClient(
  credentials.accessKeyId ? { region, credentials } : { region }
);

export interface ExplanationRequest {
  mode: 'explain' | 'simplify' | 'diagram' | 'auto-grade' | 'quiz-gen' | 'tutor-chat';
  context: string;
  query?: string;
  submission?: string;
  rubric?: string;
}

export async function invokeBedrock(request: ExplanationRequest): Promise<string> {
  let promptText = '';
  
  if (request.mode === 'simplify') {
    promptText = `You are an expert tutor. Simplify the following Canvas course material for a student. Make it easy to read and understand.\n\nMaterial:\n${request.context}`;
  } else if (request.mode === 'diagram') {
    promptText = `You are an expert tutor. Create a mermaid diagram explaining the following Canvas course material. Wrap your diagram in a \`\`\`mermaid block.\n\nMaterial:\n${request.context}`;
  } else if (request.mode === 'auto-grade') {
    promptText = `You are an expert grader. Grade the following student submission based on the provided material and rubric. Return a score out of 100 and a short paragraph of feedback.\n\nMaterial/Context:\n${request.context}\n\nRubric:\n${request.rubric || 'Standard grading'}\n\nStudent Submission:\n${request.submission}`;
  } else if (request.mode === 'quiz-gen') {
    promptText = `You are an expert curriculum designer. Generate a 3-question multiple-choice quiz based on the following course material. Format the output clearly with the correct answer indicated.\n\nMaterial:\n${request.context}`;
  } else if (request.mode === 'tutor-chat') {
    promptText = `You are a personalized AI tutor embedded in Canvas. The student has asked a question based on their course material. Be encouraging and helpful.\n\nCourse Material:\n${request.context}\n\nStudent Question:\n${request.query}`;
  } else {
    promptText = `You are an expert tutor. Explain the following Canvas course material in detail.\n\nMaterial:\n${request.context}`;
  }

  if (request.query && request.mode !== 'tutor-chat') {
    promptText += `\n\nStudent Question: ${request.query}`;
  }

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: promptText,
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: 'us.anthropic.claude-sonnet-4-6',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  
  if (responseBody.content && responseBody.content.length > 0) {
    return responseBody.content[0].text;
  }
  
  return 'No explanation could be generated.';
}
