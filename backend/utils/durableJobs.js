// PostgreSQL-backed queue. Keep this module identical in SUJAM and the panel.
const { randomUUID, createHash, createHmac } = require('crypto');

const DDL = `CREATE TABLE IF NOT EXISTS provision_jobs (
 id TEXT PRIMARY KEY, resource TEXT NOT NULL UNIQUE, request_key TEXT UNIQUE,
 request_hash TEXT NOT NULL, payload JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 stage TEXT NOT NULL DEFAULT 'pendiente', steps JSONB NOT NULL DEFAULT '{}', result JSONB,
 attempts INTEGER NOT NULL DEFAULT 0, next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 owner TEXT, lease_until TIMESTAMPTZ, error_code TEXT, error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
); CREATE INDEX IF NOT EXISTS provision_jobs_due ON provision_jobs(state, next_run_at);`;

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
}
function fingerprint(value, secret) {
    const data = JSON.stringify(canonical(value));
    return secret ? createHmac('sha256', secret).update(data).digest('hex') : createHash('sha256').update(data).digest('hex');
}
function fault(message, code = 'ERROR_INTERVENCION', retryMs = null) {
    return Object.assign(new Error(message), { code, retryMs });
}
function safeJob(job) {
    if (!job) return null;
    const { id, resource, state, stage, steps, result, attempts, next_run_at, error_code, error_message, created_at, updated_at } = job;
    return { id, resource, state, stage, steps, result, attempts, proximoIntento: next_run_at, codigo: error_code, mensaje: error_message, createdAt: created_at, updatedAt: updated_at };
}

function createQueue(db, { leaseMs = 120000 } = {}) {
    const query = (sql, params = []) => db.query(sql, params);
    const get = async id => (await query('SELECT * FROM provision_jobs WHERE id=$1', [id])).rows[0];
    const byResource = async resource => (await query('SELECT * FROM provision_jobs WHERE resource=$1', [resource])).rows[0];
    const byKey = async key => key ? (await query('SELECT * FROM provision_jobs WHERE request_key=$1', [key])).rows[0] : null;
    async function enqueue({ id = randomUUID(), resource, requestKey, requestHash, payload }) {
        const existing = await byKey(requestKey) || await byResource(resource);
        if (existing) {
            if (existing.request_hash !== requestHash) throw fault('La solicitud ya existe con datos diferentes', 'IDEMPOTENCY_CONFLICT');
            return { job: existing, created: false };
        }
        const { rows } = await query(`INSERT INTO provision_jobs(id,resource,request_key,request_hash,payload)
            VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING *`, [id, resource, requestKey || null, requestHash, JSON.stringify(payload)]);
        if (!rows.length) return enqueue({ id, resource, requestKey, requestHash, payload });
        return { job: rows[0], created: true };
    }
    async function resume(id) {
        return (await query(`UPDATE provision_jobs SET state='pending', next_run_at=now(), error_code=NULL,
            error_message=NULL, updated_at=now() WHERE id=$1 AND state IN ('blocked','waiting','done','pending') RETURNING *`, [id])).rows[0] || get(id);
    }
    async function claim() {
        const owner = randomUUID();
        return (await query(`UPDATE provision_jobs SET state='running',owner=$1,
            lease_until=now()+($2 * interval '1 millisecond'), attempts=attempts+1,updated_at=now()
            WHERE id=(SELECT id FROM provision_jobs WHERE (state IN ('pending','waiting') AND next_run_at<=now())
            OR (state='running' AND lease_until<now()) ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [owner, leaseMs])).rows[0];
    }
    async function tick(handler) {
        const job = await claim();
        if (!job) return false;
        let lost = false;
        const heartbeat = setInterval(() => query(`UPDATE provision_jobs SET lease_until=now()+($3 * interval '1 millisecond')
            WHERE id=$1 AND owner=$2 AND state='running' RETURNING id`, [job.id, job.owner, leaseMs])
            .then(r => { if (!r.rows.length) lost = true; }).catch(() => { lost = true; }), Math.max(100, leaseMs / 3));
        heartbeat.unref?.();
        const checkpoint = async (stage, detail = {}, state = 'done') => {
            if (lost) throw fault('Se perdió la propiedad del trabajo', 'LEASE_LOST', 10000);
            const r = await query(`UPDATE provision_jobs SET stage=$3,steps=steps || jsonb_build_object($3::text,$4::jsonb),
                updated_at=now() WHERE id=$1 AND owner=$2 AND state='running' RETURNING id`,
            [job.id, job.owner, stage, JSON.stringify({ estado: state, ...detail, fecha: new Date().toISOString() })]);
            if (!r.rows.length) throw fault('Se perdió la propiedad del trabajo', 'LEASE_LOST', 10000);
        };
        try {
            const result = await handler(job, checkpoint);
            await query(`UPDATE provision_jobs SET state='done',stage='listo',result=$3::jsonb,payload=payload - 'adminPasswordHash',
                owner=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=now()
                WHERE id=$1 AND owner=$2`, [job.id, job.owner, JSON.stringify(result || {})]);
        } catch (error) {
            const retryMs = error.retryMs !== undefined ? error.retryMs : (job.attempts < 8 ? Math.min(300000, 5000 * 2 ** job.attempts) : null);
            // Store controlled messages only; provider/SQL errors may contain secrets.
            const message = error.code && error.retryMs !== undefined ? error.message : 'La operación no pudo completarse; reintente o consulte soporte con el identificador del trabajo.';
            await query(`UPDATE provision_jobs SET state=$3, next_run_at=now()+($4 * interval '1 millisecond'),
                error_code=$5,error_message=$6,owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND owner=$2`,
            [job.id, job.owner, retryMs === null ? 'blocked' : 'waiting', retryMs || 0, error.code || 'ERROR_REINTENTABLE', message]);
        } finally { clearInterval(heartbeat); }
        return true;
    }
    function start(handler, { intervalMs = 3000, enabled = () => true } = {}) {
        let busy = false;
        const run = async () => {
            if (busy || !enabled()) return;
            busy = true;
            try { await tick(handler); } catch { console.error('[provision-worker] No se pudo consultar la cola'); }
            finally { busy = false; }
        };
        const timer = setInterval(run, intervalMs);
        timer.unref?.();
        run();
        return timer;
    }
    return { enqueue, get, byKey, byResource, resume, tick, start };
}
module.exports = { DDL, createQueue, safeJob, fingerprint, fault };
