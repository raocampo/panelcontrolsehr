import { useState } from 'react';
import api from '../services/api';

const vacio = {
  nombreSolicitante: '', empresa: '', email: '', telefono: '', tipoCliente: 'especialista', mensaje: '',
  sitioWeb: '', // honeypot — un campo oculto que un humano nunca llena
};

export default function SolicitudPublica() {
  const [form, setForm] = useState(vacio);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (campo) => (e) => setForm((p) => ({ ...p, [campo]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      await api.post('/solicitudes', form);
      setEnviado(true);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo enviar la solicitud. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="pantalla-centrada">
        <div className="tarjeta-login">
          <h1>¡Gracias!</h1>
          <p className="subtitulo">Recibimos tu solicitud. Nuestro equipo se pondrá en contacto contigo pronto.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pantalla-centrada">
      <form className="tarjeta-login tarjeta-solicitud" onSubmit={handleSubmit}>
        <h1>Solicitar acceso</h1>
        <p className="subtitulo">Contanos sobre tu consultorio, centro o institución.</p>
        {error && <div className="mensaje-error">{error}</div>}

        <label>Nombre *
          <input value={form.nombreSolicitante} onChange={handleChange('nombreSolicitante')} required autoFocus />
        </label>
        <label>Empresa / institución
          <input value={form.empresa} onChange={handleChange('empresa')} />
        </label>
        <label>Email *
          <input type="email" value={form.email} onChange={handleChange('email')} required />
        </label>
        <label>Teléfono
          <input value={form.telefono} onChange={handleChange('telefono')} />
        </label>
        <label>Tipo de cliente
          <select value={form.tipoCliente} onChange={handleChange('tipoCliente')}>
            <option value="especialista">Especialista independiente</option>
            <option value="consorcio">Consorcio / centro médico</option>
            <option value="institucion_salud">Institución de salud</option>
          </select>
        </label>
        <label>Mensaje
          <textarea rows={3} value={form.mensaje} onChange={handleChange('mensaje')} />
        </label>

        {/* Honeypot — oculto para personas, visible para bots que llenan todos los campos */}
        <label className="campo-honeypot" aria-hidden="true">
          Sitio web
          <input tabIndex={-1} autoComplete="off" value={form.sitioWeb} onChange={handleChange('sitioWeb')} />
        </label>

        <button type="submit" disabled={enviando}>{enviando ? 'Enviando...' : 'Enviar solicitud'}</button>
      </form>
    </div>
  );
}
