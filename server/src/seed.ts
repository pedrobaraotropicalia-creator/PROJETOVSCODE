import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './db';
const email = (process.env.ADMIN_EMAIL || 'dono@empresa.com').toLowerCase();
const exists = db.prepare('SELECT id FROM usuarios WHERE email=?').get(email);
if (!exists) db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run('Dono do sistema', email, bcrypt.hashSync('TroqueEssaSenha123', 10), 'dono');
console.log(`Usuário dono preparado: ${email}`);
