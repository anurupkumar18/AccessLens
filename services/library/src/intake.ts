/** PDF-only intake checks run before an uploaded object is copied into a class library. */
export const MAX_LIBRARY_PDF_BYTES = 32 * 1024 * 1024;

export interface UploadedPdf {
  key: string;
  contentType?: string;
  contentLength?: number;
  firstBytes?: Uint8Array;
}

export function validateLibraryPdf(upload: UploadedPdf): void {
  if (!/\.pdf$/iu.test(upload.key)) throw new Error('Only PDF course materials are supported.');
  if (upload.contentType !== 'application/pdf') throw new Error('Course material must declare application/pdf.');
  if (!upload.contentLength || upload.contentLength < 5 || upload.contentLength > MAX_LIBRARY_PDF_BYTES) throw new Error('Course PDF must be between 5 bytes and 32 MiB.');
  const prefix = new TextDecoder().decode(upload.firstBytes?.slice(0, 5));
  if (prefix !== '%PDF-') throw new Error('Course material does not have a valid PDF signature.');
}

/** Reject obvious prohibited material before it gets a durable class record. */
export function validateLibraryDocumentMetadata(input: { title: string }): void {
  if (/\b(?:answer\s*key|student\s*(?:work|submission)|grade(?:book|s)?|quiz(?:zes)?|exam(?:s)?|assessment(?:s)?)\b/iu.test(input.title)) {
    throw new Error('Course materials cannot include student work, assessments, grades, or answer keys.');
  }
}
