import express from "express"
import { autenticarToken } from "../middlewares/autenticacao.js"
import db from "../database.js"
import { mpPayment, pagamentoMock } from "../services/mercadopago.js"
import { atualizarConfiguracoes, buscarConfiguracoes, statusEfetivoLoja } from "../services/configuracoes.js"

const router = express.Router()

function apenasAdmin(req, res, next) {
    if (req.usuario?.tipo !== "admin") return res.status(403).json({ erro: "Acesso permitido somente para administradores" })
    next()
}

router.use(autenticarToken, apenasAdmin)

router.get("/", async (req, res) => {
    try { return res.json(await buscarConfiguracoes()) }
    catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao carregar configurações" }) }
})

router.put("/", async (req, res) => {
    try {
        const alteradas = await atualizarConfiguracoes(req.body.configuracoes || req.body, req.usuario.id)
        return res.json({ mensagem: "Configurações atualizadas com sucesso", alteradas, configuracoes: await buscarConfiguracoes() })
    } catch (error) {
        console.error(error)
        const status = /inválido|posterior/.test(error.message) ? 400 : 500
        return res.status(status).json({ erro: status === 400 ? error.message : "Não foi possível salvar as configurações" })
    }
})

router.get("/status", async (req, res) => {
    try { return res.json(await statusEfetivoLoja()) }
    catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao carregar status da loja" }) }
})

router.put("/status", async (req, res) => {
    const status = String(req.body.status || "").toLowerCase()
    if (!["online", "maintenance", "closed"].includes(status)) return res.status(400).json({ erro: "Status inválido" })
    try {
        await atualizarConfiguracoes({ store_status: status }, req.usuario.id)
        return res.json({ mensagem: "Status da loja atualizado", ...(await statusEfetivoLoja()) })
    } catch (error) { console.error(error); return res.status(400).json({ erro: error.message }) }
})

router.get("/alertas", async (req, res) => {
    try {
        const configuracoes = await buscarConfiguracoes()
        const [baixoEstoque] = await db.query(`SELECT id, nome, estoque, estoque_minimo FROM produtos WHERE ativo = 1 AND estoque > 0 AND estoque <= COALESCE(estoque_minimo, ?) ORDER BY estoque`, [configuracoes.stock_minimum || 0])
        const [esgotados] = await db.query(`SELECT id, nome FROM produtos WHERE ativo = 1 AND estoque <= 0 ORDER BY nome`)
        return res.json({ alertas: { baixoEstoque, esgotados, mercadoPagoTeste: configuracoes.payment_environment === "sandbox", emailAdministrativoAusente: !configuracoes.store_email } })
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao carregar alertas" }) }
})

router.post("/testar-pagamento", async (req, res) => {
    try {
        if (pagamentoMock) return res.json({ conectado: true, ambiente: "mock", mensagem: "Pagamento configurado em modo simulado" })
        await mpPayment.get({ id: "0" })
        return res.json({ conectado: true, ambiente: "mercadopago" })
    } catch (error) {
        const status = error?.status || error?.statusCode
        return res.status(502).json({ conectado: false, ambiente: "mercadopago", statusGateway: status || null, erro: "Não foi possível validar a conexão com o Mercado Pago" })
    }
})

router.get("/historico", async (req, res) => {
    try {
        const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200)
        const [historico] = await db.query(`SELECT h.*, u.nome AS usuario_nome FROM historico_configuracoes h LEFT JOIN usuarios u ON u.id = h.usuario_id ORDER BY h.criado_em DESC LIMIT ?`, [limite])
        return res.json(historico)
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao carregar histórico" }) }
})

export default router
