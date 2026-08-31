
import dotEnv from "dotenv"
dotEnv.config()

import mysql from "mysql2/promise"

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
})

export async function garantirEstruturaBanco() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS notificacoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NULL,
            pedido_id INT NULL,
            tipo VARCHAR(50) NOT NULL DEFAULT 'pedido',
            mensagem TEXT NOT NULL,
            lida BOOLEAN NOT NULL DEFAULT FALSE,
            criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_notificacoes_usuario (usuario_id),
            INDEX idx_notificacoes_pedido (pedido_id),
            INDEX idx_notificacoes_lida (lida),
            INDEX idx_notificacoes_criado_em (criado_em)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
}

export default db