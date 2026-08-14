import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"

const router = express.Router()

// metodo de fazer o pedido
router.post("/", autenticarToken, async (req, res) => {

    const connection = await db.getConnection()
    const { codigo } = req.body

    try {

        await connection.beginTransaction()
        const usuarioId = req.usuario.id

        const { formaPagamento, tipoEntrega, cupom, endereco, dadosCartao } = req.body

        if (tipoEntrega !== "retirada") {
            if (!endereco || !endereco.nome || !endereco.telefone || !endereco.endereco
                || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.uf || !endereco.cep) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Endereço de entrega incompleto"
                })
            }
        }

        if (formaPagamento === "cartao") {
            if (!dadosCartao || !dadosCartao.numero || !dadosCartao.nomeTitular || !dadosCartao.bandeira) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Dados do cartão incompletos"
                })
            }
        }

        // nunca guardamos o número completo do cartão nem CVV/validade —
        // só o suficiente pra exibir depois (ex: "final 1234")
        const cartaoFinal = formaPagamento === "cartao"
            ? String(dadosCartao.numero).replace(/\D/g, "").slice(-4)
            : null
        const cartaoBandeira = formaPagamento === "cartao" ? dadosCartao.bandeira : null
        const cartaoNomeTitular = formaPagamento === "cartao" ? dadosCartao.nomeTitular : null

        const [carrinho] = await connection.query(`select * from carrinhos where usuario_id = ? `, [usuarioId])

        if (carrinho.length === 0) {
            await connection.rollback()

            return res.status(400).json({
                mensagem: "Seu carrinho está vazio"
            })
        }

        const carrinhoId = carrinho[0].id
        const [itensCarrinho] = await connection.query(`select ci.produto_id, ci.quantidade, p.nome, p.preco, p.estoque 
        FROM carrinho_itens ci INNER JOIN produtos p ON p.id = ci.produto_id WHERE ci.carrinho_id = ?`, [carrinhoId])

        for (const item of itensCarrinho) {
            if (item.quantidade > item.estoque) {
                throw new Error(`Produto ${item.nome} está sem estoque`)
            }
        }

        const subtotal = itensCarrinho.reduce((acc, item) => {
            return acc + (item.preco * item.quantidade)
        }, 0)

        let frete = 0
        let prazoEntrega = ""
        let cupomId = null
        let desconto = 0


        if (codigo) {
            // const cupomId = dadosCupom.id

            const [cupomEncontrado] = await connection.query(
                "SELECT * from cupons where codigo = ? and ativo = true ", [codigo])

            console.log("Resultado da consulta:", cupomEncontrado);

            if (cupomEncontrado.length === 0) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Não há cupons válidos no momento"
                })
            }

            // conferindo data de validade do cupom
            const dadosCupom = cupomEncontrado[0]

            if (dadosCupom.data_fim && new Date(dadosCupom.data_fim) < new Date()) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Cupom expirado"
                })
            }

            // valor minímo

            if (subtotal < dadosCupom.valor_minimo) {
                await connection.rollback()

                return res.status(400).json({
                    erro: `Compra mínima no valor de ${dadosCupom.valor_minimo}`
                })
            }


            if (dadosCupom.tipo === "percentual") {
                desconto = subtotal * (dadosCupom.valor / 100)
            } else {
                desconto = dadosCupom.valor
            }

            cupomId = dadosCupom.id

        }

        switch (tipoEntrega) {

            case "padrão": frete = 0, prazoEntrega = "5 a 7 dias úteis"; break
            case "expressa": frete = 25, prazoEntrega = "3 a 5 dias úteis"; break
            case "retirada": frete = 0, prazoEntrega = "Disponível em 24h para retirada na loja"; break


        }



        // const totalFinal = subTotal - desconto

        // res.json({
        //     codigo: dadosCupom.codigo,
        //     desconto,
        //     totalFinal
        // })


        const total = subtotal - desconto + frete


        const [pedido] = await connection.query(`
          insert into pedidos (usuario_id, subtotal, desconto, frete, total, forma_pagamento, tipo_entrega,
           prazo_entrega, cupom_id, endereco_nome_destinatario, endereco_telefone, endereco_rua, endereco_numero,
           endereco_bairro, endereco_cidade, endereco_estado, endereco_cep, cartao_bandeira, cartao_final, cartao_nome_titular)
           values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) `, [usuarioId, subtotal, desconto, frete, total, formaPagamento, tipoEntrega,
            prazoEntrega, cupomId,
            tipoEntrega !== "retirada" ? endereco.nome : null,
            tipoEntrega !== "retirada" ? endereco.telefone : null,
            tipoEntrega !== "retirada" ? endereco.endereco : null,
            tipoEntrega !== "retirada" ? endereco.numero : null,
            tipoEntrega !== "retirada" ? endereco.bairro : null,
            tipoEntrega !== "retirada" ? endereco.cidade : null,
            tipoEntrega !== "retirada" ? endereco.uf : null,
            tipoEntrega !== "retirada" ? endereco.cep : null,
            cartaoBandeira, cartaoFinal, cartaoNomeTitular])

        // primeiro registro da timeline — mesmo status default ("pendente")
        // que a coluna status_pedido nasce com
        await connection.query(
            `insert into historico_pedidos (pedido_id, status) values (?, ?)`,
            [pedido.insertId, "pendente"]
        )


        for (const item of itensCarrinho) {
            await connection.query(
                `insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal) values (?,?,?,?,?)`,
                [pedido.insertId, item.produto_id, item.quantidade, item.preco, item.preco * item.quantidade])
        }


        for (const item of itensCarrinho) {
            await connection.query(
                `update produtos set estoque = estoque - ? where id  = ?`, [item.quantidade, item.produto_id])
        }

        await connection.query(`delete from carrinho_itens where carrinho_id = ?`, [carrinhoId])


        await connection.commit()

        return res.status(201).json({
            mensagem: "Pedido realizado com sucesso!",
            pedidoId: pedido.insertId,
            total
        })

    } catch (error) {
        await connection.rollback()

        console.error(error)

        return res.status(500).json({
            erro: "Erro ao finalizar o pedido, por favor tente novamente"
        })
    } finally {
        connection.release()
    }


})


// metodo de leitura dos pedidos do usuario

router.get("/meus-pedidos", autenticarToken, async (req, res) => {
        console.log("USUARIO:", req.usuario)

    try {
        const usuarioId = req.usuario.id
        const [pedidos] = await db.query(`select * from pedidos where usuario_id = ? order by criado_em desc`, [usuarioId])

        if (pedidos.length === 0) {
            return res.json([])
        }

        const pedidoIds = pedidos.map((pedido) => pedido.id)

        // busca os itens de todos os pedidos de uma vez só (evita fazer 1 query por pedido)
        const [itens] = await db.query(
            `SELECT pi.pedido_id, pi.produto_id, pi.quantidade, pi.preco_unitario, pi.subtotal,
                    p.nome, p.imagem
               FROM pedidos_itens pi
               INNER JOIN produtos p ON p.id = pi.produto_id
              WHERE pi.pedido_id IN (?)`,
            [pedidoIds]
        )

        // idem pra timeline — um select só pra todos os pedidos, em vez de 1 por pedido
        const [historico] = await db.query(
            `SELECT pedido_id, status, criado_em
               FROM historico_pedidos
              WHERE pedido_id IN (?)
              ORDER BY criado_em ASC`,
            [pedidoIds]
        )

        const pedidosComItens = pedidos.map((pedido) => ({
            ...pedido,
            itens: itens.filter((item) => item.pedido_id === pedido.id),
            timeline: historico.filter((evento) => evento.pedido_id === pedido.id)
        }))

        res.json(pedidosComItens)

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao carregar os seus pedidos"
        })
    }

})


// *** MÉTODOS DOS PEDIDOS PARA O ADMIN
// Precisam vir ANTES de "/:id" — como têm segmento fixo ("pedidos-admin"),
// se ficassem depois, "/:id" capturaria a chamada primeiro (tratando
// "pedidos-admin" como se fosse um id) e nunca chegariam a executar.

// método de listagem de todos os pedidos

router.get("/pedidos-admin", autenticarToken, async (req, res) => {

    try {
        const [pedidos] = await db.query(`
               SELECT
                p.id,
                p.total,
                p.status_pedido,
                p.criado_em,
                u.nome AS cliente_nome,
                u.email AS cliente_email,

                COUNT(pi.id) AS quantidade_itens FROM pedidos p

                 INNER JOIN usuarios u
                ON u.id = p.usuario_id

            LEFT JOIN pedidos_itens pi
                ON pi.pedido_id = p.id

            GROUP BY p.id, p.total, p.status_pedido, p.criado_em, u.nome, u.email
             ORDER BY p.criado_em DESC
             `)


        res.json(pedidos)
    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao buscar os pedidos"
        })
    }
})

router.get("/pedidos-admin/:id", autenticarToken, async (req, res) => {

    try {

        const pedidoId = req.params.id

        const [pedido] = await db.query(`
            SELECT
                p.*,
                u.nome AS cliente_nome,
                u.email AS cliente_email
            FROM pedidos p
            INNER JOIN usuarios u
                ON u.id = p.usuario_id
            WHERE p.id = ?`, [pedidoId])

        if (pedido.length === 0) {
            return res.status(404).json({
                erro: "Pedido não encontrado"
            })
        }

        const [itens] = await db.query(`SELECT
                pi.*,
                pr.nome,
                pr.imagem
            FROM pedidos_itens pi
            INNER JOIN produtos pr
                ON pr.id = pi.produto_id
            WHERE pi.pedido_id = ?`, [pedidoId])

        const [timeline] = await db.query(
            `SELECT status, criado_em FROM historico_pedidos WHERE pedido_id = ? ORDER BY criado_em ASC`,
            [pedidoId]
        )

        // dados de cartão são só pro próprio usuário ver, admin não precisa
        const { cartao_bandeira, cartao_final, cartao_nome_titular, ...pedidoSemCartao } = pedido[0]

        res.json({
            pedido: pedidoSemCartao,
            itens,
            timeline
        })


    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao buscar os detalhes do pedido"
        })
    }
})

router.put("/pedidos-admin/:id/status", autenticarToken, async (req, res) => {

    try {

        const pedidoId = req.params.id
        const { status } = req.body

        const statusValido = [
            "pendente", "pago", "enviado", "entregue", "cancelado"
        ]

        if (!statusValido.includes(status)) {
            return res.status(400).json({
                erro: "Status inválido"
            })
        }

        const [atualizacaoStatus] = await db.query(`
            update pedidos set status_pedido = ? where id = ?  
        `, [status, pedidoId])

        if (atualizacaoStatus.affectedRows === 0) {
            return res.status(404).json({
                erro: "Pedido não encontrado"
            })
        }

        // registra a mudança na timeline
        await db.query(
            `insert into historico_pedidos (pedido_id, status) values (?, ?)`,
            [pedidoId, status]
        )

        res.json({
            mensagem: "Status do pedido atualizado com sucesso"
        })


    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao atualizar o status do pedido"
        })
    }
})


// Rota genérica de detalhe do pedido do usuário — fica por último de
// propósito: qualquer segmento fixo (/meus-pedidos, /pedidos-admin...)
// precisa vir antes dela, senão é engolido por esse ":id".
router.get("/:id", autenticarToken, async (req, res) => {
    try {
        const usuarioId = req.usuario.id
        const pedidoId = req.params.id

        const [pedido] = await db.query(`select * from pedidos where id = ? AND usuario_id = ?`, [pedidoId, usuarioId])

        if (pedido.length === 0) {
            return res.status(404).json({
                erro: "Pedido não encontrado"
            })
        }


        const [itens] = await db.query(`SELECT pi.*, p.nome, p.imagem FROM pedidos_itens pi INNER JOIN produtos p
             ON p.id = pi.produto_id WHERE pi.pedido_id = ?`, [pedidoId])

        const [timeline] = await db.query(
            `SELECT status, criado_em FROM historico_pedidos WHERE pedido_id = ? ORDER BY criado_em ASC`,
            [pedidoId]
        )

        res.json({
            pedido: pedido[0],
            itens,
            timeline
        })

    } catch (error) {
        console.error(error)

        return res.status(500).json({
            erro: "Erro ao buscar pedido"
        })
    }
})


export default router