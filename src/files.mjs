import { open, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { BotError } from './errors.mjs';

// Received files are protocol payloads, not user documents: the OneBot client
// decides what to do with them. Only the cache boundary is enforced here.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const attachmentError = message => new BotError(message, 1400);
export const acceptsFileName = name => typeof name === 'string' && !/[\u0000-\u001f\u007f]/.test(name);
export const safeName = value => String(value || 'file')
  .split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180) || 'file';

export async function readOwnedFile(root, source, maxBytes = MAX_ATTACHMENT_BYTES, signal) {
  signal?.throwIfAborted();
  const directory = await realpath(root), path = await realpath(source), part = relative(directory, path);
  if (!part || part === '..' || part.startsWith('..\\') || part.startsWith('../') || isAbsolute(part)) {
    throw attachmentError('File is outside the managed cache directory');
  }
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw attachmentError('File is empty or too large');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw attachmentError('File content is incomplete');
      offset += result.bytesRead;
    }
    return bytes;
  } finally { await handle?.close(); }
}
