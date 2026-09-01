import jwt from "jsonwebtoken"
import { statusEfetivoLoja } from "../services/configuracoes.js"

function usuarioAdmin(req) {
    try {
        const [tipo, token] = String(req.headers.authorization || "").split(" ")
        if (tipo !== "Bearer" || !token) return false
        return jwt.verify(token, process.env.JWT_SECRET)?.tipo === "admin"
    } catch {
        return false
    }
}

export async function verificarStatusLoja(req, res, next) {
    try {
        const caminho = req.path || ""
        const rotaPublica = caminho === "/status-loja" || caminho === "/usuarios/login" || caminho === "/api/status-loja" || caminho === "/api/usuarios/login"
        if (rotaPublica) return next()
        const { status, configuracoes } = await statusEfetivoLoja()
        req.statusLoja = status
        if (usuarioAdmin(req)) return next()
        if (status === "maintenance") {
            return res.status(503).json({
                erro: "A loja está em manutenção",
                status,
                titulo: configuracoes.maintenance_title,
                mensagem: configuracoes.maintenance_message,
                imagem: configuracoes.maintenance_image,
                retorno: configuracoes.maintenance_end,
                contador: configuracoes.maintenance_countdown
            })
        }
        if (status === "closed") {
            return res.status(503).json({
                erro: "A loja está fechada para novas operações",
                status,
                mensagem: configuracoes.closed_message || "Voltaremos em breve."
            })
        }
        next()
    } catch (error) {
        console.error("ERRO AO VERIFICAR STATUS DA LOJA:", error)
        next()
    }
}
