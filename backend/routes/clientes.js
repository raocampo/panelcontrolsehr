const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, permitir } = require('../middleware/auth');
const { notificarEstado } = require('../utils/estadoCliente');
const { provisionarMarcaBlanca, actualizarVersionMarcaBlanca } = require('../utils/provisionMarcaBlanca');
const { fechasTrial } = require('../utils/trial');

router.use(proteger);
router.use((req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : permitir('gestionar_clientes')(req, res, next));
router.use(require('./tenantOnboarding'));

const TIPOS_EMPRESA = ['medico', 'consorcio', 'hospital_clinica'];

function slugify(v) {
    return require('../utils/tenantSlug').sugerirSlug(v);
}

async function slugUnico(base) {
    let slug = base;
    for (let i = 2; i <= 20; i++) {
        const existe = await prisma.clientes.findUnique({ where: { slug } });
        if (!existe) return slug;
        const suffix = `-${i}`;
        slug = `${base.slice(0, 41 - suffix.length).replace(/-+$/, '')}${suffix}`;
    }
    throw new Error('No se encontró un subdominio disponible');
}

// GET /api/clientes
router.get('/', async (req, res) => {
    try {
        const { estado } = req.query;
        const clientes = await prisma.clientes.findMany({
            where: estado ? { estado } : {},
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: clientes.map(require('../services/tenantOnboarding').safeClient) });
    } catch (error) {
        console.error('GET /clientes:', error);
        res.status(500).json({ success: false, mensaje: 'Error al listar clientes' });
    }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
    try {
        const cliente = await prisma.clientes.findUnique({
            where: { id: parseInt(req.params.id, 10) },
            include: { solicitudes: true },
        });
        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.json({ success: true, data: require('../services/tenantOnboarding').safeClient(cliente) });
    } catch (error) {
        console.error('GET /clientes/:id:', error);
        res.status(500).json({ success: false, mensaje: 'Error al obtener cliente' });
    }
});

// POST /api/clientes
router.post('/', async (req, res) => {
    try {
        const {
            nombreComercial, razonSocial, contactoNombre, contactoEmail, contactoTelefono,
            tipoDespliegue, tipoEmpresa, ruc, slug: slugIn,
            dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
            estado, trialInicioAt, trialExpiraAt, trialSoloLecturaHasta, notas,
        } = req.body;

        if (!nombreComercial || !tipoDespliegue) {
            return res.status(400).json({ success: false, mensaje: 'nombreComercial y tipoDespliegue son requeridos' });
        }
        if (tipoEmpresa && !TIPOS_EMPRESA.includes(tipoEmpresa)) {
            return res.status(400).json({ success: false, mensaje: `tipoEmpresa inválido (${TIPOS_EMPRESA.join(', ')})` });
        }
        if (!['marca_blanca', 'tenant_corpsimtelec'].includes(tipoDespliegue)) {
            return res.status(400).json({ success: false, mensaje: 'Tipo de despliegue inválido' });
        }
        if (estado && !['trial', 'activo', 'bloqueado', 'cancelado'].includes(estado)) {
            return res.status(400).json({ success: false, mensaje: 'Estado inválido' });
        }
        let periodo;
        try {
            periodo = (estado || 'trial') === 'trial' ? fechasTrial({ trialInicioAt, trialExpiraAt, trialSoloLecturaHasta }) : {};
        } catch (err) { return res.status(400).json({ success: false, mensaje: err.message }); }

        const slug = null;
        const cliente = await prisma.clientes.create({
            data: {
                nombreComercial, razonSocial, contactoNombre, contactoEmail, contactoTelefono,
                tipoDespliegue,
                tipoEmpresa: tipoEmpresa || 'consorcio',
                ruc: ruc || null,
                slug,
                dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
                estado: estado || 'trial',
                aprovisionamiento: 'pendiente',
                ...periodo,
                notas,
                secretoControlPlane: crypto.randomBytes(32).toString('hex'),
            },
        });

        res.status(201).json({ success: true, data: require('../services/tenantOnboarding').safeClient(cliente) });
    } catch (error) {
        console.error('POST /clientes:', error);
        if (error.code === 'P2002') return res.status(409).json({ success: false, mensaje: 'Ya existe un cliente con ese slug' });
        res.status(500).json({ success: false, mensaje: 'Error al crear cliente' });
    }
});

// POST /api/clientes/:id/aprovisionar — dispara (o reintenta) el aprovisionamiento
router.post('/:id/aprovisionar', async (req, res) => {
    try {
        const cliente = await prisma.clientes.findUnique({ where: { id: parseInt(req.params.id, 10) } });
        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });

        // marca_blanca: crea infraestructura REAL y facturable en Railway/Vercel.
        if (!['super_admin', 'admin'].includes(req.staff.rol)) return res.status(403).json({ success: false, mensaje: 'Se requiere permiso de infraestructura' });
        // Requiere confirmación explícita — nunca se dispara solo.
        if (!req.body?.confirmar) {
            return res.status(400).json({
                success: false,
                codigo: 'CONFIRMACION_REQUERIDA',
                mensaje: 'Esto crea un proyecto real en Railway y Vercel (con costo). Reenviar con { "confirmar": true }.',
            });
        }
        if (!process.env.RAILWAY_API_TOKEN || !process.env.VERCEL_PERSONAL_ACCESS_TOKEN) {
            return res.status(400).json({ success: false, mensaje: 'RAILWAY_API_TOKEN / VERCEL_PERSONAL_ACCESS_TOKEN no configurados en el panel' });
        }
        if (!cliente.contactoEmail) {
            return res.status(400).json({ success: false, mensaje: 'contactoEmail es requerido (será el admin de la instancia)' });
        }
        if (!cliente.slug) {
            await prisma.clientes.update({ where: { id: cliente.id }, data: { slug: await slugUnico(slugify(cliente.nombreComercial)) } });
        }
        await prisma.clientes.update({ where: { id: cliente.id }, data: { aprovisionamiento: 'aprovisionando' } });

        const fresco = await prisma.clientes.findUnique({ where: { id: cliente.id } });
        // Async: tarda minutos (Railway + Vercel). No bloquea la respuesta; el
        // progreso se sigue con GET /:id/aprovisionamiento.
        provisionarMarcaBlanca(fresco, { adminNombre: req.body.adminNombre, adminPassword: req.body.adminPassword }, (msg) => console.log(`[aprovisionar#${cliente.id}]`, msg))
            .catch(async (err) => {
                console.error(`Aprovisionamiento marca_blanca de "${fresco.nombreComercial}" falló:`, err.message);
                await prisma.clientes.update({
                    where: { id: cliente.id },
                    data: { aprovisionamiento: 'error', notas: `${fresco.notas ? fresco.notas + '\n' : ''}[aprovisionamiento] ${err.message}` },
                }).catch(() => {});
            });

        res.status(202).json({ success: true, mensaje: 'Aprovisionamiento de infraestructura iniciado (puede tardar varios minutos)', data: { aprovisionamiento: 'aprovisionando' } });
    } catch (error) {
        console.error('POST /clientes/:id/aprovisionar:', error);
        res.status(500).json({ success: false, mensaje: 'Error al aprovisionar' });
    }
});

// POST /api/clientes/:id/actualizar-version — sube UN cliente marca_blanca a
// una rama/tag/commit concreto, sin tocar a ningún otro cliente. Así dos
// clientes pueden quedar en versiones distintas a propósito (uno con una
// función que pidió, otro sin ella).
router.post('/:id/actualizar-version', async (req, res) => {
    try {
        const cliente = await prisma.clientes.findUnique({ where: { id: parseInt(req.params.id, 10) } });
        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        if (cliente.tipoDespliegue !== 'marca_blanca') {
            return res.status(400).json({ success: false, mensaje: 'Solo aplica a clientes marca_blanca (los tenant comparten versión con todos)' });
        }
        if (!req.body?.versionRef) {
            return res.status(400).json({ success: false, mensaje: 'versionRef es requerido (rama, tag o commit)' });
        }
        if (!req.body?.confirmar) {
            return res.status(400).json({
                success: false,
                codigo: 'CONFIRMACION_REQUERIDA',
                mensaje: `Esto redespliega la infraestructura real de "${cliente.nombreComercial}" a "${req.body.versionRef}". Reenviar con { "confirmar": true }.`,
            });
        }
        if (cliente.aprovisionamiento !== 'listo') {
            return res.status(400).json({ success: false, mensaje: `El cliente está en estado "${cliente.aprovisionamiento}", no "listo" — no se puede actualizar todavía` });
        }

        await prisma.clientes.update({ where: { id: cliente.id }, data: { aprovisionamiento: 'aprovisionando' } });
        const versionRef = req.body.versionRef;

        actualizarVersionMarcaBlanca(cliente, versionRef, (msg) => console.log(`[actualizar#${cliente.id}]`, msg))
            .then(() => prisma.clientes.update({ where: { id: cliente.id }, data: { aprovisionamiento: 'listo' } }))
            .catch(async (err) => {
                console.error(`Actualización de versión de "${cliente.nombreComercial}" falló:`, err.message);
                await prisma.clientes.update({
                    where: { id: cliente.id },
                    data: { aprovisionamiento: 'error', notas: `${cliente.notas ? cliente.notas + '\n' : ''}[actualizar-version] ${err.message}` },
                }).catch(() => {});
            });

        res.status(202).json({ success: true, mensaje: `Actualización a "${versionRef}" iniciada (solo este cliente)`, data: { aprovisionamiento: 'aprovisionando', versionRef } });
    } catch (error) {
        console.error('POST /clientes/:id/actualizar-version:', error);
        res.status(500).json({ success: false, mensaje: 'Error al actualizar versión' });
    }
});

// Dedicated deployments retain their existing provisioning status.
router.get('/:id/aprovisionamiento', async (req, res) => {
    try {
        const c = await prisma.clientes.findUnique({ where: { id: Number(req.params.id) } });
        if (!c) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.json({ success: true, data: { aprovisionamiento: c.aprovisionamiento } });
    } catch { res.status(500).json({ success: false, mensaje: 'No se pudo consultar el estado' }); }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
    try {
        const b = req.body;
        const actual = await prisma.clientes.findUnique({ where: { id: Number(req.params.id) } });
        if (!actual) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        if (actual.tipoDespliegue === 'tenant_corpsimtelec') {
            for (const field of ['tipoDespliegue', 'tipoEmpresa', 'slug', 'dominioFrontend', 'dominioBackend', 'vercelProjectId', 'railwayProjectId']) {
                if (b[field] !== undefined && b[field] !== actual[field]) return res.status(400).json({ success: false, mensaje: 'La infraestructura y el tipo del tenant se gestionan mediante su aprovisionamiento.' });
            }
            if (['trialInicioAt', 'trialExpiraAt', 'trialSoloLecturaHasta'].some(k => b[k] !== undefined)) return res.status(400).json({ success: false, mensaje: 'Las fechas del tenant se sincronizan con SUJAM y no se editan manualmente.' });
            if (b.estado === 'trial' && actual.estado !== 'trial') return res.status(400).json({ success: false, mensaje: 'Reabrir una prueba requiere una operación explícita de soporte.' });
            if (b.estado === 'activo' && actual.estado !== 'activo' && !actual.disponibleDesde) return res.status(409).json({ success: false, mensaje: 'Complete la preparación del acceso antes de activar el cliente.' });
        }
        const dataToUpdate = {};
        for (const k of ['nombreComercial', 'razonSocial', 'contactoNombre', 'contactoEmail', 'contactoTelefono',
            'tipoDespliegue', 'tipoEmpresa', 'ruc', 'dominioFrontend', 'dominioBackend',
            'railwayProjectId', 'vercelProjectId', 'estado', 'notas']) {
            if (b[k] !== undefined) dataToUpdate[k] = b[k];
        }
        for (const k of ['trialInicioAt', 'trialExpiraAt', 'trialSoloLecturaHasta']) {
            if (b[k] !== undefined) dataToUpdate[k] = b[k] ? new Date(b[k]) : null;
        }

        if (actual.tipoDespliegue === 'tenant_corpsimtelec' && b.estado && b.estado !== actual.estado) {
            const applied = await notificarEstado({ ...actual, estado: b.estado });
            if (!applied.ok) return res.status(503).json({ success: false, mensaje: 'SUJAM no confirmó el cambio de estado. La ficha conserva su estado anterior.' });
        }
        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: dataToUpdate,
        });

        const bridge = cliente.tipoDespliegue === 'tenant_corpsimtelec' ? { ok: true } : await notificarEstado(cliente);
        res.json({
            success: true,
            data: require('../services/tenantOnboarding').safeClient(cliente),
            avisoBridge: bridge.ok ? undefined : `Cliente actualizado, pero no se pudo notificar a su despliegue: ${bridge.error}`,
        });
    } catch (error) {
        console.error('PUT /clientes/:id:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.status(500).json({ success: false, mensaje: 'Error al actualizar cliente' });
    }
});

// PUT /api/clientes/:id/dar-de-alta — el cliente pagó: trial -> activo
router.put('/:id/dar-de-alta', async (req, res) => {
    try {
        const actual = await prisma.clientes.findUnique({ where: { id: Number(req.params.id) } });
        if (!actual) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        if (actual.tipoDespliegue === 'tenant_corpsimtelec') {
            if (!actual.disponibleDesde) return res.status(409).json({ success: false, mensaje: 'Verifique primero el acceso completo del cliente.' });
            const applied = await notificarEstado({ ...actual, estado: 'activo' });
            if (!applied.ok) return res.status(503).json({ success: false, mensaje: 'SUJAM no confirmó la activación. Intente nuevamente.' });
        }
        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: { estado: 'activo', fechaActivacion: new Date(), ...(actual.tipoDespliegue === 'tenant_corpsimtelec'
                ? { trialInicioAt: null, trialExpiraAt: null, trialSoloLecturaHasta: null } : {}) },
        });

        const bridge = cliente.tipoDespliegue === 'tenant_corpsimtelec' ? { ok: true } : await notificarEstado(cliente);
        res.json({
            success: true,
            data: require('../services/tenantOnboarding').safeClient(cliente),
            avisoBridge: bridge.ok ? undefined : `Cliente actualizado, pero no se pudo notificar a su despliegue: ${bridge.error}`,
        });
    } catch (error) {
        console.error('PUT /clientes/:id/dar-de-alta:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.status(500).json({ success: false, mensaje: 'Error al dar de alta' });
    }
});

module.exports = router;
