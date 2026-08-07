// Notifica a la instancia real de SUJAM de un cliente el estado de su
// licencia (activo/bloqueado). Si el cliente aún no tiene dominioBackend
// (no desplegado) o la instancia no responde, no revienta — el estado en
// el panel sigue siendo la fuente de verdad, esto es solo el mensajero.
async function notificarLicencia(cliente) {
    if (!cliente.dominioBackend) return { ok: true, omitido: true };

    const estado = ['bloqueado', 'cancelado'].includes(cliente.estado) ? 'bloqueado' : 'activo';

    try {
        const respuesta = await fetch(`${cliente.dominioBackend.replace(/\/$/, '')}/api/admin/licencia`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-control-plane-secret': cliente.secretoControlPlane || '',
            },
            body: JSON.stringify({ estado, motivo: `estado del cliente cambiado a "${cliente.estado}" desde el panel` }),
            signal: AbortSignal.timeout(5000),
        });

        if (!respuesta.ok) {
            return { ok: false, error: `HTTP ${respuesta.status}` };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

module.exports = { notificarLicencia };
