import { AwsClient } from 'aws4fetch';
import type { config } from '../config';
import type { FileStorage } from './index';

/**
 * Any S3-compatible service: AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi…
 * Requests are signed with SigV4 by aws4fetch, so no AWS SDK is needed.
 * The bucket stays private; the API streams files to tree members.
 */
export function createS3Storage(s3: typeof config.photos.s3): FileStorage {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, prefix } = s3;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('PHOTO_STORAGE=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });

  const base = new URL(endpoint || `https://s3.${region}.amazonaws.com`);
  const objectUrl = (key: string) =>
    forcePathStyle
      ? `${base.origin}/${bucket}/${key}`
      : `${base.protocol}//${bucket}.${base.host}/${key}`;

  async function fail(action: string, res: Response): Promise<never> {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`S3 ${action} failed (${res.status}): ${detail}`);
  }

  return {
    name: 's3',

    async put(name, body, contentType) {
      const key = `${prefix}${name}`;
      const res = await client.fetch(objectUrl(key), {
        method: 'PUT',
        body: new Uint8Array(body),
        headers: { 'Content-Type': contentType },
      });
      if (!res.ok) await fail('upload', res);
      return key;
    },

    async get(key) {
      const res = await client.fetch(objectUrl(key));
      if (res.status === 404) return null;
      if (!res.ok) await fail('download', res);
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async remove(key) {
      const res = await client.fetch(objectUrl(key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) await fail('delete', res);
    },
  };
}
