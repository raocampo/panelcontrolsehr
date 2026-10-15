const crypto = require('crypto');
const prisma = require('../config/prisma');
const bridge = require('../utils/sujamTenants');
const domains = require('../utils/tenantDomains');
const { createQueue, fingerprint, fault, safeJob } = require('../utils/durableJobs');
const { initialCredential, passwordError } = require('../utils/accessCredentials');
const { validarSlug, sugerirSlug } = require('../utils/tenantSlug');

const adapter = db => ({ query: async (sql, params = []) => ({ rows: await db.$queryRawUnsafe(sql, ...params) }) });
const queue = (db = prisma) => createQueue(adapter(db));
const safeClient = c => { const { secretoControlPlane, ...safe } = c; return safe; };
function requestKey(value) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(value || '')) throw fault('Falta un identificador válido de la solicitud. Vuelva a abrir el formulario.', 'VALIDACION');
    return value;
}
function normalize(body) {
    const nombreComercial = String(body.nombreComercial || '').trim();
    const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
    const adminNombre = String(body.adminNombre || '').trim();
    const tipoEmpresa = body.tipoEmpresa || 'consorcio';
    const estado = body.estado || 'trial';
    const slug = validarSlug(body.slug || sugerirSlug(nombreComercial));
    const trialDias = Number(body.trialDias || 30);
    if (!nombreComercial || nombreComercial.length > 150) throw fault('Indique el nombre comercial (máximo 150 caracteres)', 'VALIDACION');
    if (!adminNombre || adminNombre.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 150) throw fault('Indique nombre y correo válidos del administrador del sistema', 'VALIDACION');
    if (!['medico', 'consorcio', 'hospital_clinica'].includes(tipoEmpresa)) throw fault('Tipo de empresa inválido', 'VALIDACION');
    if (!['trial', 'activo'].includes(estado)) throw fault('El alta debe comenzar como Trial o Activo', 'VALIDACION');
    if (!Number.isInteger(trialDias) || trialDias < 1 || trialDias > 365) throw fault('La prueba debe durar entre 1 y 365 días', 'VALIDACION');
    if (body.ruc && !/^\d{13}$/.test(body.ruc)) throw fault('El RUC debe tener 13 dígitos', 'VALIDACION');
    const optional = {};
    for (const [key, max] of Object.entries({ razonSocial: 200, contactoNombre: 150, contactoEmail: 150, contactoTelefono: 50, ruc: 13, notas: 10000 })) {
        if (body[key] != null && String(body[key]).length > max) throw fault(`${key} excede la longitud permitida`, 'VALIDACION');
        optional[key] = body[key] ? String(body[key]).trim() : null;
    }
    return { nombreComercial, adminEmail, adminNombre, tipoEmpresa, estado, slug, trialDias, ...optional };
}

async function createClient(body, key, staff) {
    requestKey(key);
    if (body.adminPassword !== undefined && passwordError(body.adminPassword)) throw fault(passwordError(body.adminPassword), 'VALIDACION');
    const normalized = normalize(body);
    const hash = fingerprint({ ...normalized, password: body.adminPassword || null }, process.env.JWT_SECRET);
    const access = await initialCredential(body.adminPassword);
    return prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1))', key);
        const q = queue(tx);
        const old = await q.byKey(key);
        if (old) {
            if (old.request_hash !== hash) throw fault('Esta solicitud ya fue enviada con datos diferentes', 'IDEMPOTENCY_CONFLICT');
            return { data: safeClient(await tx.clientes.findUnique({ where: { id: old.payload.clienteId } })), trabajo: safeJob(old), repetida: true };
        }
        const { trialDias, ...data } = normalized;
        const cliente = await tx.clientes.create({ data: { ...data, tipoDespliegue: 'tenant_corpsimtelec',
            dominioFrontend: `https://${domains.hostname(data.slug)}`, aprovisionamiento: 'aprovisionando', accesoEstado: 'pendiente' } });
        const { job } = await q.enqueue({ resource: `cliente:${cliente.id}`, requestKey: key, requestHash: hash,
            payload: { clienteId: cliente.id, adminPasswordHash: access.hash, trialDias, adopt: false, tenantOptions: {
                slug: cliente.slug, organizacion: cliente.nombreComercial, razonSocial: cliente.razonSocial || undefined,
                ruc: cliente.ruc || undefined, tipo: cliente.tipoEmpresa, adminEmail: cliente.adminEmail, adminNombre: cliente.adminNombre,
                modo: cliente.estado === 'activo' ? 'activo' : 'trial', trialDias, branding: { nombre: cliente.nombreComercial },
            } } });
        await tx.eventos_clientes.create({ data: { clienteId: cliente.id, staffId: staff.id, accion: 'CREAR_TENANT', resultado: 'encolado', correlacion: job.id } });
        return { data: safeClient(cliente), trabajo: safeJob(job), accesoInicial: { email: normalized.adminEmail, passwordTemporal: access.password } };
    });
}

function unwrap(response, message) {
    if (response.ok) return response.data;
    if ([401, 403].includes(response.status)) throw fault('SUJAM no autoriza la integración. Revise la configuración del control plane.', 'REQUIERE_CONFIGURACION');
    if (response.status === 400) throw fault(message, 'ERROR_INTERVENCION');
    if ([404, 409].includes(response.status)) throw fault(message, 'SUJAM_CONFLICTO');
    throw fault(message, 'SUJAM_PENDIENTE', 15000);
}

function createProcessor({ db = prisma, remote = bridge, domainService = domains } = {}) {
    return async (job, save) => {
        const cliente = await db.clientes.findUnique({ where: { id: job.payload.clienteId } });
        if (!cliente) throw fault('El cliente ya no está registrado', 'CLIENTE_NO_ENCONTRADO');
        if (['bloqueado', 'cancelado'].includes(cliente.estado)) throw fault('El cliente está suspendido. Active su ficha antes de continuar.', 'CLIENTE_SUSPENDIDO');
        const checkpoint = async (stage, data = {}, state = 'done') => {
            await save(stage, data, state);
            await db.clientes.update({ where: { id: cliente.id }, data: { accesoEstado: stage, aprovisionamiento: 'aprovisionando' } });
        };
        try {
            if (!remote.configurado()) throw fault('Configure SUJAM_SUPERADMIN_URL y SUJAM_SUPERADMIN_SECRET', 'REQUIERE_CONFIGURACION');
            await checkpoint('preparando_bd', {}, 'running');
            let tenant = await remote.obtenerTenant(cliente.slug);
            if (!tenant.ok && tenant.status === 404 && !job.payload.adopt) {
                const tenantOptions = job.payload.tenantOptions || { slug: cliente.slug, organizacion: cliente.nombreComercial,
                    razonSocial: cliente.razonSocial || undefined, ruc: cliente.ruc || undefined, tipo: cliente.tipoEmpresa,
                    adminEmail: cliente.adminEmail, adminNombre: cliente.adminNombre,
                    modo: cliente.estado === 'activo' ? 'activo' : 'trial', trialDias: job.payload.trialDias || 30,
                    branding: { nombre: cliente.nombreComercial } };
                const operation = unwrap(await remote.crearTenant({ ...tenantOptions, operationId: job.id,
                    adminPasswordHash: job.payload.adminPasswordHash }), 'SUJAM no pudo guardar la solicitud de creación');
                if (operation.trabajo?.state === 'blocked') throw fault(operation.trabajo.mensaje || 'La preparación requiere revisión en SUJAM', 'SUJAM_INTERVENCION');
                throw fault('SUJAM está preparando la base y el administrador.', 'PREPARANDO_BD', 5000);
            }
            tenant = unwrap(tenant, 'No se pudo consultar el tenant en SUJAM');
            if (!job.payload.adopt && tenant.operationId !== job.id) throw fault('El subdominio pertenece a otra operación. Requiere revisión.', 'TENANT_CONFLICTO');
            if (['error', 'aprovisionando'].includes(tenant.estado)) {
                if (tenant.operationId) {
                    const operation = unwrap(await remote.obtenerOperacion(tenant.operationId), 'No se pudo consultar el progreso de SUJAM');
                    if (operation.state === 'blocked') throw fault(operation.mensaje || 'La preparación requiere revisión en SUJAM', 'SUJAM_INTERVENCION');
                }
                throw fault('SUJAM está preparando la base y el administrador.', 'PREPARANDO_BD', 5000);
            }
            await checkpoint('preparando_bd');
            const prep = unwrap(await remote.preparacion(cliente.slug), 'No se pudo comprobar el administrador del tenant');
            if (prep.slug !== cliente.slug || prep.tipo !== cliente.tipoEmpresa) throw fault('El tenant remoto no coincide con el cliente del panel.', 'TENANT_CONFLICTO');
            await db.clientes.update({ where: { id: cliente.id }, data: { adminUsuarioId: prep.administrador.id, adminEmail: prep.administrador.email, adminNombre: prep.administrador.nombre } });
            await checkpoint('creando_administrador', { email: prep.administrador.email });
            const host = domainService.hostname(cliente.slug);
            await checkpoint('asociando_dominio', {}, 'running');
            const domain = await domainService.ensureDomain(host);
            await checkpoint('asociando_dominio', { hostname: host, projectId: domain.projectId });
            await checkpoint('esperando_dns', { registro: { tipo: 'CNAME', nombre: host, destino: domain.cname } }, 'running');
            const dnsEvidence = await domainService.verifyDns(host, domain);
            await checkpoint('esperando_dns', dnsEvidence);
            await checkpoint('esperando_ssl', {}, 'running');
            let evidence;
            try { evidence = await domainService.publicCheck(host, cliente.slug); }
            catch (error) {
                if (error.code === 'ESPERANDO_SSL' && !job.steps.certificado_solicitado) {
                    await domainService.requestCertificate(host);
                    await checkpoint('certificado_solicitado', { hostname: host });
                    await checkpoint('esperando_ssl', {}, 'running');
                }
                throw error;
            }
            await checkpoint('esperando_ssl', { https: true });
            await checkpoint('verificando', evidence);
            const effective = unwrap(await remote.confirmarDisponibilidad(cliente.slug), 'No se pudo confirmar la disponibilidad del tenant');
            const ready = await db.clientes.update({ where: { id: cliente.id }, data: {
                aprovisionamiento: 'listo', accesoEstado: 'listo', dominioFrontend: `https://${host}`,
                vercelProjectId: domain.projectId, disponibleDesde: effective.disponibleDesde, ultimaVerificacionAt: new Date(),
                trialInicioAt: effective.trialInicioAt, trialExpiraAt: effective.trialExpiraAt, trialSoloLecturaHasta: effective.trialSoloLecturaHasta,
            } });
            await db.eventos_clientes.create({ data: { clienteId: cliente.id, accion: 'TENANT_DISPONIBLE', resultado: 'listo', correlacion: job.id } });
            return { clienteId: ready.id, dominio: ready.dominioFrontend, administrador: effective.administrador };
        } catch (error) {
            await db.clientes.update({ where: { id: cliente.id }, data: { accesoEstado: error.retryMs === null ? 'requiere_revision' : error.code === 'REQUIERE_CONFIGURACION' ? 'requiere_configuracion' : 'esperando',
                aprovisionamiento: error.retryMs === null ? 'error' : 'aprovisionando' } });
            throw error;
        }
    };
}

async function resumeClient(cliente, staff) {
    const q = queue();
    let job = await q.byResource(`cliente:${cliente.id}`);
    if (!job) {
        const tenant = unwrap(await bridge.obtenerTenant(cliente.slug), 'No se encontró un tenant para adoptar. Revise su creación con soporte.');
        if (!['preparado', 'activo', 'solo_lectura'].includes(tenant.estado)) throw fault('El tenant existente todavía no se puede adoptar', 'ERROR_INTERVENCION');
        ({ job } = await q.enqueue({ resource: `cliente:${cliente.id}`, requestHash: fingerprint({ clienteId: cliente.id, adopt: true }), payload: { clienteId: cliente.id, adopt: true } }));
    }
    const tenant = await bridge.obtenerTenant(cliente.slug);
    if (tenant.ok && tenant.data.operationId && ['aprovisionando', 'error'].includes(tenant.data.estado)) await bridge.reanudarOperacion(tenant.data.operationId);
    if (!tenant.ok && tenant.status === 404 && !job.payload.adopt) await bridge.reanudarOperacion(job.id);
    await q.resume(job.id);
    await prisma.clientes.update({ where: { id: cliente.id }, data: { aprovisionamiento: 'aprovisionando', accesoEstado: 'pendiente' } });
    await prisma.eventos_clientes.create({ data: { clienteId: cliente.id, staffId: staff.id, accion: 'VERIFICAR_TENANT', resultado: 'encolado', correlacion: job.id } });
    return safeJob(await q.get(job.id));
}

async function startWorker() {
    return queue().start(createProcessor(), { enabled: () => process.env.TENANT_ONBOARDING_ENABLED === 'true' });
}
module.exports = { adapter, queue, safeClient, requestKey, normalize, createClient, createProcessor, resumeClient, startWorker };
