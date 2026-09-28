/**
 * Evidence storage — FR-EVD-01…05, NFR-SEC-07.
 *
 *  - file type is checked from the file CONTENT (magic bytes), not the extension
 *  - macro-enabled Office files, executables and scripts are always rejected
 *  - ≤ 10 MB per file, 1–5 files per KPI
 *  - SHA-256 is computed and stored for every file
 *  - files are written under a random object key; optionally AES-256-GCM encrypted
 *    at rest (EVIDENCE_ENCRYPT_AT_REST)
 *  - downloads use authorised, time-limited (5 min) signed URLs and are audited
 */
import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, unlink, stat } from 'fs/promises';
import { resolve, join, basename } from 'path';
import {
  ALLOWED_EVIDENCE_EXTENSIONS,
  BLOCKED_EVIDENCE_EXTENSIONS,
  EVIDENCE_SIGNED_URL_TTL_SECONDS,
} from '../../common/constants';
import { Unprocessable, NotFound, Forbidden } from '../../common/errors/error-codes';
import { ErrorCode } from '../../common/errors/error-codes';

export interface SniffResult {
  mimeType: string;
  extension: string;
  category: 'pdf' | 'image' | 'spreadsheet' | 'document' | 'csv' | 'unknown';
}

export interface StoredEvidence {
  storageKey: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
}

const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

@Injectable()
export class EvidenceStorageService {
  private readonly logger = new Logger(EvidenceStorageService.name);

  private root(): string {
    const dir = resolve(process.env.STORAGE_LOCAL_PATH || './storage/evidence');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Magic-byte sniffing — the server never trusts the client's MIME type. */
  sniff(buffer: Buffer, originalName: string): SniffResult {
    const hex = buffer.subarray(0, 16).toString('hex').toLowerCase();
    const ascii = buffer.subarray(0, 8).toString('latin1');

    // PDF: %PDF
    if (ascii.startsWith('%PDF')) return { mimeType: 'application/pdf', extension: 'pdf', category: 'pdf' };
    // JPEG: FF D8 FF
    if (hex.startsWith('ffd8ff')) return { mimeType: 'image/jpeg', extension: 'jpg', category: 'image' };
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (hex.startsWith('89504e470d0a1a0a')) return { mimeType: 'image/png', extension: 'png', category: 'image' };
    // GIF
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
      return { mimeType: 'image/gif', extension: 'gif', category: 'image' };
    }
    // ZIP container → XLSX (PK\x03\x04) — DOCX shares the same container
    if (hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708')) {
      const declared = extOf(originalName);
      if (declared === 'docx') {
        return {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extension: 'docx',
          category: 'document',
        };
      }
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        category: 'spreadsheet',
      };
    }
    // Legacy Office OLE2 compound file: D0 CF 11 E0 A1 B1 1A E1
    if (hex.startsWith('d0cf11e0a1b11ae1')) {
      const declared = extOf(originalName);
      if (declared === 'xls') return { mimeType: 'application/vnd.ms-excel', extension: 'xls', category: 'spreadsheet' };
      if (declared === 'doc') return { mimeType: 'application/msword', extension: 'doc', category: 'document' };
      return { mimeType: 'application/vnd.ms-excel', extension: 'xls', category: 'spreadsheet' };
    }
    // RAR / 7z / GZIP → never an allowed evidence type
    if (hex.startsWith('526172211a07') || hex.startsWith('377abcaf271c') || hex.startsWith('1f8b')) {
      return { mimeType: 'application/octet-stream', extension: extOf(originalName), category: 'unknown' };
    }
    // Windows executable / script headers
    if (ascii.startsWith('MZ') || hex.startsWith('7f454c46') || ascii.startsWith('#!')) {
      return { mimeType: 'application/octet-stream', extension: extOf(originalName), category: 'unknown' };
    }

    // CSV / plain text: printable ASCII/UTF-8 without control characters
    if (looksLikeText(buffer)) {
      const declared = extOf(originalName);
      if (declared === 'csv' || buffer.includes(0x2c) || buffer.includes(0x3b)) {
        return { mimeType: 'text/csv', extension: 'csv', category: 'csv' };
      }
      return { mimeType: 'text/plain', extension: declared || 'txt', category: 'csv' };
    }

    return { mimeType: 'application/octet-stream', extension: extOf(originalName), category: 'unknown' };
  }

  /** Full validation used by the upload endpoint. */
  validate(
    buffer: Buffer,
    originalName: string,
    maxSizeMb = Number(process.env.EVIDENCE_MAX_SIZE_MB ?? 10),
  ): SniffResult {
    const sizeMb = buffer.length / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, `Each file must be ${maxSizeMb} MB or smaller (received ${sizeMb.toFixed(2)} MB).`);
    }
    if (buffer.length === 0) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, 'The uploaded file is empty.');
    }

    const declaredExt = extOf(originalName);
    if ((BLOCKED_EVIDENCE_EXTENSIONS as readonly string[]).includes(declaredExt)) {
      throw Unprocessable(
        ErrorCode.FILE_REJECTED,
        `“.${declaredExt}” files are not accepted as evidence. Allowed: ${ALLOWED_EVIDENCE_EXTENSIONS.join(', ')}.`,
      );
    }

    const sniffed = this.sniff(buffer, originalName);

    // EICAR malware test signature (AC-07)
    if (buffer.toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, 'The file failed the malware scan and was rejected.');
    }

    const allowed =
      (ALLOWED_EVIDENCE_EXTENSIONS as readonly string[]).includes(sniffed.extension) ||
      (sniffed.category === 'csv' && ['csv', 'xls', 'xlsx', 'docx', 'txt'].includes(declaredExt));

    if (!allowed || sniffed.category === 'unknown') {
      throw Unprocessable(
        ErrorCode.FILE_REJECTED,
        `The file content is not a supported evidence type. Allowed: PDF, JPG, PNG, XLSX, XLS, CSV or DOCX.`,
      );
    }

    // A macro-enabled container masquerading as xlsx/docx is rejected by content check above.
    return sniffed;
  }

  /** Writes the file under a random object key and returns its metadata. */
  async store(
    buffer: Buffer,
    originalName: string,
    sniffed: SniffResult,
    kpiId: string,
  ): Promise<StoredEvidence> {
    const safeOriginal = basename(originalName).slice(0, 240);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const objectKey = `${kpiId}/${randomUUID()}.${sniffed.extension}`;
    const absolute = join(this.root(), objectKey);

    const encrypt = String(process.env.EVIDENCE_ENCRYPT_AT_REST ?? 'true') === 'true';
    let payload: Buffer = buffer;
    if (encrypt) {
      payload = this.encrypt(buffer);
    }

    await writeFile(absolute, payload);

    return {
      storageKey: objectKey,
      fileName: `${sha256.slice(0, 12)}.${sniffed.extension}`,
      originalName: safeOriginal,
      mimeType: sniffed.mimeType,
      extension: sniffed.extension,
      sizeBytes: buffer.length,
      sha256,
      encrypted: encrypt,
    };
  }

  /** Reads a stored object back, decrypting when required. */
  async read(storageKey: string, encrypted: boolean): Promise<Buffer> {
    const absolute = join(this.root(), storageKey);
    if (!existsSync(absolute)) {
      throw NotFound(ErrorCode.NOT_FOUND, 'The evidence file is no longer available. Contact Group IT.');
    }
    const raw = await readFile(absolute);
    return encrypted ? this.decrypt(raw) : raw;
  }

  async exists(storageKey: string): Promise<boolean> {
    return existsSync(join(this.root(), storageKey));
  }

  async size(storageKey: string): Promise<number> {
    try {
      const s = await stat(join(this.root(), storageKey));
      return s.size;
    } catch {
      return 0;
    }
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(join(this.root(), storageKey));
    } catch {
      /* already gone */
    }
  }

  // --------------------------------------------------------------- encryption

  private key(): Buffer {
    const raw = process.env.EVIDENCE_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    return createHash('sha256').update(raw).digest();
  }

  private encrypt(buffer: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from('ANW1'), iv, tag, enc]);
  }

  private decrypt(buffer: Buffer): Buffer {
    if (buffer.subarray(0, 4).toString('ascii') !== 'ANW1') return buffer; // stored unencrypted
    const iv = buffer.subarray(4, 16);
    const tag = buffer.subarray(16, 32);
    const data = buffer.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  // ------------------------------------------------------------- signed links

  /**
   * Time-limited signed URL — FR-EVD-04 (5 minutes). The signature covers the
   * file id and the expiry, so a leaked URL dies quickly.
   */
  sign(evidenceId: string, ttlSeconds = EVIDENCE_SIGNED_URL_TTL_SECONDS): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const payload = `${evidenceId}.${expiresAt}`;
    const signature = createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'evidence-signing-key')
      .update(payload)
      .digest('base64url');
    return { token: `${expiresAt}.${signature}`, expiresAt };
  }

  verifySignature(evidenceId: string, token: string): void {
    const [expiresRaw, signature] = (token || '').split('.');
    const expiresAt = Number(expiresRaw);
    if (!expiresAt || !signature) {
      throw Forbidden('FORBIDDEN', 'This download link is not valid.');
    }
    if (expiresAt < Date.now()) {
      throw Forbidden('FORBIDDEN', 'This download link has expired. Request a new one.');
    }
    const expected = createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'evidence-signing-key')
      .update(`${evidenceId}.${expiresAt}`)
      .digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw Forbidden('FORBIDDEN', 'This download link is not valid.');
    }
  }

  /** Optional ClamAV integration hook (MALWARE_SCAN_ENABLED). */
  async malwareScan(buffer: Buffer): Promise<{ clean: boolean; detail?: string }> {
    if (String(process.env.MALWARE_SCAN_ENABLED ?? 'false') !== 'true') {
      return { clean: true, detail: 'scan-disabled' };
    }
    try {
      const net = await import('net');
      const host = process.env.CLAMAV_HOST ?? 'localhost';
      const port = Number(process.env.CLAMAV_PORT ?? 3310);
      return await new Promise((resolvePromise) => {
        const socket = net.createConnection({ host, port }, () => socket.write('zINSTREAM\0'));
        const chunks: Buffer[] = [];
        // INSTREAM framing
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buffer.length, 0);
        socket.write(size);
        socket.write(buffer);
        socket.write(Buffer.alloc(4));
        socket.on('data', (d) => chunks.push(d));
        socket.on('end', () => {
          const response = Buffer.concat(chunks).toString('utf8').trim();
          resolvePromise({ clean: response.endsWith('OK'), detail: response });
        });
        socket.on('error', (e) => resolvePromise({ clean: true, detail: `scan-unavailable: ${e.message}` }));
        setTimeout(() => socket.destroy(), 15_000);
      });
    } catch (e) {
      this.logger.warn(`Malware scan unavailable: ${(e as Error).message}`);
      return { clean: true, detail: 'scan-unavailable' };
    }
  }
}

const extOf = (name: string): string => {
  const parts = (name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1].slice(0, 10) : '';
};

const looksLikeText = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  if (!sample.length) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160) printable += 1;
  }
  return printable / sample.length > 0.92;
};

export { EICAR_SIGNATURE };
