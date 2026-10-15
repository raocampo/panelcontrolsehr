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

const permisos = {
    gestionar_clientes: ['super_admin', 'admin', 'soporte', 'comercial'],
    gestionar_accesos: ['super_admin', 'admin', 'soporte'],
    gestionar_infraestructura: ['super_admin', 'admin'],
};
const permitir = permiso => (req, res, next) => permisos[permiso]?.includes(req.staff?.rol)
    ? next() : res.status(403).json({ success: false, mensaje: 'Su cuenta no tiene permiso para realizar esta operación.' });
module.exports = { proteger, permitir };
