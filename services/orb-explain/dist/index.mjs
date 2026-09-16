// src/handler.ts
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
var MODEL_ID = process.env.ORB_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6";
var MAX_INPUT_CHARS = 6e3;
var bedrock = new BedrockRuntimeClient({});
var INSTRUCTIONS = {
  explain: "Explain the key concept on this page for a university student who may have a print disability, low vision, or a learning difference. Lead with the single most important idea in one sentence, then add two or three sentences of support. Use plain language. Do not use markdown, headings, or bullet points; this text will be read aloud by a screen reader.",
  simplify: "Restate the key concept on this page in the simplest accurate language you can. Short sentences. Everyday words. Keep it true -- do not simplify it into something that is wrong. Four sentences at most. No markdown; this will be read aloud.",
  diagram: "Produce a simple, labelled SVG diagram of the key concept on this page, then one short paragraph describing the same thing in words for someone who cannot see it. Return the SVG first inside a ```svg fenced block, then the paragraph. Write the paragraph as plain prose with no markdown, no asterisks and no backticks; it is read aloud by screen readers. The SVG must use a viewBox, no scripts, no external references, and readable font sizes."
};
var SYSTEM = [
  "You help disabled students understand course material they are reading.",
  "Explain only what the supplied page text actually says. If it is too fragmentary",
  "to explain, say so plainly rather than inventing material. Never claim an",
  "instructor reviewed or endorsed your answer."
].join(" ");
function isMode(value) {
  return value === "explain" || value === "simplify" || value === "diagram";
}
function splitSvg(reply) {
  const closed = reply.match(/```svg\s*([\s\S]*?)```/i);
  if (closed) {
    const svg = closed[1].trim();
    const text = reply.replace(closed[0], "").trim();
    return { text: text || "A diagram of the concept on this page.", svg };
  }
  const opening = reply.match(/```svg\s*/i);
  if (opening) {
    const prose = reply.slice(0, opening.index ?? 0).trim();
    return {
      text: prose || "This page was too long to draw. Try selecting just the part you want explained.",
      truncated: true
    };
  }
  return { text: reply.trim() };
}
var CORS = {};
var json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", ...CORS },
  body: JSON.stringify(body)
});
async function handler(event) {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  let request;
  try {
    request = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "Body must be JSON." });
  }
  const mode = isMode(request.mode) ? request.mode : "explain";
  const text = typeof request.text === "string" ? request.text.slice(0, MAX_INPUT_CHARS).trim() : "";
  if (text.length < 40) {
    return json(400, { error: "Not enough readable text on this page to explain." });
  }
  const title = typeof request.title === "string" ? request.title.slice(0, 200) : "";
  try {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM }],
        messages: [
          {
            role: "user",
            content: [
              {
                text: `${INSTRUCTIONS[mode]}

Page title: ${title}

Page text:
${text}`
              }
            ]
          }
        ],
        // 1600 truncated real Canvas pages mid-SVG. A labelled diagram plus its
        // written description runs longer than it looks.
        inferenceConfig: { maxTokens: mode === "diagram" ? 4e3 : 500, temperature: 0.2 }
      })
    );
    const reply = response.output?.message?.content?.find((part) => "text" in part)?.text ?? "";
    if (!reply.trim()) return json(502, { error: "The model returned nothing usable." });
    console.log(JSON.stringify({ event: "explained", mode, inputChars: text.length }));
    return json(200, splitSvg(reply));
  } catch (error) {
    console.log(
      JSON.stringify({ event: "explain_failed", mode, reason: error?.name ?? "Unknown" })
    );
    return json(502, { error: "The explanation service could not reach the model." });
  }
}
export {
  handler,
  splitSvg
};
