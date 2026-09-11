// ====================================
// reaper — mantiene el estado del panel en línea con el vencimiento del trial
// ====================================
// El bloqueo REAL ya lo hace cada instancia/tenant de SUJAM por sí sola
// (backend/middleware/auth.js allá, con las fechas de trial de sus propios
// usuarios). Esto es solo para que el panel no muestre "trial" indefinidamente
// cuando ya venció la gracia — actualiza el estado visible y, de paso,
// reintenta el aprovisionamiento de tenants que quedaron en 'error'.
// ====================================

const prisma = require('../config/prisma');
const sujamTenants = require('../utils/sujamTenants');

async function correrUnaVez() {
    const ahora = new Date();
    try {
        const vencidos = await prisma.clientes.updateMany({
            where: { estado: 'trial', trialSoloLecturaHasta: { lt: ahora } },
            data: { estado: 'bloqueado' },
        });
        if (vencidos.count > 0) {
            console.log(`[reaper] ${vencidos.count} cliente(s) trial pasaron a bloqueado (gracia vencida)`);
        }
    } catch (err) {
        console.error('[reaper] error actualizando estados vencidos:', err.message);
    }

    if (!sujamTenants.configurado()) return;
    try {
        const enError = await prisma.clientes.findMany({
            where: { tipoDespliegue: 'tenant_corpsimtelec', aprovisionamiento: 'aprovisionando' },
        });
        for (const c of enError) {
            if (!c.slug) continue;
            const r = await sujamTenants.obtenerTenant(c.slug);
            if (r.ok && (r.data.estado === 'activo' || r.data.estado === 'solo_lectura')) {
                await prisma.clientes.update({ where: { id: c.id }, data: { aprovisionamiento: 'listo' } });
                console.log(`[reaper] tenant "${c.slug}" confirmado listo`);
            } else if (r.ok && r.data.estado === 'error') {
                await prisma.clientes.update({ where: { id: c.id }, data: { aprovisionamiento: 'error' } });
            }
        }
    } catch (err) {
        console.error('[reaper] error verificando aprovisionamientos:', err.message);
    }
}

function iniciarReaper(intervaloMs = 60 * 60 * 1000) {
    correrUnaVez();
    const t = setInterval(correrUnaVez, intervaloMs);
    t.unref?.();
    return t;
}

module.exports = { iniciarReaper, correrUnaVez };
