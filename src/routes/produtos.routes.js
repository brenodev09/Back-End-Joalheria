import express from "express"
import db from "../database.js"
import upload from "../../config/multer.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import { apenasAdmin } from "../middlewares/autorizacao.js"
import { carregarConfigurador, serializarProdutoPublico, normalizarBoolean } from "../services/personalizacoes.js"

const router = express.Router()

router.get("/", async (req, res) => {
    try {
        const [produtos] = await db.query(`SELECT p.*, c.nome AS categoria, m.nome AS material FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id LEFT JOIN materiais m ON m.id = p.material_id ORDER BY p.id DESC`)
        const produtosPublicos = await Promise.all(produtos.map(async produto => {
            if (!normalizarBoolean(produto.personalizavel)) {
                return { ...produto, personalizavel: false, configurador: { ativo: 0, quantidadeAngulos: 1, imagens: [] }, personalizacoes: [], regras: [], variacoes: [] }
            }

            try {
                const configurador = await carregarConfigurador(produto.id)
                return serializarProdutoPublico(produto, [], configurador)
            } catch (erro) {
                return { ...produto, personalizavel: normalizarBoolean(produto.personalizavel), configurador: { ativo: 0, quantidadeAngulos: 1, imagens: [] }, personalizacoes: [], regras: [], variacoes: [] }
            }
        }))
        return res.json(produtosPublicos)
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao listar produtos" }) }
})

router.get("/destaques", async (req, res) => {
    try {
        const [produtos] = await db.query(`SELECT p.*, c.nome AS categoria FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE p.destaque = true AND p.ativo = true LIMIT 8`)
        return res.json(produtos)
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao buscar destaques" }) }
})

router.get("/:id", async (req, res) => {
    try {
        const [produto] = await db.query(`SELECT p.*, c.nome AS categoria, m.nome AS material FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id LEFT JOIN materiais m ON m.id = p.material_id WHERE p.id = ?`, [req.params.id])
        if (!produto.length) return res.status(404).json({ erro: "Produto não encontrado" })
        const [variacoes] = await db.query("SELECT id, tipo, valor, preco, estoque FROM produto_variacoes WHERE produto_id = ? ORDER BY id", [req.params.id])

        produto[0].personalizavel = normalizarBoolean(produto[0].personalizavel)

        let configurador = null
        if (produto[0].personalizavel) {
            try {
                configurador = await carregarConfigurador(req.params.id)
            } catch (erro) {
                if (erro.statusCode !== 404 && erro.statusCode !== 422) throw erro
            }
        }

        return res.json(serializarProdutoPublico(produto[0], variacoes, configurador))
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao buscar produto" }) }
})

router.post("/", autenticarToken, apenasAdmin, upload.single("imagem"), async (req, res) => {
    try {
        const { nome, descricao, preco, estoque, estoque_minimo, localizacao, categoria_id, material_id, ativo, destaque, personalizavel } = req.body
        const personalizavelNormalizado = normalizarBoolean(personalizavel) ? 1 : 0
        const [resultado] = await db.query(`INSERT INTO produtos (nome, descricao, preco, estoque, estoque_minimo, localizacao, categoria_id, material_id, ativo, imagem, destaque, personalizavel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [nome, descricao || null, preco, estoque || 0, estoque_minimo || 5, localizacao || null, categoria_id || null, material_id || null, ativo === "true" || ativo === true || ativo === "1" ? 1 : 0, req.file ? `/uploads/${req.file.filename}` : null, destaque === "true" || destaque === true || destaque === "1" ? 1 : 0, personalizavelNormalizado])
        const [produto] = await db.query("SELECT * FROM produtos WHERE id = ?", [resultado.insertId])
        return res.status(201).json({ ...produto[0], personalizavel: normalizarBoolean(produto[0].personalizavel) })
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao criar produto" }) }
})

router.delete("/:id", autenticarToken, apenasAdmin, async (req, res) => {
    try {
        const [resultado] = await db.query("DELETE FROM produtos WHERE id = ?", [req.params.id])
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Produto não encontrado" })
        return res.json({ mensagem: "Produto removido" })
    } catch (error) { console.error(error); return res.status(500).json({ erro: "Erro ao deletar produto" }) }
})

router.put("/:id", autenticarToken, apenasAdmin, upload.single("imagem"), async (req, res) => {
    try {
        const { nome, descricao, preco, estoque, estoque_minimo, localizacao, categoria_id, material_id, ativo, destaque, personalizavel } = req.body
        const personalizavelNormalizado = normalizarBoolean(personalizavel) ? 1 : 0
        const valores = [nome, descricao || null, Number(preco), Number(estoque), Number(estoque_minimo), localizacao || null, categoria_id || null, material_id || null, ativo === "true" || ativo === true || ativo === "1" ? 1 : 0, destaque === "true" || destaque === true || destaque === "1" ? 1 : 0, personalizavelNormalizado]
        let query = "UPDATE produtos SET nome=?, descricao=?, preco=?, estoque=?, estoque_minimo=?, localizacao=?, categoria_id=?, material_id=?, ativo=?, destaque=?, personalizavel=?"
        if (req.file) { query += ", imagem=?"; valores.push(`/uploads/${req.file.filename}`) }
        query += " WHERE id=?"; valores.push(req.params.id)
        const [resultado] = await db.query(query, valores)
        if (!resultado.affectedRows) return res.status(404).json({ erro: "Produto não encontrado" })
        const [produto] = await db.query("SELECT * FROM produtos WHERE id = ?", [req.params.id])
        return res.json({ ...produto[0], personalizavel: normalizarBoolean(produto[0].personalizavel) })
    } catch (error) { console.error("ERRO EDITAR PRODUTO:", error); return res.status(500).json({ erro: "Erro ao editar produto", detalhes: error.message }) }
})

export default router
