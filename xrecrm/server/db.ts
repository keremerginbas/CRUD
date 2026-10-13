import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { StoredEvent, StoredRecord, UserIdentity } from "./types.js";

export interface Store {
  init(): Promise<void>;
  readiness(): Promise<{ database: boolean }>;
  resolveOwner(): Promise<string | undefined>;
  claimOwner(
    user: UserIdentity,
  ): Promise<{ ownerOpenId: string; isOwner: boolean }>;
  list<T = unknown>(
    kind: string,
    ownerOpenId: string,
  ): Promise<StoredRecord<T>[]>;
  get<T = unknown>(
    kind: string,
    id: string,
    ownerOpenId: string,
  ): Promise<StoredRecord<T> | null>;
  put<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ): Promise<StoredRecord<T>>;
  insertIfAbsent<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ): Promise<{ inserted: boolean; record: StoredRecord<T> | null }>;
  delete(kind: string, id: string, ownerOpenId: string): Promise<void>;
  appendEvent(
    ownerOpenId: string,
    eventKey: string,
    payload: Record<string, unknown>,
    status?: StoredEvent["status"],
    scheduledAt?: string | null,
  ): Promise<{ inserted: boolean; event: StoredEvent }>;
  getEvent(id: string, ownerOpenId: string): Promise<StoredEvent | null>;
  listEvents(ownerOpenId: string): Promise<StoredEvent[]>;
  updateEvent(
    id: string,
    ownerOpenId: string,
    patch: Partial<
      Pick<
        StoredEvent,
        "status" | "attempts" | "nextAttemptAt" | "lastError" | "payload"
      >
    >,
  ): Promise<StoredEvent | null>;
  claimDueEvents(limit?: number): Promise<StoredEvent[]>;
}

export class DatabaseUnavailableError extends Error {
  statusCode = 503;
  constructor(
    message = "Kalıcı veritabanı yapılandırılmamış veya erişilemiyor.",
  ) {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

function configuredOwner(): string | undefined {
  return (
    process.env.XRE_OWNER_OPEN_ID?.trim() ||
    process.env.MANUS_OWNER_OPEN_ID?.trim()
  );
}

function decodeJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return (value ?? {}) as T;
}

function rowRecord<T>(row: any): StoredRecord<T> {
  return {
    kind: String(row.kind),
    id: String(row.id),
    payload: decodeJson<T>(row.payload),
    ownerOpenId: String(row.owner_open_id),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : undefined,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : undefined,
  };
}

function rowEvent(row: any): StoredEvent {
  return {
    id: String(row.id),
    eventKey: String(row.event_key),
    ownerOpenId: String(row.owner_open_id),
    status: row.status,
    attempts: Number(row.attempts || 0),
    nextAttemptAt: row.next_attempt_at
      ? new Date(row.next_attempt_at).toISOString()
      : null,
    lastError: row.last_error ?? null,
    payload: decodeJson<Record<string, unknown>>(row.payload),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : undefined,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : undefined,
  };
}

export class MysqlStore implements Store {
  private pool: Pool | null = null;
  private initialized = false;

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const dsn = process.env.DATABASE_URL;
    if (!dsn) throw new DatabaseUnavailableError();
    this.pool = mysql.createPool({
      uri: dsn,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
      charset: "utf8mb4",
      timezone: "Z",
      enableKeepAlive: true,
    });
    return this.pool;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const pool = this.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xre_records (
        owner_open_id VARCHAR(191) NOT NULL,
        kind VARCHAR(64) NOT NULL,
        id VARCHAR(191) NOT NULL,
        payload JSON NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (owner_open_id, kind, id),
        KEY idx_xre_records_kind_owner (kind, owner_open_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xre_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        owner_open_id VARCHAR(191) NOT NULL,
        event_key VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMP(3) NULL,
        last_error VARCHAR(1000) NULL,
        payload JSON NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_xre_events_owner_key (owner_open_id, event_key),
        KEY idx_xre_events_owner_status (owner_open_id, status, next_attempt_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    this.initialized = true;
  }

  async readiness(): Promise<{ database: boolean }> {
    try {
      await this.getPool().query("SELECT 1");
      return { database: true };
    } catch {
      return { database: false };
    }
  }

  private async ready(): Promise<Pool> {
    await this.init();
    return this.getPool();
  }

  async resolveOwner(): Promise<string | undefined> {
    const configured = configuredOwner();
    if (configured) return configured;
    const pool = await this.ready();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM xre_records WHERE kind = 'user' ORDER BY created_at ASC LIMIT 1",
    );
    return rows[0]?.id ? String(rows[0].id) : undefined;
  }

  async claimOwner(
    user: UserIdentity,
  ): Promise<{ ownerOpenId: string; isOwner: boolean }> {
    const configured = configuredOwner();
    if (configured) {
      await this.put(
        "user",
        user.openId,
        { ...user, isOwner: user.openId === configured },
        configured,
      );
      return { ownerOpenId: configured, isOwner: user.openId === configured };
    }
    const pool = await this.ready();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // GET_LOCK is connection-scoped and makes the first-user claim atomic across app workers.
      await conn.query("SELECT GET_LOCK(?, 10)", ["xrecrm-owner-claim"]);
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM xre_records WHERE kind = 'user' ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
      );
      const ownerOpenId = rows[0]?.id ? String(rows[0].id) : user.openId;
      await conn.execute(
        `INSERT INTO xre_records (owner_open_id, kind, id, payload) VALUES (?, 'user', ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
        [
          ownerOpenId,
          user.openId,
          JSON.stringify({ ...user, isOwner: user.openId === ownerOpenId }),
        ],
      );
      await conn.query("SELECT RELEASE_LOCK(?)", ["xrecrm-owner-claim"]);
      await conn.commit();
      return { ownerOpenId, isOwner: user.openId === ownerOpenId };
    } catch (error) {
      await conn.rollback();
      try {
        await conn.query("SELECT RELEASE_LOCK(?)", ["xrecrm-owner-claim"]);
      } catch {
        /* best effort */
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async list<T = unknown>(
    kind: string,
    ownerOpenId: string,
  ): Promise<StoredRecord<T>[]> {
    const pool = await this.ready();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM xre_records WHERE owner_open_id = ? AND kind = ? ORDER BY created_at ASC",
      [ownerOpenId, kind],
    );
    return rows.map(rowRecord<T>);
  }

  async get<T = unknown>(
    kind: string,
    id: string,
    ownerOpenId: string,
  ): Promise<StoredRecord<T> | null> {
    const pool = await this.ready();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM xre_records WHERE owner_open_id = ? AND kind = ? AND id = ? LIMIT 1",
      [ownerOpenId, kind, id],
    );
    return rows[0] ? rowRecord<T>(rows[0]) : null;
  }

  async put<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ): Promise<StoredRecord<T>> {
    const pool = await this.ready();
    await pool.execute(
      `INSERT INTO xre_records (owner_open_id, kind, id, payload) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP(3)`,
      [ownerOpenId, kind, id, JSON.stringify(payload)],
    );
    const value = await this.get<T>(kind, id, ownerOpenId);
    if (!value) throw new Error("Kayıt yazıldıktan sonra okunamadı.");
    return value;
  }

  async insertIfAbsent<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ) {
    const pool = await this.ready();
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT IGNORE INTO xre_records(owner_open_id,kind,id,payload) VALUES(?,?,?,?)",
      [ownerOpenId, kind, id, JSON.stringify(payload)],
    );
    const inserted = Number(result.affectedRows) > 0;
    return {
      inserted,
      record: inserted ? await this.get<T>(kind, id, ownerOpenId) : null,
    };
  }

  async delete(kind: string, id: string, ownerOpenId: string): Promise<void> {
    const pool = await this.ready();
    await pool.execute(
      "DELETE FROM xre_records WHERE owner_open_id = ? AND kind = ? AND id = ?",
      [ownerOpenId, kind, id],
    );
  }

  async appendEvent(
    ownerOpenId: string,
    eventKey: string,
    payload: Record<string, unknown>,
    status: StoredEvent["status"] = "pending",
    scheduledAt?: string | null,
  ) {
    const pool = await this.ready();
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO xre_events (owner_open_id, event_key, status, payload, next_attempt_at)
       VALUES (?, ?, ?, ?, CASE WHEN ? = 'pending' THEN COALESCE(?,CURRENT_TIMESTAMP(3)) ELSE NULL END)`,
      [
        ownerOpenId,
        eventKey,
        status,
        JSON.stringify(payload),
        status,
        scheduledAt ? new Date(scheduledAt) : null,
      ],
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM xre_events WHERE owner_open_id = ? AND event_key = ? LIMIT 1",
      [ownerOpenId, eventKey],
    );
    if (!rows[0]) throw new Error("Olay kaydı okunamadı.");
    const event = rowEvent(rows[0]);
    return {
      inserted: Number((insertResult as ResultSetHeader).affectedRows || 0) > 0,
      event,
    };
  }

  async getEvent(id: string, ownerOpenId: string): Promise<StoredEvent | null> {
    const pool = await this.ready();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM xre_events WHERE owner_open_id = ? AND id = ? LIMIT 1",
      [ownerOpenId, id],
    );
    return rows[0] ? rowEvent(rows[0]) : null;
  }

  async listEvents(ownerOpenId: string): Promise<StoredEvent[]> {
    const pool = await this.ready();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM xre_events WHERE owner_open_id = ? ORDER BY created_at DESC",
      [ownerOpenId],
    );
    return rows.map(rowEvent);
  }

  async updateEvent(
    id: string,
    ownerOpenId: string,
    patch: Partial<
      Pick<
        StoredEvent,
        "status" | "attempts" | "nextAttemptAt" | "lastError" | "payload"
      >
    >,
  ): Promise<StoredEvent | null> {
    const pool = await this.ready();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (patch.attempts !== undefined) {
      fields.push("attempts = ?");
      values.push(patch.attempts);
    }
    if (patch.nextAttemptAt !== undefined) {
      fields.push("next_attempt_at = ?");
      values.push(patch.nextAttemptAt ? new Date(patch.nextAttemptAt) : null);
    }
    if (patch.lastError !== undefined) {
      fields.push("last_error = ?");
      values.push(patch.lastError);
    }
    if (patch.payload !== undefined) {
      fields.push("payload = ?");
      values.push(JSON.stringify(patch.payload));
    }
    if (fields.length) {
      values.push(ownerOpenId, id);
      await pool.execute(
        `UPDATE xre_events SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP(3) WHERE owner_open_id = ? AND id = ?`,
        values as any[],
      );
    }
    return this.getEvent(id, ownerOpenId);
  }

  async claimDueEvents(limit = 10): Promise<StoredEvent[]> {
    const pool = await this.ready();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "UPDATE xre_events SET status='failed', next_attempt_at=UTC_TIMESTAMP(3), last_error='Yarım kalan gelen webhook yeniden işlenecek.' WHERE status='received' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)",
      );
      await conn.execute(
        "UPDATE xre_events SET status = 'needs_review', attempts = 5, next_attempt_at = NULL, last_error = 'İşlem süresi aşıldı veya çalışan kesildi; çift gönderimi önlemek için insan incelemesi gerekli.', updated_at = UTC_TIMESTAMP(3) WHERE status = 'processing' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)",
      );
      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM xre_events
         WHERE status IN ('pending', 'failed') AND attempts < 5
           AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP(3))
         ORDER BY created_at ASC LIMIT ${safeLimit} FOR UPDATE`,
      );
      const claimed: StoredEvent[] = [];
      for (const row of rows) {
        await conn.execute(
          "UPDATE xre_events SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status IN ('pending', 'failed')",
          [row.id],
        );
        claimed.push(
          rowEvent({
            ...row,
            status: "processing",
            attempts: Number(row.attempts || 0) + 1,
          }),
        );
      }
      await conn.commit();
      return claimed;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

export class MemoryStore implements Store {
  protected records = new Map<string, StoredRecord>();
  protected events = new Map<string, StoredEvent>();
  protected nextEventId = 1;
  async init() {
    /* Test-only store: deliberately not used by production. */
  }
  async readiness() {
    return { database: true };
  }
  async resolveOwner() {
    return (
      configuredOwner() ||
      [...this.records.values()].find((r) => r.kind === "user")?.id
    );
  }
  async claimOwner(user: UserIdentity) {
    const configured = configuredOwner();
    const existing = configured || (await this.resolveOwner());
    const ownerOpenId = existing || user.openId;
    const isOwner = user.openId === ownerOpenId;
    await this.put("user", user.openId, { ...user, isOwner }, ownerOpenId);
    return { ownerOpenId, isOwner };
  }
  private key(owner: string, kind: string, id: string) {
    return `${owner}\u0000${kind}\u0000${id}`;
  }
  async list<T = unknown>(kind: string, ownerOpenId: string) {
    return [...this.records.values()]
      .filter((r) => r.ownerOpenId === ownerOpenId && r.kind === kind)
      .sort(
        (a, b) =>
          Date.parse(String(b.createdAt || "")) -
          Date.parse(String(a.createdAt || "")),
      )
      .map((r) => structuredClone(r) as StoredRecord<T>);
  }
  async get<T = unknown>(kind: string, id: string, ownerOpenId: string) {
    const row = this.records.get(this.key(ownerOpenId, kind, id));
    return row ? (structuredClone(row) as StoredRecord<T>) : null;
  }
  async put<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ) {
    const now = new Date().toISOString();
    const old = this.records.get(this.key(ownerOpenId, kind, id));
    const row: StoredRecord<T> = {
      kind,
      id,
      payload: structuredClone(payload),
      ownerOpenId,
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    this.records.set(this.key(ownerOpenId, kind, id), row);
    return structuredClone(row);
  }
  async insertIfAbsent<T = unknown>(
    kind: string,
    id: string,
    payload: T,
    ownerOpenId: string,
  ) {
    if (this.records.has(this.key(ownerOpenId, kind, id)))
      return { inserted: false, record: null };
    return {
      inserted: true,
      record: await this.put(kind, id, payload, ownerOpenId),
    };
  }

  async delete(kind: string, id: string, ownerOpenId: string) {
    this.records.delete(this.key(ownerOpenId, kind, id));
  }
  async appendEvent(
    ownerOpenId: string,
    eventKey: string,
    payload: Record<string, unknown>,
    status: StoredEvent["status"] = "pending",
    scheduledAt?: string | null,
  ) {
    const old = [...this.events.values()].find(
      (e) => e.ownerOpenId === ownerOpenId && e.eventKey === eventKey,
    );
    if (old) return { inserted: false, event: structuredClone(old) };
    const event: StoredEvent = {
      id: String(this.nextEventId++),
      eventKey,
      ownerOpenId,
      status,
      attempts: 0,
      nextAttemptAt:
        status === "pending" ? scheduledAt || new Date().toISOString() : null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      payload: structuredClone(payload),
    };
    this.events.set(event.id, event);
    return { inserted: true, event: structuredClone(event) };
  }
  async getEvent(id: string, ownerOpenId: string) {
    const e = this.events.get(id);
    return e?.ownerOpenId === ownerOpenId ? structuredClone(e) : null;
  }
  async listEvents(ownerOpenId: string) {
    return [...this.events.values()]
      .filter((e) => e.ownerOpenId === ownerOpenId)
      .sort(
        (a, b) =>
          Date.parse(String(b.createdAt || "")) -
          Date.parse(String(a.createdAt || "")),
      )
      .map((e) => structuredClone(e));
  }
  async updateEvent(
    id: string,
    ownerOpenId: string,
    patch: Partial<
      Pick<
        StoredEvent,
        "status" | "attempts" | "nextAttemptAt" | "lastError" | "payload"
      >
    >,
  ) {
    const e = this.events.get(id);
    if (!e || e.ownerOpenId !== ownerOpenId) return null;
    Object.assign(e, structuredClone(patch));
    e.updatedAt = new Date().toISOString();
    return structuredClone(e);
  }
  async claimDueEvents(limit = 10) {
    const now = Date.now();
    const claimed: StoredEvent[] = [];
    for (const e of this.events.values()) {
      if (
        e.status === "received" &&
        e.updatedAt &&
        Date.parse(e.updatedAt) < now - 600_000
      ) {
        e.status = "failed";
        e.nextAttemptAt = new Date().toISOString();
        e.lastError = "Yarım kalan gelen webhook yeniden işlenecek.";
      }
      if (
        e.status === "processing" &&
        e.updatedAt &&
        Date.parse(e.updatedAt) < now - 600_000
      ) {
        e.status = "needs_review";
        e.attempts = 5;
        e.nextAttemptAt = null;
        e.lastError =
          "İşlem süresi aşıldı veya çalışan kesildi; çift gönderimi önlemek için insan incelemesi gerekli.";
        e.updatedAt = new Date().toISOString();
      }
      if (claimed.length >= limit) break;
      if (
        !["pending", "failed"].includes(e.status) ||
        e.attempts >= 5 ||
        (e.nextAttemptAt && Date.parse(e.nextAttemptAt) > now)
      )
        continue;
      e.status = "processing";
      e.attempts += 1;
      e.updatedAt = new Date().toISOString();
      claimed.push(structuredClone(e));
    }
    return claimed;
  }
}

/**
 * MySQL olmadan kalıcı çalışma: tüm kayıtlar tek JSON dosyasında tutulur.
 * Küçük ekipler ve tek sunucu için uygundur; yazımlar atomik (geçici dosya +
 * yeniden adlandırma) ve 250 ms toplu yapılır. Birden çok sunucu süreci için MySQL kullanın.
 */
export class FileStore extends MemoryStore {
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;
  constructor(private readonly file: string) {
    super();
  }
  async init() {
    if (this.loaded) return;
    this.loaded = true;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      for (const record of data.records || [])
        this.records.set(`${record.ownerOpenId}\u0000${record.kind}\u0000${record.id}`, record);
      for (const event of data.events || []) this.events.set(String(event.id), event);
      this.nextEventId = Number(data.nextEventId) || this.events.size + 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const flush = () => this.flushSync();
    process.once("exit", flush);
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        flush();
        process.exit(0);
      });
  }
  private snapshot() {
    return JSON.stringify({
      version: 1,
      nextEventId: this.nextEventId,
      records: [...this.records.values()],
      events: [...this.events.values()],
    });
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const tmp = `${this.file}.tmp`;
      fs.writeFile(tmp, this.snapshot())
        .then(() => fs.rename(tmp, this.file))
        .catch((error) => console.error("Yerel veritabanı yazılamadı:", error));
    }, 250);
  }
  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.loaded) return;
    const tmp = `${this.file}.tmp`;
    fsSync.writeFileSync(tmp, this.snapshot());
    fsSync.renameSync(tmp, this.file);
  }
  async put<T = unknown>(kind: string, id: string, payload: T, ownerOpenId: string) {
    const result = await super.put(kind, id, payload, ownerOpenId);
    this.schedule();
    return result;
  }
  async delete(kind: string, id: string, ownerOpenId: string) {
    await super.delete(kind, id, ownerOpenId);
    this.schedule();
  }
  async appendEvent(
    ownerOpenId: string,
    eventKey: string,
    payload: Record<string, unknown>,
    status?: StoredEvent["status"],
    scheduledAt?: string | null,
  ) {
    const result = await super.appendEvent(ownerOpenId, eventKey, payload, status, scheduledAt);
    if (result.inserted) this.schedule();
    return result;
  }
  async updateEvent(id: string, ownerOpenId: string, patch: Parameters<MemoryStore["updateEvent"]>[2]) {
    const result = await super.updateEvent(id, ownerOpenId, patch);
    this.schedule();
    return result;
  }
  async claimDueEvents(limit = 10) {
    const result = await super.claimDueEvents(limit);
    if (result.length) this.schedule();
    return result;
  }
}

export function createStore(): Store {
  if (process.env.DATABASE_URL?.trim()) return new MysqlStore();
  const file = path.resolve(
    process.env.XRE_DATA_DIR || "data",
    "xrecrm-data.json",
  );
  console.log(`DATABASE_URL yok; yerel dosya veritabanı kullanılıyor: ${file}`);
  return new FileStore(file);
}
export function createMemoryStore(): Store {
  return new MemoryStore();
}
