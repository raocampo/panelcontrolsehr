const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const prisma = require('../config/prisma');
const lifecycle = require('../services/tenantOnboarding');
const bridge = require('../utils/sujamTenants');
const { safeJob, fault } = require('../utils/durableJobs');
const { initialCredential } = require('../utils/accessCredentials');
const { sugerirSlug } = require('../utils/tenantSlug');
const { permitir } = require('../middleware/auth');
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, keyGenerator: req => String(req.staff.id),
    standardHeaders: true, legacyHeaders: false, message: { success: false, mensaje: 'Se alcanzó el límite de recuperaciones. Intente más tarde.' } });
const createLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: req => String(req.staff.id), standardHeaders: true, legacyHeaders: false });
function errorResponse(res, error) {
    const conflict = error.code === 'P2002' || ['IDEMPOTENCY_CONFLICT', 'TENANT_CONFLICTO'].includes(error.code);
    res.status(conflict ? 409 : error.code === 'VALIDACION' ? 400 : error.code ? 409 : 500).json({ success: false,
        codigo: error.code || 'OPERACION_FALLIDA', mensaje: error.code === 'P2002' ? 'El subdominio ya está ocupado. Elija otro antes de crear el cliente.'
            : error.retryMs !== undefined ? error.message : 'No se pudo completar la operación. Intente nuevamente.' });
}
async function tenant(req, res, next) {
    try {
        const c = await prisma.clientes.findUnique({ where: { id: Number(req.params.id) } });
        if (!c) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        if (c.tipoDespliegue !== 'tenant_corpsimtelec') return next('route');
        req.cliente = c;
        next();
    } catch (e) { errorResponse(res, e); }
}

router.get('/configuracion-alta', (_req, res) => res.json({ success: true, data: {
    habilitado: process.env.TENANT_ONBOARDING_ENABLED === 'true',
    dominioBase: process.env.SUJAM_TENANT_BASE_DOMAIN || 'sujam.corpsimtelec.com',
    configuracionPendiente: [!bridge.configurado() && 'Conexión con SUJAM', !process.env.SUJAM_VERCEL_PROJECT_ID && 'Proyecto frontend Vercel',
        !process.env.VERCEL_PERSONAL_ACCESS_TOKEN && 'Autorización Vercel'].filter(Boolean),
} }));
router.get('/sugerir-subdominio', async (req, res) => {
    const base = sugerirSlug(req.query.nombre);
    for (let i = 1; i < 100; i++) {
        const tail = i === 1 ? '' : `-${i}`;
        const slug = `${base.slice(0, 41 - tail.length).replace(/-+$/, '')}${tail}`;
        if (!await prisma.clientes.findUnique({ where: { slug } })) return res.json({ success: true, data: { slug } });
    }
    res.status(409).json({ success: false, mensaje: 'Indique manualmente otro subdominio.' });
});
router.post('/', (req, _res, next) => req.body.tipoDespliegue === 'tenant_corpsimtelec' ? next() : next('route'), createLimit, async (req, res) => {
    try {
        const result = await lifecycle.createClient(req.body, req.get('Idempotency-Key'), req.staff);
        res.set('Cache-Control', 'no-store').status(202).json({ success: true, ...result,
            avisoAprov: process.env.TENANT_ONBOARDING_ENABLED === 'true' ? undefined : 'La solicitud quedó guardada. Soporte debe habilitar la automatización para continuar.' });
    } catch (e) { errorResponse(res, e); }
});
router.get('/:id/aprovisionamiento', tenant, async (req, res) => {
    try {
        const c = req.cliente;
        const job = await lifecycle.queue().byResource(`cliente:${c.id}`);
        res.json({ success: true, data: { aprovisionamiento: c.aprovisionamiento,
            accesoEstado: c.accesoEstado, disponibleDesde: c.disponibleDesde, ultimaVerificacionAt: c.ultimaVerificacionAt,
            administrador: c.adminEmail ? { id: c.adminUsuarioId, email: c.adminEmail, nombre: c.adminNombre } : null,
            trabajo: safeJob(job), automatizacionHabilitada: process.env.TENANT_ONBOARDING_ENABLED === 'true',
            requiereVerificacion: !job, dominioFrontend: c.dominioFrontend } });
    } catch (e) { errorResponse(res, e); }
});
for (const path of ['/:id/aprovisionar', '/:id/verificar-acceso']) router.post(path, tenant, async (req, res) => {
    try { res.status(202).json({ success: true, data: await lifecycle.resumeClient(req.cliente, req.staff) }); }
    catch (e) { errorResponse(res, e); }
});
router.get('/:id/administrador', tenant, async (req, res) => {
    try {
        const r = await bridge.administrador(req.cliente.slug);
        if (!r.ok) throw fault('El administrador aún no está disponible. Revise el progreso de preparación.', 'ADMIN_PENDIENTE');
        await prisma.clientes.update({ where: { id: req.cliente.id }, data: { adminUsuarioId: r.data.id, adminEmail: r.data.email, adminNombre: r.data.nombre } });
        res.set('Cache-Control', 'no-store').json({ success: true, data: r.data });
    } catch (e) { errorResponse(res, e); }
});
router.post('/:id/administrador/restablecer', tenant, permitir('gestionar_accesos'), resetLimit, async (req, res) => {
    try {
        const actionId = lifecycle.requestKey(req.get('Idempotency-Key'));
        const access = await initialCredential();
        const result = await bridge.restablecerAdministrador(req.cliente.slug, { actionId, adminPasswordHash: access.hash });
        if (!result.ok) throw fault('No se pudo confirmar el restablecimiento. Consulte al administrador; repetir la misma solicitud no rotará dos veces.', 'RESET_SIN_CONFIRMAR');
        if (result.data.created) await prisma.eventos_clientes.create({ data: { clienteId: req.cliente.id, staffId: req.staff.id,
            accion: 'RESTABLECER_ADMIN', resultado: 'completado', correlacion: actionId } });
        res.set('Cache-Control', 'no-store').json({ success: true, data: result.data.administrador,
            accesoInicial: result.data.created ? { email: result.data.administrador.email, passwordTemporal: access.password } : undefined,
            mensaje: result.data.created ? 'Clave temporal generada. Las sesiones anteriores fueron revocadas.' : 'La solicitud ya se completó. La clave se entregó una sola vez; genere otra solicitud si la perdió.' });
    } catch (e) { errorResponse(res, e); }
});
module.exports = router;
