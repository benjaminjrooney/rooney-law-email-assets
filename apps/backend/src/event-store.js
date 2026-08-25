import { appendFile } from 'node:fs/promises';

/**
 * Tracking events received from Lob webhooks.
 *
 * Lob is the system of record for letters and their full tracking history —
 * this store exists so the task pane can show the latest status without a
 * per-letter API call, and so there is a local trail of what happened.
 *
 * Memory is bounded and lost on restart. Set EVENT_LOG_PATH (to a file on a
 * Railway volume) for a durable append-only copy.
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
