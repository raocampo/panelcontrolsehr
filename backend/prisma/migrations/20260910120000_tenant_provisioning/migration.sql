-- Aprovisionamiento de tenants + catch-up de secretoControlPlane (que se había
-- agregado al schema sin migración). IF NOT EXISTS por si la columna ya existe
-- en algún entorno por un `prisma db push` manual previo.

ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "secretoControlPlane" VARCHAR(100);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "tipoEmpresa" VARCHAR(30) NOT NULL DEFAULT 'consorcio';
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(63);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "ruc" VARCHAR(13);
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "aprovisionamiento" VARCHAR(20) NOT NULL DEFAULT 'pendiente';

CREATE UNIQUE INDEX IF NOT EXISTS "clientes_slug_key" ON "clientes"("slug");
