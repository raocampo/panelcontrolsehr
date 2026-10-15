const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const passwordError = value => typeof value !== 'string' || value.length < 10 || Buffer.byteLength(value, 'utf8') > 72
    ? 'La contraseña debe tener entre 10 y 72 bytes.' : null;
function newPassword() { return `${crypto.randomBytes(18).toString('base64url')}aA1!`; }
function validHash(value) { return typeof value === 'string' && /^\$2[aby]\$(10|11|12)\$[./A-Za-z0-9]{53}$/.test(value); }
async function initialCredential(password) {
    const clear = password || newPassword();
    const error = passwordError(clear);
    if (error) throw new Error(error);
    return { password: clear, hash: await bcrypt.hash(clear, 10) };
}
module.exports = { passwordError, newPassword, validHash, initialCredential };
