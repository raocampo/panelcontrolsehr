const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger } = require('../middleware/auth');
const { notificarEstado } = require('../utils/estadoCliente');
const sujamTenants = require('../utils/sujamTenants');
const { provisionarMarcaBlanca } = require('../utils/provisionMarcaBlanca');

router.use(proteger);

const TIPOS_EMPRESA = ['medico', 'consorcio', 'hospital_clinica'];

function slugify(v) {
    const s = String(v || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quita tildes (marcas combinantes tras NFD)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40);
    return s || `cli-${Date.now().toString(36)}`;
}

async function slugUnico(base) {
    let slug = base;
    for (let i = 2; i <= 20; i++) {
        const existe = await prisma.clientes.findUnique({ where: { slug } });
        if (!existe) return slug;
        slug = `${base}-${i}`.slice(0, 43);
    }
    return `${base}-${Date.now().toString(36)}`;
}

// Aprovisiona (o reintenta) el tenant de un cliente tenant_corpsimtelec en SUJAM.
async function aprovisionarTenant(cliente) {
    const modo = cliente.estado === 'activo' ? 'activo' : 'trial';
    const trialDias = cliente.trialExpiraAt && cliente.trialInicioAt
        ? Math.max(1, Math.round((new Date(cliente.trialExpiraAt) - new Date(cliente.trialInicioAt)) / 864e5))
        : 30;

    const r = await sujamTenants.crearTenant({
        slug: cliente.slug,
        organizacion: cliente.nombreComercial,
        razonSocial: cliente.razonSocial || undefined,
        ruc: cliente.ruc || undefined,
        tipo: cliente.tipoEmpresa || 'consorcio',
        adminEmail: cliente.contactoEmail || `admin@${cliente.slug}.local`,
        adminNombre: cliente.contactoNombre || 'Administrador',
        modo,
        trialDias,
        branding: { nombre: cliente.nombreComercial },
    });

    return prisma.clientes.update({
        where: { id: cliente.id },
        data: {
            aprovisionamiento: r.ok ? 'aprovisionando' : 'error',
            dominioFrontend: r.ok ? sujamTenants.dominioFrontend(cliente.slug) : cliente.dominioFrontend,
            notas: r.ok ? cliente.notas : `${cliente.notas ? cliente.notas + '\n' : ''}[aprovisionamiento] ${r.error}`,
        },
    });
}

// GET /api/clientes
router.get('/', async (req, res) => {
    try {
        const { estado } = req.query;
        const clientes = await prisma.clientes.findMany({
            where: estado ? { estado } : {},
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: clientes });
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
        res.json({ success: true, data: cliente });
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

        let slug = null;
        if (tipoDespliegue === 'tenant_corpsimtelec') {
            slug = await slugUnico(slugify(slugIn || nombreComercial));
        }

        let cliente = await prisma.clientes.create({
            data: {
                nombreComercial, razonSocial, contactoNombre, contactoEmail, contactoTelefono,
                tipoDespliegue,
                tipoEmpresa: tipoEmpresa || 'consorcio',
                ruc: ruc || null,
                slug,
                dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
                estado: estado || 'trial',
                aprovisionamiento: 'pendiente',
                trialInicioAt: trialInicioAt ? new Date(trialInicioAt) : null,
                trialExpiraAt: trialExpiraAt ? new Date(trialExpiraAt) : null,
                trialSoloLecturaHasta: trialSoloLecturaHasta ? new Date(trialSoloLecturaHasta) : null,
                notas,
                secretoControlPlane: crypto.randomBytes(32).toString('hex'),
            },
        });

        let avisoAprov;
        if (tipoDespliegue === 'tenant_corpsimtelec') {
            if (sujamTenants.configurado()) {
                cliente = await aprovisionarTenant(cliente);
                if (cliente.aprovisionamiento === 'error') avisoAprov = 'El cliente se creó pero falló el aprovisionamiento del tenant en SUJAM (ver notas). Reintentar con POST /:id/aprovisionar.';
            } else {
                avisoAprov = 'SUJAM_SUPERADMIN_URL/SECRET no configurados: el tenant no se aprovisionó automáticamente.';
            }
        }

        res.status(201).json({ success: true, data: cliente, avisoAprov });
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

        if (cliente.tipoDespliegue === 'tenant_corpsimtelec') {
            if (!cliente.slug) {
                await prisma.clientes.update({ where: { id: cliente.id }, data: { slug: await slugUnico(slugify(cliente.nombreComercial)) } });
            }
            const fresco = await prisma.clientes.findUnique({ where: { id: cliente.id } });
            const actualizado = await aprovisionarTenant(fresco);
            return res.json({ success: true, data: actualizado });
        }

        // marca_blanca: crea infraestructura REAL y facturable en Railway/Vercel.
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
        provisionarMarcaBlanca(fresco, { adminNombre: req.body.adminNombre }, (msg) => console.log(`[aprovisionar#${cliente.id}]`, msg))
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

// GET /api/clientes/:id/aprovisionamiento — consulta el estado real del tenant en SUJAM
router.get('/:id/aprovisionamiento', async (req, res) => {
    try {
        const cliente = await prisma.clientes.findUnique({ where: { id: parseInt(req.params.id, 10) } });
        if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        if (cliente.tipoDespliegue !== 'tenant_corpsimtelec' || !cliente.slug) {
            return res.json({ success: true, data: { aprovisionamiento: cliente.aprovisionamiento, remoto: null } });
        }
        const r = await sujamTenants.obtenerTenant(cliente.slug);
        let aprov = cliente.aprovisionamiento;
        if (r.ok && (r.data.estado === 'activo' || r.data.estado === 'solo_lectura')) aprov = 'listo';
        else if (r.ok && r.data.estado === 'error') aprov = 'error';
        if (aprov !== cliente.aprovisionamiento) {
            await prisma.clientes.update({ where: { id: cliente.id }, data: { aprovisionamiento: aprov } });
        }
        res.json({ success: true, data: { aprovisionamiento: aprov, remoto: r.ok ? r.data : { error: r.error } } });
    } catch (error) {
        console.error('GET /clientes/:id/aprovisionamiento:', error);
        res.status(500).json({ success: false, mensaje: 'Error al consultar aprovisionamiento' });
    }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
    try {
        const b = req.body;
        const dataToUpdate = {};
        for (const k of ['nombreComercial', 'razonSocial', 'contactoNombre', 'contactoEmail', 'contactoTelefono',
            'tipoDespliegue', 'tipoEmpresa', 'ruc', 'dominioFrontend', 'dominioBackend',
            'railwayProjectId', 'vercelProjectId', 'estado', 'notas']) {
            if (b[k] !== undefined) dataToUpdate[k] = b[k];
        }
        for (const k of ['trialInicioAt', 'trialExpiraAt', 'trialSoloLecturaHasta']) {
            if (b[k] !== undefined) dataToUpdate[k] = b[k] ? new Date(b[k]) : null;
        }

        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: dataToUpdate,
        });

        const bridge = await notificarEstado(cliente);
        res.json({
            success: true,
            data: cliente,
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
        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: { estado: 'activo', fechaActivacion: new Date() },
        });

        const bridge = await notificarEstado(cliente);
        res.json({
            success: true,
            data: cliente,
            avisoBridge: bridge.ok ? undefined : `Cliente actualizado, pero no se pudo notificar a su despliegue: ${bridge.error}`,
        });
    } catch (error) {
        console.error('PUT /clientes/:id/dar-de-alta:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.status(500).json({ success: false, mensaje: 'Error al dar de alta' });
    }
});

module.exports = router;
