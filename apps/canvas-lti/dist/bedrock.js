"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeBedrock = invokeBedrock;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
// Fallback logic if environment variables are missing
const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || ''
};
// Initialize the Bedrock client
const client = new client_bedrock_runtime_1.BedrockRuntimeClient(credentials.accessKeyId ? { region, credentials } : { region });
async function invokeBedrock(request) {
    let promptText = '';
    if (request.mode === 'simplify') {
        promptText = `You are an expert tutor. Simplify the following Canvas course material for a student. Make it easy to read and understand.\n\nMaterial:\n${request.context}`;
    }
    else if (request.mode === 'diagram') {
        promptText = `You are an expert tutor. Create a mermaid diagram explaining the following Canvas course material. Wrap your diagram in a \`\`\`mermaid block.\n\nMaterial:\n${request.context}`;
    }
    else {
        promptText = `You are an expert tutor. Explain the following Canvas course material in detail.\n\nMaterial:\n${request.context}`;
    }
    if (request.query) {
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
    const command = new client_bedrock_runtime_1.InvokeModelCommand({
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
