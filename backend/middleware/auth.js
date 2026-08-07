const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Panel de super-admin: solo staff de CorpSimtelec. Sin lógica de trial ni
// de módulos por rol — eso vive en el backend de cada cliente, no aquí.
const proteger = async (req, res, next) => {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) {
            return res.status(401).json({ success: false, mensaje: 'No autorizado' });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const staff = await prisma.staff_usuarios.findUnique({
            where: { id: payload.id },
            select: { id: true, nombre: true, email: true, rol: true, activo: true },
        });

        if (!staff || !staff.activo) {
            return res.status(401).json({ success: false, mensaje: 'Cuenta no encontrada o inactiva' });
        }

        req.staff = staff;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, mensaje: 'Token inválido o expirado' });
    }
};

module.exports = { proteger };
