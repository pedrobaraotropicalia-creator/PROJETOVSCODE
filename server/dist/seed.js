"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./db");
const email = (process.env.ADMIN_EMAIL || 'pedrobaraotropicalia@gmail.com').toLowerCase();
const exists = db_1.db.prepare('SELECT id FROM usuarios WHERE email=?').get(email);
if (!exists)
    db_1.db.prepare('INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES (?,?,?,?)').run('Dono do sistema', email, bcryptjs_1.default.hashSync('Pedro14785*', 10), 'dono');
console.log(`Usuário dono preparado: ${email}`);
