import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()

function apenasAdmin(req, res, next) {
    if (req.usuario?.tipo !== "admin") {
        return res.status(403).json({
            erro: "Acesso permitido somente para administradores"
        })
    }

    next()
}

function normalizarDados(body) {
    const tipoInformado = String(body.tipo || "")
        .trim()
        .toLowerCase()

    const tipo = {
        "desconto percentual": "percentual",
        "desconto fixo": "fixo",
        "frete grátis": "frete_gratis",
        "frete gratis": "frete_gratis"
    }[tipoInformado] || tipoInformado

    const valor = Number(body.valor ?? body.desconto ?? 0)
    const valorMinimo = Number(body.valor_minimo ?? body.valorMinimo ?? 0)
    const quantidadeUso =
        body.quantidade_uso ?? body.quantidadeUso ?? body.limiteUso ?? null
    const normalizarData = (valor) => {
        if (valor === undefined || valor === null || String(valor).trim() === "") return null
        const texto = String(valor).trim()
        if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) return texto.replace("T", " ").replace(/Z$/, "").slice(0, 19)
        return texto.slice(0, 19)
    }

    return {
        codigo: String(body.codigo || "").trim().toUpperCase(),
        tipo,
        valor,
        valorMinimo,
        quantidadeUso: quantidadeUso === "" || quantidadeUso === null
            ? null
            : Number(quantidadeUso),
        limitePorCliente: body.limite_por_cliente ?? body.limitePorCliente ?? null,
        tipoAutomatico: body.tipo_automatico ?? body.tipoAutomatico ?? "nenhum",
        ativo: body.ativo === undefined
            ? true
            : body.ativo === true || body.ativo === 1 || body.ativo === "true",
        dataInicio: normalizarData(body.data_inicio ?? body.dataInicio),
        dataFim: normalizarData(body.data_fim ?? body.dataFim ?? body.dataExpiracao ?? body.data_expiracao)
    }
}

function validarDados(dados) {
    if (!dados.codigo) return "Informe o código do cupom"
    if (!/^[A-Z0-9_-]+$/.test(dados.codigo)) {
        return "O código deve conter apenas letras, números, _ ou -"
    }
    if (!["percentual", "fixo"].includes(dados.tipo)) {
        if (dados.tipo !== "frete_gratis") return "Tipo de desconto inválido"
    }
    if (!["nenhum", "primeira_compra", "aniversario", "vip", "inativo", "pos_compra", "surpresa"].includes(dados.tipoAutomatico)) {
        return "Tipo automático inválido"
    }
    if (dados.tipo === "frete_gratis") dados.valor = 0
    if (dados.tipo !== "frete_gratis" && (!Number.isFinite(dados.valor) || dados.valor <= 0)) {
        return "O valor do desconto deve ser maior que zero"
    }
    if (dados.tipo === "percentual" && dados.valor > 100) {
        return "O desconto percentual não pode ser maior que 100"
    }
    if (!Number.isFinite(dados.valorMinimo) || dados.valorMinimo < 0) {
        return "O valor mínimo é inválido"
    }
    if (
        dados.quantidadeUso !== null &&
        (!Number.isInteger(dados.quantidadeUso) || dados.quantidadeUso < 1)
    ) {
        return "O limite de usos é inválido"
    }
    if (
        dados.limitePorCliente !== null &&
        dados.limitePorCliente !== undefined &&
        (!Number.isInteger(Number(dados.limitePorCliente)) || Number(dados.limitePorCliente) < 1)
    ) {
        return "O limite por cliente é inválido"
    }
    if (
        dados.dataInicio &&
        dados.dataFim &&
        (!Number.isFinite(new Date(dados.dataInicio).getTime()) ||
            !Number.isFinite(new Date(dados.dataFim).getTime()))
    ) {
        return "As datas do cupom são inválidas"
    }
    if (
        dados.dataInicio &&
        dados.dataFim &&
        new Date(dados.dataFim).getTime() < new Date(dados.dataInicio).getTime()
    ) {
        return "A data final não pode ser anterior à data inicial"
    }
    if (dados.dataInicio && !Number.isFinite(new Date(dados.dataInicio).getTime())) {
        return "A data inicial é inválida"
    }
    if (dados.dataFim && !Number.isFinite(new Date(dados.dataFim).getTime())) {
        return "A data final é inválida"
    }
    return null
}

// Lista cupons para a tela administrativa.
router.get(
    "/",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const [cupons] = await db.query(
                `
                SELECT *
                FROM cupons
                ORDER BY criado_em DESC
                `
            )

            return res.json(cupons)
        } catch (error) {
            console.error("ERRO AO LISTAR CUPONS:", error)
            return res.status(500).json({ erro: "Erro ao listar cupons" })
        }
    }
)

// Indicadores usados no dashboard de cupons.
router.get(
    "/dashboard",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const [dados] = await db.query(
                `
                SELECT
                    COUNT(*) AS total,
                    SUM(ativo = TRUE AND (data_fim IS NULL OR data_fim >= CURRENT_DATE())) AS ativos,
                    SUM(data_fim IS NOT NULL AND data_fim < CURRENT_DATE()) AS expirados,
                    COALESCE(SUM(usado), 0) AS total_usos,
                    (SELECT codigo FROM cupons ORDER BY usado DESC, id ASC LIMIT 1) AS mais_utilizado
                FROM cupons
                `
            )

            return res.json(dados[0])
        } catch (error) {
            console.error("ERRO NO DASHBOARD DE CUPONS:", error)
            return res.status(500).json({ erro: "Erro no dashboard de cupons" })
        }
    }
)

router.get(
    "/disponiveis",
    autenticarToken,
    async (req, res) => {
        try {
            const usuarioId = req.usuario.id

            const [cupons] = await db.query(
                `
                SELECT
                    c.id,
                    c.codigo,
                    c.tipo,
                    c.valor,
                    c.valor_minimo,
                    c.limite_por_cliente,
                    c.data_inicio,
                    c.data_fim
                FROM cupons c
                WHERE c.ativo = TRUE
                AND (c.data_inicio IS NULL OR c.data_inicio <= NOW())
                AND (c.data_fim IS NULL OR DATE(c.data_fim) >= CURRENT_DATE())
                AND (c.quantidade_uso IS NULL OR c.usado < c.quantidade_uso)
                AND (
                    c.limite_por_cliente IS NULL
                    OR (
                        SELECT COUNT(*)
                        FROM cupons_usos u
                        WHERE u.cupom_id = c.id
                        AND u.usuario_id = ?
                    ) < c.limite_por_cliente
                )
                ORDER BY c.criado_em DESC
                `,
                [usuarioId]
            )

            return res.json(cupons)
        } catch (error) {
            console.error("ERRO AO LISTAR CUPONS DISPONIVEIS:", error)
            return res.status(500).json({
                erro: "Erro ao listar cupons disponíveis"
            })
        }
    }
)

router.get(
    "/:id",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const [cupons] = await db.query(
                `SELECT * FROM cupons WHERE id = ? LIMIT 1`,
                [req.params.id]
            )

            if (!cupons.length) {
                return res.status(404).json({ erro: "Cupom não encontrado" })
            }

            return res.json(cupons[0])
        } catch (error) {
            console.error("ERRO AO BUSCAR CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao buscar cupom" })
        }
    }
)

router.post(
    "/",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const dados = normalizarDados(req.body)
            const erro = validarDados(dados)
            if (erro) return res.status(400).json({ erro })

            const [resultado] = await db.query(
                `
                INSERT INTO cupons
                    (codigo, tipo, valor, valor_minimo, quantidade_uso, limite_por_cliente, tipo_automatico, ativo, data_inicio, data_fim)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    dados.codigo,
                    dados.tipo,
                    dados.valor,
                    dados.valorMinimo,
                    dados.quantidadeUso,
                    dados.limitePorCliente === null ? null : Number(dados.limitePorCliente),
                    dados.tipoAutomatico,
                    dados.ativo,
                    dados.dataInicio,
                    dados.dataFim
                ]
            )

            const [cupom] = await db.query(
                "SELECT * FROM cupons WHERE id = ?",
                [resultado.insertId]
            )

            return res.status(201).json(cupom[0])
        } catch (error) {
            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ erro: "Este código já existe" })
            }
            console.error("ERRO AO CRIAR CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao criar cupom" })
        }
    }
)

router.put(
    "/:id",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const dados = normalizarDados(req.body)
            const erro = validarDados(dados)
            if (erro) return res.status(400).json({ erro })

            const [resultado] = await db.query(
                `
                UPDATE cupons
                SET codigo = ?, tipo = ?, valor = ?, valor_minimo = ?,
                    quantidade_uso = ?, limite_por_cliente = ?, tipo_automatico = ?,
                    ativo = ?, data_inicio = ?, data_fim = ?
                WHERE id = ?
                `,
                [
                    dados.codigo,
                    dados.tipo,
                    dados.valor,
                    dados.valorMinimo,
                    dados.quantidadeUso,
                    dados.limitePorCliente === null ? null : Number(dados.limitePorCliente),
                    dados.tipoAutomatico,
                    dados.ativo,
                    dados.dataInicio,
                    dados.dataFim,
                    req.params.id
                ]
            )

            const [cupomAtualizado] = await db.query(
                "SELECT * FROM cupons WHERE id = ?",
                [req.params.id]
            )
            if (!cupomAtualizado.length) {
                return res.status(404).json({ erro: "Cupom não encontrado" })
            }

            return res.json(cupomAtualizado[0])
        } catch (error) {
            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ erro: "Este código já existe" })
            }
            console.error("ERRO AO EDITAR CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao editar cupom" })
        }
    }
)

router.patch(
    "/:id/status",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const ativo = req.body.ativo === true || req.body.ativo === 1 || req.body.ativo === "true"
            const [resultado] = await db.query(
                "UPDATE cupons SET ativo = ? WHERE id = ?",
                [ativo, req.params.id]
            )
            if (!resultado.affectedRows) {
                return res.status(404).json({ erro: "Cupom não encontrado" })
            }
            return res.json({ sucesso: true, ativo })
        } catch (error) {
            console.error("ERRO AO ALTERAR STATUS DO CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao alterar status do cupom" })
        }
    }
)

router.delete(
    "/:id",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {
        try {
            const [resultado] = await db.query(
                "DELETE FROM cupons WHERE id = ?",
                [req.params.id]
            )
            if (!resultado.affectedRows) {
                return res.status(404).json({ erro: "Cupom não encontrado" })
            }
            return res.json({ sucesso: true, mensagem: "Cupom excluído" })
        } catch (error) {
            console.error("ERRO AO EXCLUIR CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao excluir cupom" })
        }
    }
)

// Validação usada pelo checkout do cliente.
router.post(
    "/validar-cupom",
    autenticarToken,
    async (req, res) => {
        try {
            const codigo = String(
                req.body.codigo ||
                req.body.couponCode ||
                req.body.cupom?.codigo ||
                req.body.coupon?.codigo ||
                ""
            ).trim().toUpperCase()
            const subtotal = Number(
                req.body.subtotal ?? req.body.subTotal
            )

            if (!codigo || !Number.isFinite(subtotal) || subtotal < 0) {
                return res.status(400).json({
                    erro: "Código ou subtotal inválido"
                })
            }

            const [cupons] = await db.query(
                `
                SELECT *
                FROM cupons
                WHERE codigo = ?
                AND ativo = TRUE
                AND (data_inicio IS NULL OR data_inicio <= NOW())
                AND (data_fim IS NULL OR DATE(data_fim) >= CURRENT_DATE())
                AND (quantidade_uso IS NULL OR usado < quantidade_uso)
                `,
                [codigo]
            )

            if (!cupons.length) {
                return res.status(400).json({
                    erro: "Cupom inválido ou indisponível"
                })
            }

            const cupom = cupons[0]
            if (subtotal < Number(cupom.valor_minimo || 0)) {
                return res.status(400).json({
                    erro: `Compra mínima de R$ ${Number(
                        cupom.valor_minimo
                    ).toFixed(2)}`
                })
            }

            if (cupom.limite_por_cliente !== null) {
                const [[usoCliente]] = await db.query(
                    `
                    SELECT COUNT(*) AS total
                    FROM cupons_usos
                    WHERE cupom_id = ? AND usuario_id = ?
                    `,
                    [cupom.id, req.usuario.id]
                )

                if (Number(usoCliente.total) >= Number(cupom.limite_por_cliente)) {
                    return res.status(400).json({
                        erro: "Você atingiu o limite de uso deste cupom"
                    })
                }
            }

            const [carrinhos] = await db.query(
                `SELECT id FROM carrinhos WHERE usuario_id = ?`,
                [req.usuario.id]
            )
            const carrinhoId = carrinhos[0]?.id || 0
            const [[restricoes]] = await db.query(
                `
                SELECT
                    EXISTS(SELECT 1 FROM cupons_produtos WHERE cupom_id = ?) AS possui_produtos,
                    EXISTS(SELECT 1 FROM cupons_colecoes WHERE cupom_id = ?) AS possui_colecoes
                `,
                [cupom.id, cupom.id]
            )

            if (restricoes.possui_produtos || restricoes.possui_colecoes) {
                const [[permitido]] = await db.query(
                    `
                    SELECT COUNT(DISTINCT ci.id) AS total
                    FROM carrinho_itens ci
                    LEFT JOIN cupons_produtos cp
                        ON cp.cupom_id = ? AND cp.produto_id = ci.produto_id
                    LEFT JOIN cupons_colecoes cc
                        ON cc.cupom_id = ?
                    LEFT JOIN colecoes_produtos cop
                        ON cop.colecao_id = cc.colecao_id
                        AND cop.produto_id = ci.produto_id
                    WHERE ci.carrinho_id = ?
                    AND (cp.produto_id IS NOT NULL OR cop.produto_id IS NOT NULL)
                    `,
                    [cupom.id, cupom.id, carrinhoId]
                )

                if (!Number(permitido.total)) {
                    return res.status(400).json({
                        erro: "Este cupom não se aplica aos produtos do carrinho"
                    })
                }
            }

            const desconto = cupom.tipo === "frete_gratis"
                ? 0
                : Math.min(
                    cupom.tipo === "percentual"
                        ? subtotal * Number(cupom.valor) / 100
                        : Number(cupom.valor),
                    subtotal
                )

            return res.json({
                codigo: cupom.codigo,
                tipo: cupom.tipo,
                valor: Number(cupom.valor),
                desconto: Number(desconto.toFixed(2)),
                freteGratis: cupom.tipo === "frete_gratis",
                totalFinal: Number((subtotal - desconto).toFixed(2))
            })
        } catch (error) {
            console.error("ERRO AO VALIDAR CUPOM:", error)
            return res.status(500).json({ erro: "Erro ao validar cupom" })
        }
    }
)



export default router