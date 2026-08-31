// Node-only opt-in entry point. The main SDK remains usable in Cloudflare Workers.
import { open } from 'node:fs/promises';
import { JanuaryValidationError } from './errors.js';
import type { Sharp, SharpOptions } from 'sharp';

export type ImageInput = string | Uint8Array | ArrayBuffer | Blob | AsyncIterable<Uint8Array>;
export interface ImageOptions { readonly preprocess?: boolean }
export const MAX_IMAGE_BYTES = 3_500_000;
export const MAX_IMAGE_DIMENSION = 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** Prepare a public URL, data URI, trusted path, upload bytes, Blob, or readable stream.
 * Never pass an untrusted user's string as a filesystem path. URLs/data URIs are
 * unchanged; January downloads URLs. Local preprocessing requires the sharp peer.
 * Re-encoding strips metadata; compliant original bytes retain their metadata.
 */
export async function prepareImage(source: ImageInput, options: ImageOptions = {}): Promise<string> {
  if (typeof source === 'string' && /^(https?:\/\/|data:)/i.test(source)) return source;
  let bytes: Buffer;
  if (typeof source === 'string') {
    if (/^(file:|[a-z][a-z0-9+.-]+:\/\/)/i.test(source)) throw new JanuaryValidationError('Use HTTP(S), a data URI, or a trusted local path');
    const file = await open(source, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new JanuaryValidationError('Image path must be a file under 64 MiB');
      // Limit reads even if the file grows after stat.
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of file.createReadStream({autoClose:false})) {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) throw new JanuaryValidationError('Image source exceeds 64 MiB');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
    } finally { await file.close(); }
  } else if (source instanceof Uint8Array) bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  else if (source instanceof ArrayBuffer) bytes = Buffer.from(source);
  else if (source instanceof Blob) {
    if (source.size > MAX_SOURCE_BYTES) throw new JanuaryValidationError('Image source exceeds 64 MiB');
    bytes = Buffer.from(await source.arrayBuffer());
  } else if (source && typeof source === 'object' && Symbol.asyncIterator in source) {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) throw new JanuaryValidationError('Use a binary image stream, not text');
      size += chunk.byteLength;
      if (size > MAX_SOURCE_BYTES) throw new JanuaryValidationError('Image source exceeds 64 MiB');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  } else throw new JanuaryValidationError('Expected an image URL, path, bytes, Blob, or binary stream');
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new JanuaryValidationError('Image is empty or exceeds 64 MiB');
  let sharp: (input: Buffer, options: SharpOptions) => Sharp;
  try { sharp = (await import('sharp')).default; }
  catch { throw new JanuaryValidationError('Local image preparation requires sharp. Install it with npm install sharp'); }
  try {
    const image = sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'});
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1 && metadata.format !== 'jpeg') throw new JanuaryValidationError('Animated images are not supported');
    const mime = ({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'} as Record<string,string>)[metadata.format ?? ''];
    const uri = (data: Buffer, type: string) => `data:${type};base64,${data.toString('base64')}`;
    if (options.preprocess === false) {
      if (!mime || bytes.length > MAX_IMAGE_BYTES) throw new JanuaryValidationError('Use JPEG, PNG, WEBP, or still GIF under 3.5 MB, or enable preprocessing');
      return uri(bytes,mime);
    }
    // Force decode so corrupt/truncated small images cannot pass through on metadata alone.
    await image.clone().stats();
    if (mime && bytes.length <= MAX_IMAGE_BYTES && Math.max(metadata.width ?? 0,metadata.height ?? 0) <= MAX_IMAGE_DIMENSION
      && (metadata.orientation ?? 1) === 1 && metadata.space !== 'cmyk' && metadata.depth === 'uchar') return uri(bytes,mime);
    for (const quality of [85,75,65]) {
      const output = await image.clone().rotate().resize({width:MAX_IMAGE_DIMENSION,height:MAX_IMAGE_DIMENSION,fit:'inside',withoutEnlargement:true})
        .flatten({background:'#ffffff'}).toColourspace('srgb').jpeg({quality}).toBuffer();
      if (output.length <= MAX_IMAGE_BYTES) return uri(output,'image/jpeg');
    }
    throw new JanuaryValidationError('Image cannot fit the 3.5 MB limit');
  } catch (error) {
    if (error instanceof JanuaryValidationError) throw error;
    throw new JanuaryValidationError('Image could not be decoded; convert HEIC/HEIF/AVIF or corrupt input to a supported JPEG or PNG');
  }
}
