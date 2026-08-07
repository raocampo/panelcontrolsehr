require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5620;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({ ok: true, servicio: 'panel-control-sujam-backend' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/solicitudes', require('./routes/solicitudes'));

app.listen(PORT, () => {
    console.log('==================================================');
    console.log('🛠️  PANEL DE CONTROL SUJAM - BACKEND');
    console.log('==================================================');
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log('==================================================');
});
