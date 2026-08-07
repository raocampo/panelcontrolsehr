const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const prisma = require('../config/prisma');
const { proteger } = require('../middleware/auth');

// GET /api/solicitudes — uso interno del staff
router.get('/', proteger, async (req, res) => {
    try {
        const { estado } = req.query;
        const solicitudes = await prisma.solicitudes.findMany({
            where: estado ? { estado } : {},
            orderBy: { createdAt: 'desc' },
            include: { cliente: { select: { id: true, nombreComercial: true } } },
        });
        res.json({ success: true, data: solicitudes });
    } catch (error) {
        console.error('GET /solicitudes:', error);
        res.status(500).json({ success: false, mensaje: 'Error al listar solicitudes' });
    }
});

// POST /api/solicitudes — pública (Fase 3: formulario de solicitud, sin
// sesión). Solo crea una fila para revisión manual del staff, nunca una
// cuenta ni acceso real — por eso el riesgo de dejarla sin auth es bajo,
// pero igual se protege contra spam con rate limit + honeypot.
const limiteSolicitudes = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, mensaje: 'Demasiadas solicitudes. Intente de nuevo más tarde.' },
});

router.post('/', limiteSolicitudes, async (req, res) => {
    try {
        const { nombreSolicitante, empresa, email, telefono, tipoCliente, mensaje, sitioWeb } = req.body;

        // Honeypot: campo oculto que un humano nunca llena. Si viene con
        // contenido, es un bot — se responde éxito sin crear el registro,
        // para no delatar el mecanismo de defensa.
        if (sitioWeb) {
            return res.status(201).json({ success: true, mensaje: 'Solicitud recibida' });
        }

        if (!nombreSolicitante || !email) {
            return res.status(400).json({ success: false, mensaje: 'nombreSolicitante y email son requeridos' });
        }
        const solicitud = await prisma.solicitudes.create({
            data: { nombreSolicitante, empresa, email, telefono, tipoCliente, mensaje },
        });
        res.status(201).json({ success: true, data: solicitud });
    } catch (error) {
        console.error('POST /solicitudes:', error);
        res.status(500).json({ success: false, mensaje: 'Error al crear solicitud' });
    }
});

// PUT /api/solicitudes/:id — uso interno del staff
router.put('/:id', proteger, async (req, res) => {
    try {
        const { estado, clienteId } = req.body;
        const dataToUpdate = {};
        if (estado !== undefined) dataToUpdate.estado = estado;
        if (clienteId !== undefined) dataToUpdate.clienteId = clienteId ? parseInt(clienteId, 10) : null;

        const solicitud = await prisma.solicitudes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: dataToUpdate,
        });
        res.json({ success: true, data: solicitud });
    } catch (error) {
        console.error('PUT /solicitudes/:id:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Solicitud no encontrada' });
        res.status(500).json({ success: false, mensaje: 'Error al actualizar solicitud' });
    }
});

module.exports = router;
