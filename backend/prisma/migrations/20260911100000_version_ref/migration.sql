-- Fija a qué rama/tag/commit está pinneado el despliegue marca_blanca de cada
-- cliente (no sigue main en vivo — permite actualizar clientes de forma
-- independiente unos de otros).
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "versionRef" VARCHAR(100) NOT NULL DEFAULT 'main';
