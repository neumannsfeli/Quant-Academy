/**
 * Tech spec §11 — server-side analytics events. Option A writes to Postgres;
 * Option B swaps in a Firehose sink behind the same interface.
 */
import { getDb, schema as s } from "@qa/db";

export interface EventSink {
  emit(name: string, userId: string | null, props?: Record<string, unknown>): Promise<void>;
}

export class PostgresEventSink implements EventSink {
  async emit(name: string, userId: string | null, props: Record<string, unknown> = {}) {
    try {
      await getDb().insert(s.events).values({ name, userId, props });
    } catch (e) {
      // Analytics must never break the request path.
      console.error("event emit failed", name, (e as Error).message);
    }
  }
}

let sink: EventSink = new PostgresEventSink();
export const events = {
  emit: (name: string, userId: string | null, props?: Record<string, unknown>) => sink.emit(name, userId, props),
  use(next: EventSink) {
    sink = next;
  },
};
