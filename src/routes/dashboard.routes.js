import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()

router.get("/atividades-recentes", autenticarToken, async (req, res) => {
    try {
        if (req.usuario?.tipo !== "admin") {
            return res.status(403).json({
                erro: "Acesso permitido somente para administradores"
            })
        }

        const limite = Math.min(
            Math.max(Number(req.query.limite) || 20, 1),
            100
        )

        const [atividades] = await db.query(
            `
            SELECT
                n.id,
                n.usuario_id,
                n.pedido_id,
                n.tipo,
                n.mensagem,
                n.lida,
                n.criado_em,
                u.nome AS usuario_nome
            FROM notificacoes n
            LEFT JOIN usuarios u
                ON u.id = n.usuario_id
            ORDER BY n.criado_em DESC
            LIMIT ?
            `,
            [limite]
        )

        return res.json(atividades)
    } catch (error) {
        console.error("ERRO AO CARREGAR ATIVIDADES:", error)
        return res.status(500).json({
            erro: "Erro ao carregar atividades recentes"
        })
    }
})

// ================================
// MÉTRICAS GERAIS
// ================================

router.get("/metricas", async (req, res) => {

    try {

        const [[totalProdutos]] = await db.query(`
            SELECT COUNT(*) AS total
            FROM produtos
        `)

        const [[produtosAtivos]] = await db.query(`
            SELECT COUNT(*) AS total
            FROM produtos
            WHERE ativo = 1
        `)

        const [[valorEstoque]] = await db.query(`
            SELECT
                COALESCE(SUM(preco * estoque), 0) AS total
            FROM produtos
        `)

        const [[itensEstoque]] = await db.query(`
            SELECT
                COALESCE(SUM(estoque), 0) AS total
            FROM produtos
        `)

        const [colecoesMaisVendidas] = await db.query(`
              SELECT c.id, c.nome,   SUM(pi.quantidade * pi.preco_unitario) AS faturamento,
            SUM(pi.quantidade) AS produtosVendidos FROM pedidos_itens pi INNER JOIN colecoes_produtos cp
             ON cp.produto_id = pi.produto_id INNER JOIN colecoes c ON c.id = cp.colecao_id INNER JOIN pedidos ped
              ON ped.id = pi.pedido_id WHERE ped.status_pedido IN ('pago', 'enviado', 'entregue') GROUP BY c.id, c.nome
            ORDER BY faturamento DESC LIMIT 5;
            `)

        const [faturamentoCategorias] = await db.query(`
            SELECT
                c.id,
                c.nome AS categoria,
                SUM(pi.quantidade * pi.preco_unitario) AS faturamento,
                SUM(pi.quantidade) AS produtosVendidos

            FROM pedidos_itens pi

            INNER JOIN produtos p
                ON p.id = pi.produto_id

            INNER JOIN categorias c
                ON c.id = p.categoria_id

            INNER JOIN pedidos ped
                ON ped.id = pi.pedido_id

            WHERE ped.status_pedido IN ('pago', 'enviado', 'entregue')

            GROUP BY c.id, c.nome

            ORDER BY faturamento DESC
`)

        return res.json({
            totalProdutos: totalProdutos.total,
            produtosAtivos: produtosAtivos.total,
            valorEstoque: valorEstoque.total,
            itensEstoque: itensEstoque.total,

            colecoesMaisVendidas: colecoesMaisVendidas.map(colecao => ({
                id: colecao.id,
                nome: colecao.nome,
                faturamento: Number(colecao.faturamento),
                produtosVendidos: Number(colecao.produtosVendidos)

            })),

            faturamentoCategorias: faturamentoCategorias.map(categoria => ({
                id:categoria.id,
                categoria:categoria.categoria,
                faturamento: Number(categoria.faturamento),
                produtosVendidos: Number(categoria.produtosVendidos)
            }))
        })

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar métricas"
        })

    }

})


// ================================
// ESTOQUE POR CATEGORIA
// ================================

router.get("/estoque-categorias", async (req, res) => {

    try {

        const [dados] = await db.query(`
            SELECT
                c.nome AS categoria,
                COALESCE(SUM(p.estoque), 0) AS estoque
            FROM categorias c
            LEFT JOIN produtos p
                ON p.categoria_id = c.id
            GROUP BY c.id, c.nome
            ORDER BY estoque DESC
        `)

        return res.json(dados)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar estoque por categoria"
        })

    }

})


// ================================
// ALERTAS DE ESTOQUE
// ================================

router.get("/alertas-estoque", async (req, res) => {

    try {

        const [produtos] = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.estoque,
                p.estoque_minimo,
                c.nome AS categoria
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            WHERE p.estoque <= p.estoque_minimo
            ORDER BY p.estoque ASC
        `)

        return res.json(produtos)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar alertas"
        })

    }

})


// ================================
// PRODUTOS RECENTES
// ================================

router.get("/produtos-recentes", async (req, res) => {

    try {

        const [produtosRecentes] = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.preco,
                p.estoque,
                p.created_at,
                c.nome AS categoria
            FROM produtos p
            LEFT JOIN categorias c
                ON p.categoria_id = c.id
            ORDER BY p.created_at DESC
            LIMIT 5
        `)

        return res.json(produtosRecentes)

    } catch (error) {

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar produtos recentes"
        })

    }

})


// métricas gerais de vendas 
router.get("/resumo-vendas", async (req, res) => {

    try {

        const [[vendasHoje]] = await db.query(`SELECT COUNT(*) AS total FROM pedidos WHERE DATE(criado_em) = CURDATE() `)

        const [[vendasMensal]] = await db.query(`  SELECT COUNT(*) AS total
            FROM pedidos
            WHERE MONTH(criado_em) = MONTH(CURDATE())
            AND YEAR(criado_em) = YEAR(CURDATE())` )



        const [vendasUltimos30Dias] = await db.query(`

            WITH RECURSIVE dias AS (
                SELECT CURDATE() - INTERVAL 29 DAY AS data
                UNION ALL
                SELECT data + INTERVAL 1 DAY
                FROM dias
                WHERE data < CURDATE()
            )
            SELECT dias.data,
                COUNT(p.id) AS quantidade_vendas,
                COALESCE(SUM(p.total), 0) AS faturamento
            FROM dias
            LEFT JOIN pedidos p
                ON p.criado_em >= dias.data
                AND p.criado_em < dias.data + INTERVAL 1 DAY
                AND p.status_pedido IN ('pago', 'enviado', 'entregue')

            GROUP BY dias.data
            ORDER BY dias.data ASC

        `)

        const [faturamentoBruto] = await db.query(`
            select COALESCE(SUM(total), 0) AS faturamentoBruto from pedidos where status_pedido IN ("entregue")
        `)

        const [[totalProdutosVendidos]] = await db.query(`
            SELECT  COALESCE(SUM(pi.quantidade), 0) AS totalProdutosVendidos FROM pedidos_itens pi
             INNER JOIN pedidos p ON p.id = pi.pedido_id WHERE p.status_pedido IN ('pago', 'enviado', 'entregue')
        `)


        const [pedidosPorStatus] = await db.query(`

            SELECT
                status_pedido AS status,
                COUNT(*) AS quantidade

            FROM pedidos

            GROUP BY status_pedido

            ORDER BY quantidade DESC

        `)

        const [[ticketMedio]] = await db.query(`select coalesce(AVG(total), 0 ) AS ticketMedio
             from pedidos where status_pedido IN ('entregue')`)


        return res.json({
            vendasHoje: vendasHoje.total,
            vendasMensal: vendasMensal.total,
            vendasUltimos30Dias,
            faturamentoBruto: Number(faturamentoBruto.faturamentoBruto),
            totalProdutosVendidos: Number(totalProdutosVendidos.totalProdutosVendidos),
            pedidosPorStatus: pedidosPorStatus.map(item => ({
                status: item.status,
                quantidade: Number(item.quantidade)
            })),
            ticketMedio: Number(ticketMedio.ticketMedio)
        })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar as vendas de hoje"
        })
    }
})

export default router