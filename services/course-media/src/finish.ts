/**
 * EventBridge: a Transcribe job for an uploaded recording finished. Turns its
 * WebVTT into the item's manifest and marks it ready for students.
 */
import { GetTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe';
import { keys, parseJobName, type Manifest } from './manifest.js';
import { getItem, putManifest, readText, updateItem } from './store.js';
import { parseVtt } from './vtt.js';

const transcribe = new TranscribeClient({});

interface TranscribeStateChange {
  detail?: { TranscriptionJobName?: string; TranscriptionJobStatus?: string };
}

export async function handler(event: TranscribeStateChange): Promise<void> {
  const jobName = event.detail?.TranscriptionJobName ?? '';
  const parts = parseJobName(jobName);
  if (!parts) return;
  const { classCode, itemId } = parts;
  const item = await getItem(classCode, itemId);
  if (!item) return;

  if (event.detail?.TranscriptionJobStatus !== 'COMPLETED') {
    await updateItem(classCode, itemId, {
      status: 'failed',
      error: 'Captions could not be made for this recording. Check that it has an audio track with speech.',
    });
    return;
  }

  try {
    const job = (await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))).TranscriptionJob;
    const base = keys.derived(classCode, itemId);
    const vttKey = `${base}/transcribe/${jobName}.vtt`;
    const media = JSON.parse(await readText(`${base}/media.json`)) as { type: 'video' | 'audio'; mediaKey?: string };
    const manifest: Manifest = {
      version: 1, itemId, fileName: item.fileName, kind: 'media',
      media: {
        type: media.type,
        ...(media.mediaKey ? { mediaKey: media.mediaKey } : {}),
        vttKey,
        ...(job?.LanguageCode ? { language: job.LanguageCode } : {}),
        transcript: parseVtt(await readText(vttKey)),
      },
    };
    await putManifest(keys.manifest(classCode, itemId), manifest);
    await updateItem(classCode, itemId, { status: 'ready' });
  } catch (error) {
    console.log(JSON.stringify({ event: 'captions-finish-failed', classCode, itemId, reason: (error as Error).name }));
    await updateItem(classCode, itemId, { status: 'failed', error: 'Captions were made but could not be saved. Upload the file again.' });
  }
}
