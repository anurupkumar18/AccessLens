// Builds a DRAFT Access Pack from a slide deck with no manual authoring.
//
//   npx tsx scripts/build-pack.ts <deck.pptx | slides-dir> --pack-id <id> --title "<deck title>" --out <dir>
//
// Pipeline: pptx -> PDF (LibreOffice) -> PNG per slide (pdftoppm) -> Claude
// Sonnet 4.6 on Bedrock describes each slide (title, reading order, regions
// with normalized bounds and two descriptions) -> dhash-v1 fingerprints ->
// <out>/pack.draft.json validated with AccessPackSchema.
//
// Charter A3: machine-generated descriptions are drafts until an instructor
// reviews them. The output is deliberately named pack.draft.json; the review
// step is renaming it to pack.json after reading it. Nothing here publishes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { z } from 'zod';
import { AccessPackSchema, type AccessPack } from '../apps/extension/src/shared/contracts';
import { fingerprintFrame } from '../apps/extension/src/sources/screen';

const MODEL = 'us.anthropic.claude-sonnet-4-6';
const REGION = 'us-east-1';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`missing ${name}`);
  process.exit(2);
}
const input = process.argv[2];
if (!input || input.startsWith('--')) {
  console.error('usage: build-pack.ts <deck.pptx | slides-dir> --pack-id <id> --title "<title>" [--out <dir>] [--version 1]');
  process.exit(2);
}
const packId = arg('--pack-id');
const title = arg('--title');
const out = resolve(arg('--out', join('packs', packId)));
const version = Number(arg('--version', '1'));
const slidesDir = join(out, 'slides');
mkdirSync(slidesDir, { recursive: true });

// ---- 1. Slides to PNG -----------------------------------------------------
function renderDeck(deck: string): void {
  console.error(`rendering ${basename(deck)} with LibreOffice…`);
  // A private LibreOffice profile: the default one lives under ~/Library and
  // makes headless runs hang inside sandboxes or when the GUI app is open.
  const profile = join(tmpdir(), 'accesslens-lo-profile');
  mkdirSync(profile, { recursive: true });
  execFileSync('soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', slidesDir, deck], { stdio: 'inherit' });
  const pdf = join(slidesDir, basename(deck, extname(deck)) + '.pdf');
  execFileSync('pdftoppm', ['-png', '-scale-to-x', '1920', '-scale-to-y', '-1', pdf, join(slidesDir, 'page')], { stdio: 'inherit' });
  rmSync(pdf);
  const pages = readdirSync(slidesDir).filter(f => /^page-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  pages.forEach((f, i) => renameSync(join(slidesDir, f), join(slidesDir, `slide-${String(i + 1).padStart(2, '0')}.png`)));
}
if (existsSync(input) && extname(input).toLowerCase() === '.pptx') renderDeck(resolve(input));
else if (existsSync(input) && resolve(input) !== slidesDir) {
  for (const f of readdirSync(input).filter(f => f.endsWith('.png'))) writeFileSync(join(slidesDir, f), readFileSync(join(input, f)));
}
const slideFiles = readdirSync(slidesDir).filter(f => /^slide-\d+\.png$/.test(f)).sort();
if (slideFiles.length === 0) { console.error('no slide-NN.png files found'); process.exit(1); }

// ---- 2. Describe each slide with Claude Sonnet 4.6 on Bedrock -------------
const Draft = z.object({
  title: z.string().min(1).max(120),
  readingOrder: z.array(z.string().min(1)).min(1),
  regions: z.array(z.object({
    regionId: z.string().regex(/^[a-z0-9-]+$/),
    bounds: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }),
    shortDescription: z.string().min(1).max(700),
    plainLanguage: z.string().min(1).max(500),
  })).min(1).max(6).refine(rs => new Set(rs.map(r => r.regionId)).size === rs.length, { message: 'regionIds must be unique within a slide' }),
});

const SYSTEM = `You write draft accessibility descriptions for lecture slides. An instructor will review every word before students see it.
Always answer by calling the submit_slide_description tool exactly once.
Rules:
- title: the slide's own heading if it has one, otherwise a 3-8 word neutral description of its content.
- regions: 1 to 6 meaningful visual regions (a diagram, a chart, a code block, a bullet list, a key figure). regionId is lowercase kebab-case and unique within the slide. bounds are fractions of the slide width/height from the top-left corner, covering the region tightly.
- readingOrder: "title" first (if the slide has a heading) followed by regionIds in the order a sighted reader would take.
- shortDescription: one or two factual sentences, at most 60 words, a screen reader can speak, describing what is shown, including any text that carries meaning. Do not interpret intent or add facts not visible.
- plainLanguage: one shorter sentence, at most 35 words, for a reader new to the topic, same meaning, simpler words.
- Never mention people, faces, or anyone's characteristics. Never grade or evaluate the slide.`;

const TOOL = {
  name: 'submit_slide_description',
  description: 'Submit the draft accessibility description for one slide.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['title', 'readingOrder', 'regions'],
    properties: {
      title: { type: 'string' },
      readingOrder: { type: 'array', items: { type: 'string' } },
      regions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['regionId', 'bounds', 'shortDescription', 'plainLanguage'],
          properties: {
            regionId: { type: 'string' },
            bounds: {
              type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'],
              properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
            },
            shortDescription: { type: 'string' },
            plainLanguage: { type: 'string' },
          },
        },
      },
    },
  },
};

const client = new AnthropicBedrock({ awsRegion: REGION });

async function describe(file: string, attempt = 1): Promise<z.infer<typeof Draft>> {
  const data = readFileSync(join(slidesDir, file)).toString('base64');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
      { type: 'text', text: `Describe this slide (${file}) from the deck "${title}".` },
    ] }],
  });
  const call = response.content.find(b => b.type === 'tool_use');
  const parsed = call ? Draft.safeParse(call.input) : null;
  if (parsed?.success) return parsed.data;
  if (attempt < 3) { console.error(`  retrying ${file} (attempt ${attempt + 1})`); return describe(file, attempt + 1); }
  throw new Error(`No valid description for ${file}: ${parsed ? JSON.stringify(parsed.error.issues) : 'no tool call'}`);
}

// ---- 3. Fingerprint and assemble -----------------------------------------
const assets: AccessPack['assets'] = [];
for (const file of slideFiles) {
  const assetId = basename(file, '.png');
  // Cache per slide so a rerun after fixing one slide does not re-describe the deck.
  const cachePath = join(slidesDir, `${assetId}.description.json`);
  let draft: z.infer<typeof Draft>;
  if (existsSync(cachePath) && !process.argv.includes('--redo')) {
    draft = Draft.parse(JSON.parse(readFileSync(cachePath, 'utf8')));
    console.error(`${assetId}: cached description`);
  } else {
    console.error(`describing ${assetId}…`);
    draft = await describe(file);
    writeFileSync(cachePath, JSON.stringify(draft, null, 2) + '\n');
  }
  const png = PNG.sync.read(readFileSync(join(slidesDir, file)));
  const fingerprint = fingerprintFrame({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) });
  assets.push({ assetId, fingerprint, title: draft.title, readingOrder: draft.readingOrder, regions: draft.regions });
  console.error(`  ${fingerprint}  ${draft.title}`);
}

const pack = AccessPackSchema.parse({ schemaVersion: '1.0', packId, version, title, assets });
const draftPath = join(out, 'pack.draft.json');
writeFileSync(draftPath, JSON.stringify(pack, null, 2) + '\n');
console.error(`\nwrote ${draftPath} (${assets.length} slides).`);
console.error('DRAFT: an instructor must read every title and description, fix or delete what is wrong, then rename it to pack.json before students can see it (charter A3).');
