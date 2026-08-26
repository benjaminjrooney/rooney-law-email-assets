import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Tracking events received from Lob webhooks.
 *
 * Lob is the system of record for letters and their full tracking history —
 * this store exists so the task pane can show the latest status without a
 * per-letter API call, and so there is a local trail of what happened.
 *
 * Memory is bounded. Set EVENT_LOG_PATH (to a file on a Railway volume) and the
 * store both appends every event there and reads the tail of it back at startup,
 * so a deploy or a crash does not empty the "Recent mail" panel.
 */

/** Friendly labels for the Lob event types this add-in can produce. */
const EVENT_LABELS = {
  'letter.created': 'Created',
  'letter.rendered_pdf': 'Proof ready',
  'letter.rendered_thumbnails': 'Proof ready',
  'letter.deleted': 'Canceled',
  'letter.mailed': 'Handed to USPS',
  'letter.in_transit': 'In transit',
  'letter.in_local_area': 'In the local area',
  'letter.processed_for_delivery': 'Out for delivery',
  'letter.re-routed': 'Re-routed',
  'letter.returned_to_sender': 'Returned to sender',
  'letter.delivered': 'Delivered',
  'letter.certified.mailed': 'Certified: handed to USPS',
  'letter.certified.in_transit': 'Certified: in transit',
  'letter.certified.in_local_area': 'Certified: in the local area',
  'letter.certified.processed_for_delivery': 'Certified: out for delivery',
  'letter.certified.pickup_available': 'Certified: available for pickup',
  'letter.certified.re-routed': 'Certified: re-routed',
  'letter.certified.returned_to_sender': 'Certified: returned to sender',
  'letter.certified.delivered': 'Certified: delivered',
  'letter.certified.issue': 'Certified: delivery issue',
};

/** Events worth pulling out of the noise when the firm reviews recent mail. */
const NOTABLE = new Set([
  'letter.delivered',
  'letter.certified.delivered',
  'letter.returned_to_sender',
  'letter.certified.returned_to_sender',
  'letter.certified.issue',
  'letter.certified.pickup_available',
  'letter.deleted',
]);

/**
 * How much of the log to read back at startup. Events are a few hundred bytes,
 * so this comfortably covers any sane EVENT_MAX_RETAINED while keeping boot
 * bounded on a log that has been appended to for years.
 */
const RESTORE_TAIL_BYTES = 4 * 1024 * 1024;

export function describeEventType(eventType) {
  return EVENT_LABELS[eventType] ?? eventType ?? 'Unknown event';
}

/** Normalize a raw Lob event into the shape the add-in reads. */
export function normalizeEvent(raw) {
  const eventType = typeof raw?.event_type === 'string' ? raw.event_type : raw?.event_type?.id ?? null;
  const body = raw?.body ?? {};
  return {
    id: raw?.id ?? null,
    eventType,
    label: describeEventType(eventType),
    notable: NOTABLE.has(eventType),
    letterId: raw?.reference_id ?? body.id ?? null,
    trackingNumber: body.tracking_number ?? null,
    recipient: body.to?.name ?? body.to?.company ?? null,
    dateCreated: raw?.date_created ?? new Date().toISOString(),
  };
}

export class EventStore {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEvents] ring-buffer size
   * @param {string} [options.logPath] append each event here as JSON lines
   * @param {(line: string) => void} [options.onError] reporter for log failures
   */
  constructor({ maxEvents = 500, logPath = '', onError } = {}) {
    this.maxEvents = maxEvents;
    this.logPath = logPath;
    this.onError = onError ?? (() => {});
    /** @type {object[]} newest last */
    this.events = [];
    /** @type {Map<string, object>} letter id → most recent event */
    this.latest = new Map();
  }

  /**
   * Reload recent events from the log so a restart does not start blank.
   *
   * Only the tail of the file is read: the log is append-only and never
   * rotated, so after a year of mail it is far larger than the ring buffer it
   * feeds. Reading the last slice bounds both memory and boot time regardless
   * of how big the file has grown.
   *
   * A missing file, an unreadable volume, or a half-written final line are all
   * normal rather than fatal — the service must still come up and accept mail.
   *
   * @returns {Promise<{restored: number, skipped: number}>}
   */
  async restore() {
    if (!this.logPath) return { restored: 0, skipped: 0 };

    // The volume is mounted empty on first deploy, so the directory holding the
    // log may not exist yet; without this the first append would fail too.
    await mkdir(dirname(this.logPath), { recursive: true }).catch(() => {});

    let handle;
    try {
      handle = await open(this.logPath, 'r');
    } catch (error) {
      // Nothing recorded yet is the expected state on a fresh volume.
      if (error.code !== 'ENOENT') {
        this.onError(`Could not read EVENT_LOG_PATH: ${error.message}`);
      }
      return { restored: 0, skipped: 0 };
    }

    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - RESTORE_TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);

      let text = buffer.toString('utf8');
      if (start > 0) {
        // Reading from a byte offset almost certainly lands mid-line; that
        // fragment is not a record, so drop everything before the first break.
        const newline = text.indexOf('\n');
        text = newline === -1 ? '' : text.slice(newline + 1);
      }

      const lines = text.split('\n').filter((line) => line.trim() !== '');
      let skipped = 0;
      for (const line of lines.slice(-this.maxEvents)) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          // A crash mid-append leaves a truncated last line. One unreadable
          // record is not a reason to discard the rest of the history.
          skipped += 1;
          continue;
        }
        if (!event || typeof event !== 'object' || !event.eventType) {
          skipped += 1;
          continue;
        }
        this.events.push(event);
        if (event.letterId) this.latest.set(event.letterId, event);
      }

      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(-this.maxEvents);
      }
      if (skipped > 0) {
        this.onError(`Skipped ${skipped} unreadable line(s) in EVENT_LOG_PATH.`);
      }
      return { restored: this.events.length, skipped };
    } catch (error) {
      this.onError(`Could not restore from EVENT_LOG_PATH: ${error.message}`);
      return { restored: 0, skipped: 0 };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async record(rawEvent) {
    const event = normalizeEvent(rawEvent);
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    if (event.letterId) this.latest.set(event.letterId, event);

    if (this.logPath) {
      try {
        await appendFile(this.logPath, `${JSON.stringify(event)}\n`);
      } catch (error) {
        // A full or read-only disk must never turn into a failed webhook —
        // Lob would retry it, and the in-memory copy is already recorded.
        this.onError(`Could not append to EVENT_LOG_PATH: ${error.message}`);
      }
    }
    return event;
  }

  latestFor(letterId) {
    return this.latest.get(letterId) ?? null;
  }

  recent(limit = 50) {
    return this.events.slice(-limit).reverse();
  }
}
