// ====================================
// Aprovisionamiento de infraestructura para un cliente marca_blanca:
// Railway (Postgres + backend SUJAM) + Vercel (frontend SUJAM) + bootstrap.
// ====================================
// FASE 6 slice 2. Probado en vivo el 2026-09-11 contra Railway/Vercel reales
// (ver docs/Documentación/05-propuestas-tecnicas/ARQUITECTURA_MULTITENANT_MARCA_BLANCA.md
// para el detalle de los 4 bugs encontrados y corregidos en esa corrida).
//
// Cada cliente queda fijado a un `versionRef` (rama, tag o commit SHA) — no
// sigue `main` en vivo. Eso permite: a) que un push a main no reconfigure
// solo a todos los clientes marca_blanca a la vez, y b) actualizar UN cliente
// concreto a una versión nueva (actualizarVersionMarcaBlanca) sin tocar a
// los demás — dos clientes pueden estar en versiones distintas a propósito.
//
// IMPORTANTE: crea/actualiza recursos reales y facturables en Railway/Vercel.
// No invocar automáticamente sin que un humano lo confirme explícitamente.
// ====================================

const crypto = require('crypto');
const railway = require('./railway');
const vercel = require('./vercel');
const prisma = require('../config/prisma');

const REPO = process.env.MARCA_BLANCA_REPO || 'raocampo/SEHR';
const VERSION_DEFAULT = process.env.MARCA_BLANCA_VERSION_DEFAULT || 'main';

function generarSecreto(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}
function generarPassword() {
    // Sin caracteres especiales (evita problemas de escapado en variables/URLs).
    return crypto.randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + 'Aa1';
}

/**
 * @param cliente fila de `clientes` (tipoDespliegue = marca_blanca)
 * @param opts { adminNombre?, adminPassword? }
 * @param log  función de progreso (para streaming/consola)
 */
async function provisionarMarcaBlanca(cliente, opts = {}, log = console.log) {
    const nombreProyecto = `sujam-${cliente.slug || cliente.id}`;
    const versionRef = cliente.versionRef || VERSION_DEFAULT;
    const dbPassword = generarPassword();
    const jwtSecret = generarSecreto(48);
    const adminPassword = opts.adminPassword || generarPassword();
    const controlSecret = cliente.secretoControlPlane || generarSecreto(32);

    log(`\n🚂 Railway — proyecto "${nombreProyecto}" (versión: ${versionRef})`);
    const projectId = await railway.crearProyecto(nombreProyecto);
    const environmentId = await railway.obtenerEnvironmentProduccion(projectId);

    log('   • Postgres...');
    const pgServiceId = await railway.crearServicioImagen({ projectId, nombre: 'Postgres', imagen: railway.IMAGEN_POSTGRES });
    await railway.crearVolumen({ projectId, serviceId: pgServiceId, mountPath: '/var/lib/postgresql/data' });
    const databaseUrl = `postgresql://postgres:${dbPassword}@postgres.railway.internal:5432/railway`;
    await railway.setVariables({
        projectId, environmentId, serviceId: pgServiceId,
        variables: { POSTGRES_PASSWORD: dbPassword, PGDATA: '/var/lib/postgresql/data/pgdata', POSTGRES_DB: 'railway', DATABASE_URL: databaseUrl },
    });

    log('   • Backend SUJAM (repo, root=backend)...');
    // backend/railway.json de SEHR no aplica ninguna migración/push contra una
    // BD nueva (el repo asume una BD ya restaurada, como la de producción) —
    // se fija por-servicio vía la API, sin tocar el repo compartido.
    // branch=versionRef fija a qué rama/tag sigue este cliente en Railway (no
    // se redespliega solo si alguien más pushea a main).
    const backendServiceId = await railway.crearServicioRepo({
        projectId, nombre: 'backend', repo: REPO, rootDirectory: 'backend', branch: versionRef,
        preDeployCommand: ['npx prisma db push --accept-data-loss --skip-generate'],
    });
    // Sin targetPort explícito: Railway inyecta su propio PORT en runtime
    // (no siempre 5500, el server.js del repo respeta process.env.PORT) y
    // autodetecta a qué puerto enrutar el dominio.
    const backendDomain = await railway.crearDominio({ serviceId: backendServiceId, environmentId });
    const backendUrl = `https://${backendDomain}`;

    await railway.setVariables({
        projectId, environmentId, serviceId: backendServiceId,
        variables: {
            DATABASE_URL: databaseUrl,
            JWT_SECRET: jwtSecret,
            JWT_EXPIRE: '30d',
            NODE_ENV: 'production',
            MODO_DESPLIEGUE: 'single',
            BACKEND_URL: backendUrl,
            CONTROL_PLANE_SECRET: controlSecret,
        },
    });

    log('   • esperando el primer deploy del backend...');
    // Deploy explícito a la versión exacta (en vez de confiar en "lo que sea
    // que se haya auto-disparado al crear el servicio o cambiar variables")
    // — evita la ambigüedad de "cuál es el último deployment" cuando hay más
    // de un trigger casi simultáneo, y de paso fija la versión real.
    const backendDeployId = await railway.desplegarVersion({ serviceId: backendServiceId, environmentId, ref: versionRef });
    await railway.esperarDeployment(backendDeployId);

    log('\n▲ Vercel — frontend');
    const vercelProjectId = await vercel.crearProyecto({
        nombre: nombreProyecto, repo: REPO, rootDirectory: 'frontend', framework: 'vite',
        envVars: [
            { key: 'VITE_API_URL', value: backendUrl },
            { key: 'VITE_APP_NAME', value: cliente.nombreComercial },
        ],
    });
    await vercel.desactivarProteccionSSO(vercelProjectId).catch((e) => log(`   (no se pudo desactivar SSO: ${e.message})`));
    // Crear el proyecto con gitRepository conecta pushes futuros, pero NO
    // dispara un primer deploy — hay que pedirlo explícito, a la versión fijada.
    const frontendDeployId = await vercel.crearDeployment({ projectId: vercelProjectId, repo: REPO, ref: versionRef });
    await vercel.esperarDeployment(frontendDeployId);
    const frontendDomain = await vercel.dominioDefault(vercelProjectId);
    const frontendUrl = `https://${frontendDomain}`;

    log('   • actualizando FRONTEND_URL en el backend...');
    await railway.setVariables({ projectId, environmentId, serviceId: backendServiceId, variables: { FRONTEND_URL: frontendUrl } });
    const backendDeployId2 = await railway.desplegarVersion({ serviceId: backendServiceId, environmentId, ref: versionRef });
    await railway.esperarDeployment(backendDeployId2);

    log('\n🌱 Sembrando la instancia (POST /api/admin/bootstrap)...');
    const bootstrapResp = await fetch(`${backendUrl}/api/admin/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-control-plane-secret': controlSecret },
        body: JSON.stringify({
            organizacion: cliente.nombreComercial,
            ruc: cliente.ruc || undefined,
            razonSocial: cliente.razonSocial || undefined,
            tipo: cliente.tipoEmpresa || 'consorcio',
            adminEmail: cliente.contactoEmail,
            adminNombre: opts.adminNombre || cliente.contactoNombre || 'Administrador',
            adminPassword,
            modo: cliente.estado === 'activo' ? 'activo' : 'trial',
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!bootstrapResp.ok) {
        throw new Error(`Bootstrap falló: HTTP ${bootstrapResp.status} ${await bootstrapResp.text()}`);
    }

    await prisma.clientes.update({
        where: { id: cliente.id },
        data: {
            railwayProjectId: projectId,
            vercelProjectId,
            dominioBackend: backendUrl,
            dominioFrontend: frontendUrl,
            secretoControlPlane: controlSecret,
            versionRef,
            aprovisionamiento: 'listo',
        },
    });

    log(`\n✅ Marca blanca lista: ${frontendUrl}  (backend: ${backendUrl}, versión ${versionRef})`);
    return { projectId, vercelProjectId, backendUrl, frontendUrl, versionRef, adminPassword };
}

/**
 * Actualiza SOLO este cliente (ya aprovisionado) a un nuevo `nuevoRef`
 * (rama, tag o commit) — no toca Postgres ni a ningún otro cliente. Así dos
 * clientes marca_blanca pueden quedar en versiones distintas a propósito
 * (uno con una función que pidió y otro sin ella, por ejemplo).
 *
 * @param cliente fila de `clientes` con railwayProjectId/vercelProjectId ya set
 */
async function actualizarVersionMarcaBlanca(cliente, nuevoRef, log = console.log) {
    if (!cliente.railwayProjectId || !cliente.vercelProjectId) {
        throw new Error('El cliente no tiene un despliegue marca_blanca aprovisionado todavía');
    }

    log(`\n🔄 Actualizando "${cliente.nombreComercial}" a la versión "${nuevoRef}"...`);

    const environmentId = await railway.obtenerEnvironmentProduccion(cliente.railwayProjectId);
    const backendServiceId = await railway.buscarServicioPorNombre(cliente.railwayProjectId, 'backend');

    log('   • Railway (backend)...');
    const backendDeployId = await railway.desplegarVersion({ serviceId: backendServiceId, environmentId, ref: nuevoRef });
    await railway.esperarDeployment(backendDeployId);

    log('   • Vercel (frontend)...');
    const nombreProyecto = `sujam-${cliente.slug || cliente.id}`;
    const frontendDeployId = await vercel.crearDeployment({ projectId: cliente.vercelProjectId, repo: REPO, ref: nuevoRef });
    await vercel.esperarDeployment(frontendDeployId);

    await prisma.clientes.update({ where: { id: cliente.id }, data: { versionRef: nuevoRef } });

    log(`\n✅ "${cliente.nombreComercial}" actualizado a "${nuevoRef}" — el resto de los clientes no se tocó.`);
    return { versionRef: nuevoRef };
}

module.exports = { provisionarMarcaBlanca, actualizarVersionMarcaBlanca };
