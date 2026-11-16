// PostgreSQL deposu (XRE ofis, 14 Kasım 2026).
// DATABASE_URL "postgres://" ya da "postgresql://" ile başlıyorsa kullanılır (createStore).
// Davranış dosya deposuyla (FileStore/MemoryStore) aynıdır: listeler en yeniden eskiye, olay kimlikleri sayı.
// İlk açılışta tablolar boşsa ve XRE_IMPORT_FROM_FILE bir JSON veri dosyasını gösteriyorsa o dosya içeri
// aktarılır; dosya silinmez (geri dönüş yolu).
import pg from "pg";
import fs from "node:fs/promises";
import type { StoredEvent, StoredRecord, UserIdentity } from "./types.js";
import { assertDump, DatabaseUnavailableError, type Store, type StoreDump } from "./db.js";
// Canlı bildirim: diğer depolar gibi her yazmada açık ekranlara "değişti" sinyali gider.
import { emitStoreChange } from "./live.js";

const { Pool } = pg;
type PgPool = InstanceType<typeof Pool>;
type PgClient = pg.PoolClient;

const SCHEMA_VERSION = "1";

function configuredOwner(): string | undefined {
  return process.env.XRE_OWNER_OPEN_ID?.trim() || process.env.MANUS_OWNER_OPEN_ID?.trim();
}

/** JSONB, metin içinde \u0000 karakterini kabul etmez; güvenle çıkarılır. */
function toJson(value: unknown): string {
  return JSON.stringify(value ?? {}).replace(/\\u0000/g, "");
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : undefined);

function rowRecord<T>(row: any): StoredRecord<T> {
  return {
    kind: String(row.kind),
    id: String(row.id),
    payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as T,
    ownerOpenId: String(row.owner_open_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowEvent(row: any): StoredEvent {
  return {
    id: String(row.id),
    eventKey: String(row.event_key),
    ownerOpenId: String(row.owner_open_id),
    status: row.status,
    attempts: Number(row.attempts || 0),
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    lastError: row.last_error ?? null,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PgStore implements Store {
  private pool: PgPool | null = null;
  private initialized: Promise<void> | null = null;

  constructor(private readonly dsn = process.env.DATABASE_URL || "") {}

  private getPool(): PgPool {
    if (this.pool) return this.pool;
    if (!this.dsn) throw new DatabaseUnavailableError();
    this.pool = new Pool({
      connectionString: this.dsn,
      max: Number(process.env.DB_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "xrecrm",
    });
    // Boşta bağlantı hatası süreci düşürmesin; bir sonraki sorgu yeni bağlantı açar.
    this.pool.on("error", (error) => console.error("PostgreSQL bağlantı hatası:", error.message));
    return this.pool;
  }

  async init(): Promise<void> {
    if (!this.initialized)
      this.initialized = this.setup().catch((error) => {
        this.initialized = null;
        throw error;
      });
    return this.initialized;
  }

  private async setup(): Promise<void> {
    const pool = this.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xre_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS xre_records (
        owner_open_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_open_id, kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_xre_records_owner_kind_created
        ON xre_records (owner_open_id, kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_xre_records_users
        ON xre_records (created_at) WHERE kind = 'user';
      CREATE TABLE IF NOT EXISTS xre_events (
        id BIGSERIAL PRIMARY KEY,
        owner_open_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NULL,
        last_error TEXT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_xre_events_owner_key UNIQUE (owner_open_id, event_key)
      );
      CREATE INDEX IF NOT EXISTS idx_xre_events_due
        ON xre_events (status, next_attempt_at) WHERE status IN ('pending', 'failed', 'received', 'processing');
      CREATE INDEX IF NOT EXISTS idx_xre_events_owner_created
        ON xre_events (owner_open_id, created_at DESC);
      INSERT INTO xre_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
        ON CONFLICT (key) DO NOTHING;
    `);
    await this.importFileIfEmpty();
  }

  /** Tablolar boşsa eski JSON veri dosyasını aktarır (XRE_IMPORT_FROM_FILE). */
  private async importFileIfEmpty(): Promise<void> {
    const file = process.env.XRE_IMPORT_FROM_FILE?.trim();
    if (!file) return;
    const pool = this.getPool();
    const { rows } = await pool.query("SELECT (SELECT count(*) FROM xre_records) + (SELECT count(*) FROM xre_events) AS n");
    if (Number(rows[0]?.n) > 0) return;
    let data: any;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(`Aktarılacak veri dosyası yok (${file}); boş veritabanıyla başlanıyor.`);
        return;
      }
      throw error;
    }
    const dump: StoreDump = {
      format: "xrecrm-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      records: data.records || [],
      events: data.events || [],
    };
    const started = Date.now();
    await this.restoreRows(dump);
    console.log(
      `Veri dosyası PostgreSQL'e aktarıldı: ${dump.records.length} kayıt, ${dump.events.length} olay (${Date.now() - started} ms). Dosya yerinde bırakıldı: ${file}`,
    );
  }

  async readiness(): Promise<{ database: boolean }> {
    try {
      await this.getPool().query("SELECT 1");
      return { database: true };
    } catch {
      return { database: false };
    }
  }

  private async ready(): Promise<PgPool> {
    await this.init();
    return this.getPool();
  }

  async resolveOwner(): Promise<string | undefined> {
    const configured = configuredOwner();
    if (configured) return configured;
    const pool = await this.ready();
    const { rows } = await pool.query(
      "SELECT id FROM xre_records WHERE kind = 'user' ORDER BY created_at ASC LIMIT 1",
    );
    return rows[0]?.id ? String(rows[0].id) : undefined;
  }

  async claimOwner(user: UserIdentity): Promise<{ ownerOpenId: string; isOwner: boolean }> {
    const configured = configuredOwner();
    if (configured) {
      await this.put("user", user.openId, { ...user, isOwner: user.openId === configured }, configured);
      return { ownerOpenId: configured, isOwner: user.openId === configured };
    }
    const pool = await this.ready();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // İlk kullanıcı sahiplenmesi birden çok süreçte de tek olsun.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('xrecrm-owner-claim'))");
      const { rows } = await client.query(
        "SELECT id FROM xre_records WHERE kind = 'user' ORDER BY created_at ASC LIMIT 1",
      );
      const ownerOpenId = rows[0]?.id ? String(rows[0].id) : user.openId;
      await client.query(
        `INSERT INTO xre_records (owner_open_id, kind, id, payload) VALUES ($1, 'user', $2, $3::jsonb)
         ON CONFLICT (owner_open_id, kind, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [ownerOpenId, user.openId, toJson({ ...user, isOwner: user.openId === ownerOpenId })],
      );
      await client.query("COMMIT");
      return { ownerOpenId, isOwner: user.openId === ownerOpenId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list<T = unknown>(kind: string, ownerOpenId: string): Promise<StoredRecord<T>[]> {
    const pool = await this.ready();
    const { rows } = await pool.query(
      "SELECT * FROM xre_records WHERE owner_open_id = $1 AND kind = $2 ORDER BY created_at DESC",
      [ownerOpenId, kind],
    );
    return rows.map((row) => rowRecord<T>(row));
  }

  async get<T = unknown>(kind: string, id: string, ownerOpenId: string): Promise<StoredRecord<T> | null> {
    const pool = await this.ready();
    const { rows } = await pool.query(
      "SELECT * FROM xre_records WHERE owner_open_id = $1 AND kind = $2 AND id = $3 LIMIT 1",
      [ownerOpenId, kind, id],
    );
    return rows[0] ? rowRecord<T>(rows[0]) : null;
  }

  async put<T = unknown>(kind: string, id: string, payload: T, ownerOpenId: string): Promise<StoredRecord<T>> {
    const pool = await this.ready();
    const { rows } = await pool.query(
      `INSERT INTO xre_records (owner_open_id, kind, id, payload) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (owner_open_id, kind, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
       RETURNING *`,
      [ownerOpenId, kind, id, toJson(payload)],
    );
    if (!rows[0]) throw new Error("Kayıt yazıldıktan sonra okunamadı.");
    emitStoreChange(ownerOpenId, kind);
    return rowRecord<T>(rows[0]);
  }

  async insertIfAbsent<T = unknown>(kind: string, id: string, payload: T, ownerOpenId: string) {
    const pool = await this.ready();
    const { rows } = await pool.query(
      `INSERT INTO xre_records (owner_open_id, kind, id, payload) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (owner_open_id, kind, id) DO NOTHING RETURNING *`,
      [ownerOpenId, kind, id, toJson(payload)],
    );
    if (rows[0]) emitStoreChange(ownerOpenId, kind);
    return rows[0] ? { inserted: true, record: rowRecord<T>(rows[0]) } : { inserted: false, record: null };
  }

  async delete(kind: string, id: string, ownerOpenId: string): Promise<void> {
    const pool = await this.ready();
    await pool.query("DELETE FROM xre_records WHERE owner_open_id = $1 AND kind = $2 AND id = $3", [
      ownerOpenId,
      kind,
      id,
    ]);
    emitStoreChange(ownerOpenId, kind);
  }

  async appendEvent(
    ownerOpenId: string,
    eventKey: string,
    payload: Record<string, unknown>,
    status: StoredEvent["status"] = "pending",
    scheduledAt?: string | null,
  ) {
    const pool = await this.ready();
    const inserted = await pool.query(
      `INSERT INTO xre_events (owner_open_id, event_key, status, payload, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, CASE WHEN $3 = 'pending' THEN COALESCE($5::timestamptz, now()) ELSE NULL END)
       ON CONFLICT (owner_open_id, event_key) DO NOTHING RETURNING *`,
      [ownerOpenId, eventKey, status, toJson(payload), scheduledAt ? new Date(scheduledAt) : null],
    );
    if (inserted.rows[0]) {
      emitStoreChange(ownerOpenId, "event");
      return { inserted: true, event: rowEvent(inserted.rows[0]) };
    }
    const { rows } = await pool.query(
      "SELECT * FROM xre_events WHERE owner_open_id = $1 AND event_key = $2 LIMIT 1",
      [ownerOpenId, eventKey],
    );
    if (!rows[0]) throw new Error("Olay kaydı okunamadı.");
    return { inserted: false, event: rowEvent(rows[0]) };
  }

  async getEvent(id: string, ownerOpenId: string): Promise<StoredEvent | null> {
    if (!/^\d+$/.test(String(id))) return null;
    const pool = await this.ready();
    const { rows } = await pool.query("SELECT * FROM xre_events WHERE owner_open_id = $1 AND id = $2 LIMIT 1", [
      ownerOpenId,
      id,
    ]);
    return rows[0] ? rowEvent(rows[0]) : null;
  }

  async listEvents(ownerOpenId: string): Promise<StoredEvent[]> {
    const pool = await this.ready();
    const { rows } = await pool.query(
      "SELECT * FROM xre_events WHERE owner_open_id = $1 ORDER BY created_at DESC, id DESC",
      [ownerOpenId],
    );
    return rows.map(rowEvent);
  }

  async updateEvent(
    id: string,
    ownerOpenId: string,
    patch: Partial<Pick<StoredEvent, "status" | "attempts" | "nextAttemptAt" | "lastError" | "payload">>,
  ): Promise<StoredEvent | null> {
    if (!/^\d+$/.test(String(id))) return null;
    const pool = await this.ready();
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      sets.push(`${sql} = $${values.length}`);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.attempts !== undefined) add("attempts", patch.attempts);
    if (patch.nextAttemptAt !== undefined) add("next_attempt_at", patch.nextAttemptAt ? new Date(patch.nextAttemptAt) : null);
    if (patch.lastError !== undefined) add("last_error", patch.lastError);
    if (patch.payload !== undefined) {
      values.push(toJson(patch.payload));
      sets.push(`payload = $${values.length}::jsonb`);
    }
    if (sets.length) {
      values.push(ownerOpenId, id);
      await pool.query(
        `UPDATE xre_events SET ${sets.join(", ")}, updated_at = now() WHERE owner_open_id = $${values.length - 1} AND id = $${values.length}`,
        values,
      );
    }
    return this.getEvent(id, ownerOpenId);
  }

  async claimDueEvents(limit = 10): Promise<StoredEvent[]> {
    const pool = await this.ready();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE xre_events SET status = 'failed', next_attempt_at = now(), last_error = 'Yarım kalan gelen webhook yeniden işlenecek.' WHERE status = 'received' AND updated_at < now() - interval '10 minutes'",
      );
      await client.query(
        "UPDATE xre_events SET status = 'needs_review', attempts = 5, next_attempt_at = NULL, last_error = 'İşlem süresi aşıldı veya çalışan kesildi; çift gönderimi önlemek için insan incelemesi gerekli.', updated_at = now() WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'",
      );
      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
      const { rows } = await client.query(
        `UPDATE xre_events SET status = 'processing', attempts = attempts + 1, updated_at = now()
         WHERE id IN (
           SELECT id FROM xre_events
           WHERE status IN ('pending', 'failed') AND attempts < 5
             AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           ORDER BY created_at ASC, id ASC
           LIMIT ${safeLimit}
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
      );
      await client.query("COMMIT");
      return rows
        .map(rowEvent)
        .sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "") || Number(a.id) - Number(b.id));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async dumpAll(): Promise<StoreDump> {
    const pool = await this.ready();
    const records = await pool.query("SELECT * FROM xre_records ORDER BY created_at ASC");
    const events = await pool.query("SELECT * FROM xre_events ORDER BY id ASC");
    return {
      format: "xrecrm-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      records: records.rows.map((row) => rowRecord(row)),
      events: events.rows.map(rowEvent),
    };
  }

  async restoreAll(dump: StoreDump): Promise<void> {
    assertDump(dump);
    await this.ready();
    await this.restoreRows(dump);
  }

  /** Tüm veriyi tek işlemde (transaction) değiştirir; toplu ekleme ile hızlıdır. */
  private async restoreRows(dump: StoreDump): Promise<void> {
    const client: PgClient = await this.getPool().connect();
    const ts = (v?: string | null) => (v ? new Date(v) : new Date());
    try {
      await client.query("BEGIN");
      await client.query("TRUNCATE xre_events, xre_records");
      const CHUNK = 500;
      for (let i = 0; i < dump.records.length; i += CHUNK) {
        const part = dump.records.slice(i, i + CHUNK);
        await client.query(
          `INSERT INTO xre_records (owner_open_id, kind, id, payload, created_at, updated_at)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::jsonb[], $5::timestamptz[], $6::timestamptz[])
           ON CONFLICT (owner_open_id, kind, id) DO UPDATE SET payload = EXCLUDED.payload`,
          [
            part.map((r) => r.ownerOpenId),
            part.map((r) => r.kind),
            part.map((r) => r.id),
            part.map((r) => toJson(r.payload)),
            part.map((r) => ts(r.createdAt)),
            part.map((r) => ts(r.updatedAt || r.createdAt)),
          ],
        );
      }
      for (let i = 0; i < dump.events.length; i += CHUNK) {
        const part = dump.events.slice(i, i + CHUNK);
        await client.query(
          `INSERT INTO xre_events (id, owner_open_id, event_key, status, attempts, next_attempt_at, last_error, payload, created_at, updated_at)
           SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::int[], $6::timestamptz[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::timestamptz[])
           ON CONFLICT DO NOTHING`,
          [
            part.map((e) => Number(e.id)),
            part.map((e) => e.ownerOpenId),
            part.map((e) => e.eventKey),
            part.map((e) => e.status),
            part.map((e) => Number(e.attempts || 0)),
            part.map((e) => (e.nextAttemptAt ? new Date(e.nextAttemptAt) : null)),
            part.map((e) => e.lastError ?? null),
            part.map((e) => toJson(e.payload)),
            part.map((e) => ts(e.createdAt)),
            part.map((e) => ts(e.updatedAt || e.createdAt)),
          ],
        );
      }
      await client.query(
        "SELECT setval(pg_get_serial_sequence('xre_events', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM xre_events), 1), (SELECT count(*) > 0 FROM xre_events))",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
    this.initialized = null;
  }
}
