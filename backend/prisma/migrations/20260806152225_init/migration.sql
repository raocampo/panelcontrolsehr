-- CreateTable
CREATE TABLE "staff_usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password" TEXT NOT NULL,
    "rol" VARCHAR(30) NOT NULL DEFAULT 'super_admin',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" SERIAL NOT NULL,
    "nombreComercial" VARCHAR(150) NOT NULL,
    "razonSocial" VARCHAR(200),
    "contactoNombre" VARCHAR(150),
    "contactoEmail" VARCHAR(150),
    "contactoTelefono" VARCHAR(50),
    "tipoDespliegue" VARCHAR(30) NOT NULL,
    "dominioFrontend" VARCHAR(200),
    "dominioBackend" VARCHAR(200),
    "railwayProjectId" VARCHAR(100),
    "vercelProjectId" VARCHAR(100),
    "estado" VARCHAR(30) NOT NULL DEFAULT 'trial',
    "trialInicioAt" TIMESTAMP(3),
    "trialExpiraAt" TIMESTAMP(3),
    "trialSoloLecturaHasta" TIMESTAMP(3),
    "fechaActivacion" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes" (
    "id" SERIAL NOT NULL,
    "nombreSolicitante" VARCHAR(150) NOT NULL,
    "empresa" VARCHAR(150),
    "email" VARCHAR(150) NOT NULL,
    "telefono" VARCHAR(50),
    "tipoCliente" VARCHAR(30),
    "mensaje" TEXT,
    "estado" VARCHAR(30) NOT NULL DEFAULT 'nueva',
    "clienteId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_usuarios_email_key" ON "staff_usuarios"("email");

-- CreateIndex
CREATE INDEX "clientes_estado_idx" ON "clientes"("estado");

-- CreateIndex
CREATE INDEX "solicitudes_estado_idx" ON "solicitudes"("estado");

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
