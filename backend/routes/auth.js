const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { proteger } = require('../middleware/auth');

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, mensaje: 'Email y contraseña requeridos' });
        }

        const staff = await prisma.staff_usuarios.findUnique({ where: { email } });
        if (!staff || !staff.activo) {
            return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
        }

        const passwordOk = await bcrypt.compare(password, staff.password);
        if (!passwordOk) {
            return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
        }

        const token = jwt.sign({ id: staff.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
        await prisma.staff_usuarios.update({ where: { id: staff.id }, data: { ultimoLogin: new Date() } });

        res.json({
            success: true,
            token,
            staff: { id: staff.id, nombre: staff.nombre, email: staff.email, rol: staff.rol },
        });
    } catch (error) {
        console.error('POST /auth/login:', error);
        res.status(500).json({ success: false, mensaje: 'Error al iniciar sesión' });
    }
});

router.get('/me', proteger, (req, res) => {
    res.json({ success: true, staff: req.staff });
});

module.exports = router;
