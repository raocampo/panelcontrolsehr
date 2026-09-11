// ====================================
// Aprovisionamiento de infraestructura para un cliente marca_blanca:
// Railway (Postgres + backend SUJAM) + Vercel (frontend SUJAM) + bootstrap.
// ====================================
// FASE 6 slice 2. Sigue el patrón ya probado a mano en
// sistemaSUJAM/docs/qa/cierre_jornada_2026-08-07.md (con el que se desplegó
// este mismo panel): imagen de Postgres + variables literales (la referencia
// ${{Postgres.DATABASE_URL}} no se resuelve al setearla por API), y
// preDeployCommand (ya está en el railway.json del repo SEHR) para migrar en
// runtime, no en build.
//
// IMPORTANTE: crea recursos reales y facturables en Railway/Vercel. No
// invocar automáticamente sin que un humano lo confirme explícitamente.
// ====================================

const crypto = require('crypto');
const railway = require('./railway');
const vercel = require('./vercel');
const prisma = require('../config/prisma');

const REPO = process.env.MARCA_BLANCA_REPO || 'raocampo/SEHR';

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
    const dbPassword = generarPassword();
    const jwtSecret = generarSecreto(48);
    const adminPassword = opts.adminPassword || generarPassword();
    const controlSecret = cliente.secretoControlPlane || generarSecreto(32);

    log(`\n🚂 Railway — proyecto "${nombreProyecto}"`);
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
    const backendServiceId = await railway.crearServicioRepo({
        projectId, nombre: 'backend', repo: REPO, rootDirectory: 'backend',
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
    // No disparar un redeploy manual acá: crear el servicio + fijar variables
    // ya dispara un deploy solo. Pedir uno de más casi al mismo tiempo hace que
    // Railway corra dos preDeployCommand en paralelo contra la misma BD nueva
    // (el segundo falla con "ya existe" y tira abajo el primero, que sí sirvió).
    await railway.esperarDeploySuccess({ projectId, serviceId: backendServiceId });

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
    // dispara un primer deploy — hay que pedirlo explícito.
    await vercel.crearDeployment({ nombre: nombreProyecto, projectId: vercelProjectId, repo: REPO });
    await vercel.esperarDeployReady(vercelProjectId);
    const frontendDomain = await vercel.dominioDefault(vercelProjectId);
    const frontendUrl = `https://${frontendDomain}`;

    log('   • actualizando FRONTEND_URL en el backend...');
    await railway.setVariables({ projectId, environmentId, serviceId: backendServiceId, variables: { FRONTEND_URL: frontendUrl } });
    await railway.esperarDeploySuccess({ projectId, serviceId: backendServiceId });

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
            aprovisionamiento: 'listo',
        },
    });

    log(`\n✅ Marca blanca lista: ${frontendUrl}  (backend: ${backendUrl})`);
    return { projectId, vercelProjectId, backendUrl, frontendUrl, adminPassword };
}

module.exports = { provisionarMarcaBlanca };
