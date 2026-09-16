# Screen analysis endpoint

The extension can use a consented AWS Textract/Bedrock adapter by setting
`VITE_ACCESSLENS_ANALYSIS_URL` in `.env.local`. The instructor must still click
Start and approve the browser screen-share prompt. Frames are posted transiently
to this endpoint; the endpoint must not persist them.

## Request

```json
{ "width": 1280, "height": 720, "rgba": [0, 0, 0, 255] }
```

The `rgba` array is the current frame's pixel buffer. The adapter should invoke
Textract for text-heavy material and a Bedrock multimodal model for layout,
meaning, and AR interpretation, then discard the frame.

## Response

```json
{
  "title": "Mitochondria",
  "summary": "The mitochondrion produces usable energy for the cell.",
  "text": ["..."],
  "audioDescription": "A labeled cell diagram with the mitochondrion highlighted.",
  "focusRegion": {
    "label": "Mitochondrion", "x": 0.42, "y": 0.31,
    "width": 0.18, "height": 0.24,
    "description": "The highlighted organelle produces usable cellular energy."
  }
}
```

The response is validated before it is relayed as `screen.analyzed`. Student
Hear, Focus, Read, and Dyslexic modes render this result instead of reading a
reviewed pack. AR scene generation remains a follow-up field once the Bedrock
vision prompt and scene validator are approved.
