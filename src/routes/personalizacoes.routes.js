import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { carregarConfigurador, validarConfiguracao, numeroInteiro } from "../services/personalizacoes.js"

const router = express.Router()
const apenasAdmin = (req, res, next) => req.usuario?.tipo === "admin" ? next() : res.status(403).json({ erro: "Acesso permitido somente para administradores" })
const responderErro = (res, erro) => res.status(erro.statusCode || 500).json({ erro: erro.message || "Erro interno" })
const corpo = req => req.body || {}
const normalizarVisual = valor => {
    if (valor == null) return null
    const visual = typeof valor === "string" ? (() => {
        try { return JSON.parse(valor) } catch { return null }
    })() : valor
    if (!visual || typeof visual !== "object" || Array.isArray(visual)) {
        throw Object.assign(new Error("Visual deve ser um objeto JSON válido"), { statusCode: 400 })
    }
    return visual
}

async function responderConfigurador(req, res) {
    try {
        const dados = await carregarConfigurador(req.params.id)
        res.json({
            produto: {
                ...dados.produto,
                precoBase: Number(dados.produto.preco),
                personalizavel: Boolean(dados.produto.personalizavel)
            },
            configurador: {
                ...dados.configurador,
                quantidadeAngulos: Number(dados.configurador.quantidade_angulos),
                imagens: dados.imagens.filter(item => item.tipo === "base" || item.tipo === "angulo")
            },
            personalizacoes: dados.personalizacoes.filter(item => item.ativo).map(item => ({
                ...item,
                opcoes: item.opcoes.filter(opcao => opcao.ativo).map(opcao => ({
                    ...opcao,
                    valorAdicional: Number(opcao.valor_adicional),
                    imagens: opcao.imagens
                }))
            })),
            regras: dados.regras
        })
    } catch (erro) { responderErro(res, erro) }
}

router.get("/:id/configurador", responderConfigurador)
router.get("/:id/personalizacao", responderConfigurador)

router.get("/:id/personalizacao/opcoes", async (req, res) => {
    try { const dados = await carregarConfigurador(req.params.id); res.json(dados.personalizacoes.filter(item => item.ativo).flatMap(item => item.opcoes.filter(opcao => opcao.ativo).map(opcao => ({ ...opcao, personalizacaoId: item.id, valorAdicional: Number(opcao.valor_adicional) })))) } catch (erro) { responderErro(res, erro) }
})

router.post("/:id/personalizacao/calcular", async (req, res) => {
    try { res.json(await validarConfiguracao(req.params.id, corpo(req).configuracao)) } catch (erro) { responderErro(res, erro) }
})
router.post("/:id/configurador/calcular", async (req, res) => {
    try {
        const dados = corpo(req)
        const configuracao = dados.configuracao || { ...(dados.opcoes || {}), ...(dados.gravacao == null ? {} : { gravacao: dados.gravacao }) }
        res.json(await validarConfiguracao(req.params.id, configuracao))
    } catch (erro) { responderErro(res, erro) }
})
router.post("/:id/personalizacao/validar", async (req, res) => {
    try { res.json({ valido: true, ...await validarConfiguracao(req.params.id, corpo(req).configuracao) }) } catch (erro) { responderErro(res, erro) }
})

router.use("/admin", autenticarToken, apenasAdmin)
router.put("/admin/:id/configurador", async (req, res) => {
    try {
        const produtoId = numeroInteiro(req.params.id, "Produto")
        const ativo = req.body.ativo ? 1 : 0
        const quantidade = Number(req.body.quantidade_angulos ?? req.body.quantidadeAngulos ?? 1)
        if (!Number.isSafeInteger(quantidade) || quantidade < 1) return res.status(400).json({ erro: "Quantidade de ângulos inválida" })
        await db.query("INSERT INTO produto_configuradores (produto_id, ativo, quantidade_angulos) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ativo = VALUES(ativo), quantidade_angulos = VALUES(quantidade_angulos)", [produtoId, ativo, quantidade])
        res.json({ mensagem: "Configurador atualizado", ativo: Boolean(ativo), quantidadeAngulos: quantidade })
    } catch (erro) { responderErro(res, erro) }
})
router.post("/admin/:id/configurador/imagens", upload.single("imagem"), async (req, res) => {
    try {
        const produtoId = numeroInteiro(req.params.id, "Produto")
        if (!req.file) return res.status(400).json({ erro: "Imagem obrigatória" })
        const tipo = ["base", "angulo"].includes(req.body.tipo) ? req.body.tipo : null
        const angulo = req.body.angulo == null || req.body.angulo === "" ? null : Number(req.body.angulo)
        if (!tipo || (tipo === "angulo" && (!Number.isSafeInteger(angulo) || angulo < 1))) return res.status(400).json({ erro: "Tipo ou ângulo inválido" })
        const [produto] = await db.query("SELECT id FROM produtos WHERE id = ?", [produtoId])
        if (!produto.length) return res.status(404).json({ erro: "Produto não encontrado" })
        const [resultado] = await db.query("INSERT INTO produto_configurador_imagens (produto_id, tipo, angulo, url, ordem) VALUES (?, ?, ?, ?, ?)", [produtoId, tipo, angulo, `/uploads/${req.file.filename}`, Number(req.body.ordem) || 0])
        res.status(201).json({ id: resultado.insertId, url: `/uploads/${req.file.filename}` })
    } catch (erro) { responderErro(res, erro) }
})
router.post("/admin/opcoes/:opcaoId/imagens", upload.single("imagem"), async (req, res) => {
    try {
        const opcaoId = numeroInteiro(req.params.opcaoId, "Opção")
        if (!req.file) return res.status(400).json({ erro: "Imagem obrigatória" })
        const modo = ["final", "camada"].includes(req.body.modo) ? req.body.modo : null
        const angulo = req.body.angulo == null || req.body.angulo === "" ? null : Number(req.body.angulo)
        if (!modo || (modo === "camada" && (!Number.isSafeInteger(angulo) || angulo < 1))) return res.status(400).json({ erro: "Modo ou ângulo inválido" })
        const [opcao] = await db.query("SELECT id FROM produto_personalizacao_opcoes WHERE id = ?", [opcaoId])
        if (!opcao.length) return res.status(404).json({ erro: "Opção não encontrada" })
        const [resultado] = await db.query("INSERT INTO produto_personalizacao_imagens (opcao_id, modo, angulo, url, ordem) VALUES (?, ?, ?, ?, ?)", [opcaoId, modo, angulo, `/uploads/${req.file.filename}`, Number(req.body.ordem) || 0])
        res.status(201).json({ id: resultado.insertId, url: `/uploads/${req.file.filename}` })
    } catch (erro) { responderErro(res, erro) }
})
router.patch("/admin/configurador-imagens/:imagemId", async (req, res) => {
    try {
        const id = numeroInteiro(req.params.imagemId, "Imagem")
        const [resultado] = await db.query("UPDATE produto_configurador_imagens SET ordem = COALESCE(?, ordem), ativo = COALESCE(?, ativo) WHERE id = ?", [req.body.ordem == null ? null : Number(req.body.ordem), req.body.ativo == null ? null : (req.body.ativo ? 1 : 0), id])
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Imagem não encontrada" })
        res.json({ mensagem: "Imagem atualizada" })
    } catch (erro) { responderErro(res, erro) }
})
router.delete("/admin/configurador-imagens/:imagemId", async (req, res) => {
    try {
        const [resultado] = await db.query("DELETE FROM produto_configurador_imagens WHERE id = ?", [numeroInteiro(req.params.imagemId, "Imagem")])
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Imagem não encontrada" })
        res.json({ mensagem: "Imagem removida" })
    } catch (erro) { responderErro(res, erro) }
})
router.patch("/admin/opcao-imagens/:imagemId", async (req, res) => {
    try {
        const id = numeroInteiro(req.params.imagemId, "Imagem")
        const [resultado] = await db.query("UPDATE produto_personalizacao_imagens SET ordem = COALESCE(?, ordem), ativo = COALESCE(?, ativo) WHERE id = ?", [req.body.ordem == null ? null : Number(req.body.ordem), req.body.ativo == null ? null : (req.body.ativo ? 1 : 0), id])
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Imagem não encontrada" })
        res.json({ mensagem: "Imagem atualizada" })
    } catch (erro) { responderErro(res, erro) }
})
router.delete("/admin/opcao-imagens/:imagemId", async (req, res) => {
    try {
        const [resultado] = await db.query("DELETE FROM produto_personalizacao_imagens WHERE id = ?", [numeroInteiro(req.params.imagemId, "Imagem")])
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Imagem não encontrada" })
        res.json({ mensagem: "Imagem removida" })
    } catch (erro) { responderErro(res, erro) }
})
router.get("/admin/:id/personalizacoes", async (req, res) => {
    try { const dados = await carregarConfigurador(req.params.id); res.json(dados.personalizacoes) } catch (erro) { responderErro(res, erro) }
})
router.post("/admin/:id/personalizacoes", async (req, res) => {
    try { const produtoId = numeroInteiro(req.params.id, "Produto"); const { nome, slug, tipo = "select", obrigatoria = false, permite_valor_livre = false, valor_livre_maximo = 255, ordem = 0 } = corpo(req); if (!nome) return res.status(400).json({ erro: "Nome é obrigatório" }); const [resultado] = await db.query("INSERT INTO produto_personalizacoes (produto_id, nome, slug, tipo, obrigatoria, permite_valor_livre, valor_livre_maximo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [produtoId, nome, slug || nome.toLowerCase().replace(/[^a-z0-9]+/g, "-"), tipo, obrigatoria ? 1 : 0, permite_valor_livre ? 1 : 0, Number(valor_livre_maximo), Number(ordem)]); res.status(201).json({ id: resultado.insertId }) } catch (erro) { responderErro(res, erro) }
})
router.put("/admin/personalizacoes/:personalizacaoId", async (req, res) => {
    try { const id = numeroInteiro(req.params.personalizacaoId, "Personalização"); const { nome, slug, tipo, obrigatoria, permite_valor_livre, valor_livre_maximo, ordem, ativo } = corpo(req); const [resultado] = await db.query("UPDATE produto_personalizacoes SET nome = COALESCE(?, nome), slug = COALESCE(?, slug), tipo = COALESCE(?, tipo), obrigatoria = COALESCE(?, obrigatoria), permite_valor_livre = COALESCE(?, permite_valor_livre), valor_livre_maximo = COALESCE(?, valor_livre_maximo), ordem = COALESCE(?, ordem), ativo = COALESCE(?, ativo) WHERE id = ?", [nome ?? null, slug ?? null, tipo ?? null, obrigatoria == null ? null : (obrigatoria ? 1 : 0), permite_valor_livre == null ? null : (permite_valor_livre ? 1 : 0), valor_livre_maximo == null ? null : Number(valor_livre_maximo), ordem == null ? null : Number(ordem), ativo == null ? null : (ativo ? 1 : 0), id]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Personalização não encontrada" }); res.json({ mensagem: "Personalização atualizada" }) } catch (erro) { responderErro(res, erro) }
})
router.delete("/admin/personalizacoes/:personalizacaoId", async (req, res) => {
    try { const [resultado] = await db.query("DELETE FROM produto_personalizacoes WHERE id = ?", [numeroInteiro(req.params.personalizacaoId, "Personalização")]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Personalização não encontrada" }); res.json({ mensagem: "Personalização removida" }) } catch (erro) { responderErro(res, erro) }
})
router.post("/admin/personalizacoes/:personalizacaoId/opcoes", async (req, res) => {
    try { const id = numeroInteiro(req.params.personalizacaoId, "Personalização"); const { nome, descricao, valor_adicional = 0, ordem = 0, codigo_interno, estoque, visual } = corpo(req); if (!nome || !Number.isFinite(Number(valor_adicional)) || Number(valor_adicional) < 0) return res.status(400).json({ erro: "Nome e valor adicional válido são obrigatórios" }); const [resultado] = await db.query("INSERT INTO produto_personalizacao_opcoes (personalizacao_id, nome, descricao, valor_adicional, ordem, codigo_interno, estoque, visual) SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM produto_personalizacoes WHERE id = ?", [id, nome, descricao || null, Number(valor_adicional), Number(ordem), codigo_interno || null, estoque == null ? null : Number(estoque), JSON.stringify(normalizarVisual(visual)), id]); if (!resultado.insertId) return res.status(404).json({ erro: "Personalização não encontrada" }); res.status(201).json({ id: resultado.insertId }) } catch (erro) { responderErro(res, erro) }
})
router.put("/admin/personalizacoes/:personalizacaoId/opcoes/:opcaoId", async (req, res) => {
    try { const id = numeroInteiro(req.params.opcaoId, "Opção"); const dados = corpo(req); const [resultado] = await db.query("UPDATE produto_personalizacao_opcoes SET nome = COALESCE(?, nome), descricao = COALESCE(?, descricao), valor_adicional = COALESCE(?, valor_adicional), ordem = COALESCE(?, ordem), codigo_interno = COALESCE(?, codigo_interno), estoque = COALESCE(?, estoque), visual = COALESCE(?, visual), ativo = COALESCE(?, ativo) WHERE id = ? AND personalizacao_id = ?", [dados.nome ?? null, dados.descricao ?? null, dados.valor_adicional == null ? null : Number(dados.valor_adicional), dados.ordem == null ? null : Number(dados.ordem), dados.codigo_interno ?? null, dados.estoque == null ? null : Number(dados.estoque), dados.visual == null ? null : JSON.stringify(normalizarVisual(dados.visual)), dados.ativo == null ? null : (dados.ativo ? 1 : 0), id, numeroInteiro(req.params.personalizacaoId, "Personalização")]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Opção não encontrada" }); res.json({ mensagem: "Opção atualizada" }) } catch (erro) { responderErro(res, erro) }
})
router.delete("/admin/personalizacoes/:personalizacaoId/opcoes/:opcaoId", async (req, res) => {
    try { const [resultado] = await db.query("DELETE FROM produto_personalizacao_opcoes WHERE id = ? AND personalizacao_id = ?", [numeroInteiro(req.params.opcaoId, "Opção"), numeroInteiro(req.params.personalizacaoId, "Personalização")]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Opção não encontrada" }); res.json({ mensagem: "Opção removida" }) } catch (erro) { responderErro(res, erro) }
})
router.post("/admin/:id/regras", async (req, res) => {
    try { const produtoId = numeroInteiro(req.params.id, "Produto"); const { regra, mensagem } = corpo(req); if (!regra || typeof regra !== "object") return res.status(400).json({ erro: "Regra estruturada é obrigatória" }); const [resultado] = await db.query("INSERT INTO produto_personalizacao_regras (produto_id, regra, mensagem) VALUES (?, ?, ?)", [produtoId, JSON.stringify(regra), mensagem || null]); res.status(201).json({ id: resultado.insertId }) } catch (erro) { responderErro(res, erro) }
})
router.put("/admin/regras/:regraId", async (req, res) => {
    try { const id = numeroInteiro(req.params.regraId, "Regra"); const { regra, mensagem, ativo } = corpo(req); const [resultado] = await db.query("UPDATE produto_personalizacao_regras SET regra = COALESCE(?, regra), mensagem = COALESCE(?, mensagem), ativo = COALESCE(?, ativo) WHERE id = ?", [regra ? JSON.stringify(regra) : null, mensagem ?? null, ativo == null ? null : (ativo ? 1 : 0), id]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Regra não encontrada" }); res.json({ mensagem: "Regra atualizada" }) } catch (erro) { responderErro(res, erro) }
})
router.delete("/admin/regras/:regraId", async (req, res) => {
    try { const [resultado] = await db.query("DELETE FROM produto_personalizacao_regras WHERE id = ?", [numeroInteiro(req.params.regraId, "Regra")]); if (!resultado.affectedRows) return res.status(404).json({ erro: "Regra não encontrada" }); res.json({ mensagem: "Regra removida" }) } catch (erro) { responderErro(res, erro) }
})

export default router