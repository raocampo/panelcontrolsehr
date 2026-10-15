ALTER TABLE "clientes" ADD COLUMN "adminUsuarioId" INTEGER,
 ADD COLUMN "adminEmail" VARCHAR(150), ADD COLUMN "adminNombre" VARCHAR(200),
 ADD COLUMN "accesoEstado" VARCHAR(40) NOT NULL DEFAULT 'pendiente',
 ADD COLUMN "disponibleDesde" TIMESTAMP(3), ADD COLUMN "ultimaVerificacionAt" TIMESTAMP(3);
CREATE TABLE provision_jobs (
 id TEXT PRIMARY KEY, resource TEXT NOT NULL UNIQUE, request_key TEXT UNIQUE,
 request_hash TEXT NOT NULL, payload JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 stage TEXT NOT NULL DEFAULT 'pendiente', steps JSONB NOT NULL DEFAULT '{}', result JSONB,
 attempts INTEGER NOT NULL DEFAULT 0, next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 owner TEXT, lease_until TIMESTAMPTZ, error_code TEXT, error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provision_jobs_due ON provision_jobs(state,next_run_at);
CREATE TABLE "eventos_clientes" (
 id TEXT PRIMARY KEY, "clienteId" INTEGER NOT NULL REFERENCES clientes(id), "staffId" INTEGER,
 accion TEXT NOT NULL, resultado TEXT NOT NULL, correlacion TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "eventos_clientes_clienteId_createdAt_idx" ON "eventos_clientes"("clienteId","createdAt");
