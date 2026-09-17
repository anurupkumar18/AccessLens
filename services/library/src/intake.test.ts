import { describe, expect, it } from 'vitest';
import { MAX_LIBRARY_PDF_BYTES, validateLibraryDocumentMetadata, validateLibraryPdf } from './intake';

const pdf = { key: 'quarantine/upload/notes.pdf', contentType: 'application/pdf', contentLength: 12, firstBytes: new TextEncoder().encode('%PDF-1.7') };
describe('PDF-only library intake', () => {
  it('accepts only a bounded file with a matching MIME type and PDF signature', () => expect(() => validateLibraryPdf(pdf)).not.toThrow());
  it('rejects renamed documents, spoofed MIME types, malformed bytes, and oversized files before durable promotion', () => {
    expect(() => validateLibraryPdf({ ...pdf, key: 'notes.docx' })).toThrow(/PDF/);
    expect(() => validateLibraryPdf({ ...pdf, contentType: 'application/octet-stream' })).toThrow(/application\/pdf/);
    expect(() => validateLibraryPdf({ ...pdf, firstBytes: new TextEncoder().encode('MZ...') })).toThrow(/signature/);
    expect(() => validateLibraryPdf({ ...pdf, contentLength: MAX_LIBRARY_PDF_BYTES + 1 })).toThrow(/32 MiB/);
  });

  it('rejects clearly prohibited library material labels', () => {
    expect(() => validateLibraryDocumentMetadata({ title: 'Midterm answer key' })).toThrow(/cannot include/u);
    expect(() => validateLibraryDocumentMetadata({ title: 'Lecture 5 notes' })).not.toThrow();
  });
});
