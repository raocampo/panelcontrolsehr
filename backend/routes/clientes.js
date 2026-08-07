const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger } = require('../middleware/auth');
const { notificarLicencia } = require('../utils/licenciaBridge');

router.use(proteger);

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
            tipoDespliegue, dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
            estado, trialInicioAt, trialExpiraAt, trialSoloLecturaHasta, notas,
        } = req.body;

        if (!nombreComercial || !tipoDespliegue) {
            return res.status(400).json({ success: false, mensaje: 'nombreComercial y tipoDespliegue son requeridos' });
        }

        const cliente = await prisma.clientes.create({
            data: {
                nombreComercial, razonSocial, contactoNombre, contactoEmail, contactoTelefono,
                tipoDespliegue, dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
                estado: estado || 'trial',
                trialInicioAt: trialInicioAt ? new Date(trialInicioAt) : null,
                trialExpiraAt: trialExpiraAt ? new Date(trialExpiraAt) : null,
                trialSoloLecturaHasta: trialSoloLecturaHasta ? new Date(trialSoloLecturaHasta) : null,
                notas,
                secretoControlPlane: crypto.randomBytes(32).toString('hex'),
            },
        });
        res.status(201).json({ success: true, data: cliente });
    } catch (error) {
        console.error('POST /clientes:', error);
        res.status(500).json({ success: false, mensaje: 'Error al crear cliente' });
    }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
    try {
        const {
            nombreComercial, razonSocial, contactoNombre, contactoEmail, contactoTelefono,
            tipoDespliegue, dominioFrontend, dominioBackend, railwayProjectId, vercelProjectId,
            estado, trialInicioAt, trialExpiraAt, trialSoloLecturaHasta, notas,
        } = req.body;

        const dataToUpdate = {};
        if (nombreComercial !== undefined) dataToUpdate.nombreComercial = nombreComercial;
        if (razonSocial !== undefined) dataToUpdate.razonSocial = razonSocial;
        if (contactoNombre !== undefined) dataToUpdate.contactoNombre = contactoNombre;
        if (contactoEmail !== undefined) dataToUpdate.contactoEmail = contactoEmail;
        if (contactoTelefono !== undefined) dataToUpdate.contactoTelefono = contactoTelefono;
        if (tipoDespliegue !== undefined) dataToUpdate.tipoDespliegue = tipoDespliegue;
        if (dominioFrontend !== undefined) dataToUpdate.dominioFrontend = dominioFrontend;
        if (dominioBackend !== undefined) dataToUpdate.dominioBackend = dominioBackend;
        if (railwayProjectId !== undefined) dataToUpdate.railwayProjectId = railwayProjectId;
        if (vercelProjectId !== undefined) dataToUpdate.vercelProjectId = vercelProjectId;
        if (estado !== undefined) dataToUpdate.estado = estado;
        if (trialInicioAt !== undefined) dataToUpdate.trialInicioAt = trialInicioAt ? new Date(trialInicioAt) : null;
        if (trialExpiraAt !== undefined) dataToUpdate.trialExpiraAt = trialExpiraAt ? new Date(trialExpiraAt) : null;
        if (trialSoloLecturaHasta !== undefined) dataToUpdate.trialSoloLecturaHasta = trialSoloLecturaHasta ? new Date(trialSoloLecturaHasta) : null;
        if (notas !== undefined) dataToUpdate.notas = notas;

        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: dataToUpdate,
        });

        const bridge = await notificarLicencia(cliente);
        res.json({
            success: true,
            data: cliente,
            avisoBridge: bridge.ok ? undefined : `Cliente actualizado, pero no se pudo notificar a su sistema real: ${bridge.error}`,
        });
    } catch (error) {
        console.error('PUT /clientes/:id:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.status(500).json({ success: false, mensaje: 'Error al actualizar cliente' });
    }
});

// PUT /api/clientes/:id/dar-de-alta — único gate humano real (Ronda 6): el
// cliente pagó, pasa de trial a activo.
router.put('/:id/dar-de-alta', async (req, res) => {
    try {
        const cliente = await prisma.clientes.update({
            where: { id: parseInt(req.params.id, 10) },
            data: { estado: 'activo', fechaActivacion: new Date() },
        });

        const bridge = await notificarLicencia(cliente);
        res.json({
            success: true,
            data: cliente,
            avisoBridge: bridge.ok ? undefined : `Cliente actualizado, pero no se pudo notificar a su sistema real: ${bridge.error}`,
        });
    } catch (error) {
        console.error('PUT /clientes/:id/dar-de-alta:', error);
        if (error.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
        res.status(500).json({ success: false, mensaje: 'Error al dar de alta' });
    }
});

module.exports = router;
