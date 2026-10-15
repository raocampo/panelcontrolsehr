const DIA = 86400000;

function fechasTrial(datos = {}, ahora = new Date()) {
    const inicio = datos.trialInicioAt ? new Date(datos.trialInicioAt) : new Date(ahora);
    const expira = datos.trialExpiraAt ? new Date(datos.trialExpiraAt) : new Date(inicio.getTime() + 30 * DIA);
    const gracia = datos.trialSoloLecturaHasta ? new Date(datos.trialSoloLecturaHasta) : new Date(expira.getTime() + 10 * DIA);
    if (![inicio, expira, gracia].every((f) => Number.isFinite(f.getTime())) || expira <= inicio || gracia < expira) {
        throw new Error('Fechas de trial inválidas: inicio < expiración <= fin de solo lectura');
    }
    return { trialInicioAt: inicio, trialExpiraAt: expira, trialSoloLecturaHasta: gracia };
}

module.exports = { fechasTrial };
