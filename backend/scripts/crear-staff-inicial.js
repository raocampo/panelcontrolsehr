// Crea el primer usuario del panel (no hay registro público — es interno).
// Uso: node scripts/crear-staff-inicial.js --nombre="Nombre" --email=x@x.com --password=Clave1234
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

function leerArgs() {
    const args = {};
    process.argv.slice(2).forEach((arg) => {
        const match = arg.match(/^--([^=]+)=(.*)$/);
        if (match) args[match[1]] = match[2];
    });
    return args;
}

async function main() {
    const { nombre, email, password } = leerArgs();
    if (!nombre || !email || !password) {
        console.error('Uso: node scripts/crear-staff-inicial.js --nombre="Nombre" --email=x@x.com --password=Clave1234');
        process.exit(1);
    }

    const existente = await prisma.staff_usuarios.findUnique({ where: { email } });
    if (existente) {
        console.error(`Ya existe un staff con email ${email}`);
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    const staff = await prisma.staff_usuarios.create({
        data: { nombre, email, password: hash, rol: 'super_admin' },
    });

    console.log(`✅ Staff creado: ${staff.email} (id ${staff.id})`);
    process.exit(0);
}

main().catch((error) => {
    console.error('Error al crear staff inicial:', error);
    process.exit(1);
});
