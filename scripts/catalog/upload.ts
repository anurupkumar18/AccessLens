import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface CatalogUploadOptions {
  bucket: string;
  catalogRoot?: string;
  prefix?: string;
  /** Test seam; production defaults to the AWS S3 client. */
  send?: (command: PutObjectCommand) => Promise<unknown>;
}

function contentType(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function filesUnder(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else files.push(path);
  }
  return files;
}

export async function uploadCatalog(options: CatalogUploadOptions): Promise<number> {
  if (!options.bucket.trim()) throw new Error('S3 bucket is required');
  const catalogRoot = resolve(options.catalogRoot ?? 'packages/catalog');
  const prefix = options.prefix ? options.prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const send = options.send ?? ((command: PutObjectCommand) => client.send(command));
  const files = await filesUnder(catalogRoot);
  for (const file of files) {
    const key = `${prefix}${relative(catalogRoot, file).split('\\').join('/')}`;
    await send(new PutObjectCommand({
      Bucket: options.bucket,
      Key: key,
      Body: await readFile(file),
      ContentType: contentType(file),
    }));
    console.log(`uploaded s3://${options.bucket}/${key}`);
  }
  return files.length;
}

function parseArgs(args: string[]): CatalogUploadOptions {
  const bucketIndex = args.indexOf('--bucket');
  const bucket = bucketIndex >= 0 ? args[bucketIndex + 1] : process.env.CATALOG_BUCKET;
  if (!bucket) throw new Error('catalog bucket is required via --bucket or CATALOG_BUCKET');
  const catalogIndex = args.indexOf('--catalog');
  return { bucket, catalogRoot: catalogIndex >= 0 && args[catalogIndex + 1] ? args[catalogIndex + 1] : undefined };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/catalog/upload.ts')) {
  uploadCatalog(parseArgs(process.argv.slice(2))).then(count => console.log(`Uploaded ${count} catalog files.`)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
