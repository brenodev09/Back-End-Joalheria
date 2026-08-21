/* =========================================================================
   ARQUIVO: src/routes/pedidos.routes.js
   ========================================================================= */

import express from "express"
import db from "../database.js"
import { autenticarToken } from "../middlewares/autenticacao.js"
import {
    mpPayment,
    pagamentoMock,
    gerarPagamentoMock,
    mapearStatusMP,
    validarAssinaturaWebhook
} from "../services/mercadopago.js"

const router = express.Router()

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function obterPrecoItem(item) {
    if (item.variacao_id) {
        return Number(item.preco_variacao)
    }

    return Number(item.preco_produto)
}

function apenasAdmin(req, res, next) {
    if (req.usuario?.tipo !== "admin") {
        return res.status(403).json({
            erro: "Acesso permitido somente para administradores"
        })
    }

    next()
}

// ======================================================
// CRIAR PEDIDO
// ======================================================

router.post("/", autenticarToken, async (req, res) => {
    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        const usuarioId = req.usuario.id

        const formaPagamentoInformada =
            req.body.formaPagamento ||
            req.body.pagamento ||
            req.body.metodoPagamento

        const entregaInformada =
            req.body.tipoEntrega ||
            req.body.formaEntrega ||
            req.body.entrega

        const pagamentoMapeado = {
            "credit_card": "cartao",
            credito: "cartao",
            "cartao_credito": "cartao"
        }

        const pagamentoNormalizado =
            String(formaPagamentoInformada || "")
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")

        const formaPagamento =
            pagamentoMapeado[pagamentoNormalizado] ||
            pagamentoNormalizado

        const tipoEntregaMapeado = {
            normal: "padrão",
            padrao: "padrão",
            standard: "padrão",
            express: "expressa",
            pickup: "retirada"
        }

        const tipoEntrega =
            tipoEntregaMapeado[
                String(entregaInformada || "")
                    .trim()
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
            ] || entregaInformada

        const codigo =
            req.body.codigo || req.body.codigoCupom

        const endereco =
            req.body.endereco || req.body.enderecoEntrega

        const dadosCartao =
            req.body.dadosCartao || req.body.cartao

        // ======================================================
        // VALIDAÇÕES
        // ======================================================

        if (!formaPagamento) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Selecione uma forma de pagamento"
            })
        }

        if (!["cartao", "pix", "boleto"].includes(formaPagamento)) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Forma de pagamento inválida"
            })
        }

        if (!tipoEntrega) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Selecione uma forma de entrega"
            })
        }

        if (!["padrão", "expressa", "retirada"].includes(tipoEntrega)) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Tipo de entrega inválido"
            })
        }

        // ======================================================
        // ENDEREÇO
        // ======================================================

        if (tipoEntrega !== "retirada") {
            if (
                !endereco ||
                !endereco.nome ||
                !endereco.telefone ||
                !endereco.endereco ||
                !endereco.numero ||
                !endereco.bairro ||
                !endereco.cidade ||
                !endereco.uf ||
                !endereco.cep
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Endereço de entrega incompleto"
                })
            }
        }

        // ======================================================
        // CARTÃO
        // ======================================================

        if (formaPagamento === "cartao") {
            if (
                !dadosCartao ||
                !dadosCartao.numero ||
                !dadosCartao.nomeTitular ||
                !dadosCartao.bandeira
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Dados do cartão incompletos"
                })
            }

            const numeroCartao = String(dadosCartao.numero)
                .replace(/\D/g, "")

            if (numeroCartao.length < 4) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Número do cartão inválido"
                })
            }
        }

        const cartaoFinal =
            formaPagamento === "cartao"
                ? String(dadosCartao.numero)
                    .replace(/\D/g, "")
                    .slice(-4)
                : null

        const cartaoBandeira =
            formaPagamento === "cartao"
                ? dadosCartao.bandeira
                : null

        const cartaoNomeTitular =
            formaPagamento === "cartao"
                ? dadosCartao.nomeTitular
                : null

        // ======================================================
        // BUSCAR CARRINHO
        // ======================================================

        const [carrinho] = await connection.query(
            `
            SELECT *
            FROM carrinhos
            WHERE usuario_id = ?
            FOR UPDATE
            `,
            [usuarioId]
        )

        if (carrinho.length === 0) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Seu carrinho está vazio"
            })
        }

        const carrinhoId = carrinho[0].id

        // ======================================================
        // BUSCAR ITENS DO CARRINHO
        // ======================================================

        const [itensCarrinho] = await connection.query(
            `
            SELECT
                ci.id AS carrinho_item_id,
                ci.produto_id,
                ci.variacao_id,
                ci.quantidade,

                p.nome,
                p.preco AS preco_produto,
                p.estoque AS estoque_produto,
                p.ativo AS produto_ativo,

                pv.tipo AS variacao_tipo,
                pv.valor AS variacao_valor,
                pv.preco AS preco_variacao,
                pv.estoque AS estoque_variacao

            FROM carrinho_itens ci

            INNER JOIN produtos p
                ON p.id = ci.produto_id

            LEFT JOIN produto_variacoes pv
                ON pv.id = ci.variacao_id

            WHERE ci.carrinho_id = ?

            FOR UPDATE
            `,
            [carrinhoId]
        )

        if (itensCarrinho.length === 0) {
            await connection.rollback()

            return res.status(400).json({
                erro: "Seu carrinho está vazio"
            })
        }

        // ======================================================
        // VALIDAR PRODUTOS
        // ======================================================

        for (const item of itensCarrinho) {
            if (!item.produto_ativo) {
                await connection.rollback()

                return res.status(400).json({
                    erro: `O produto ${item.nome} não está mais disponível`
                })
            }
        }

        // ======================================================
        // VALIDAR VARIAÇÕES
        // ======================================================

        for (const item of itensCarrinho) {
            if (item.variacao_id) {
                if (
                    item.preco_variacao === null ||
                    item.preco_variacao === undefined
                ) {
                    await connection.rollback()

                    return res.status(400).json({
                        erro: `A variação selecionada para ${item.nome} não existe mais`
                    })
                }

                const [variacao] = await connection.query(
                    `
                    SELECT id
                    FROM produto_variacoes
                    WHERE id = ?
                    AND produto_id = ?
                    `,
                    [
                        item.variacao_id,
                        item.produto_id
                    ]
                )

                if (variacao.length === 0) {
                    await connection.rollback()

                    return res.status(400).json({
                        erro: `A variação do produto ${item.nome} é inválida`
                    })
                }
            }
        }

        // ======================================================
        // VALIDAR ESTOQUE
        // ======================================================

        for (const item of itensCarrinho) {
            const quantidade = Number(item.quantidade)

            if (!Number.isInteger(quantidade) || quantidade <= 0) {
                await connection.rollback()

                return res.status(400).json({
                    erro: `Quantidade inválida para ${item.nome}`
                })
            }

            const estoqueDisponivel =
                item.variacao_id
                    ? Number(item.estoque_variacao)
                    : Number(item.estoque_produto)

            if (quantidade > estoqueDisponivel) {
                await connection.rollback()

                return res.status(400).json({
                    erro: item.variacao_id
                        ? `A variação ${item.variacao_valor} de ${item.nome} não possui estoque suficiente`
                        : `Produto ${item.nome} não possui estoque suficiente`
                })
            }
        }

        // ======================================================
        // SUBTOTAL
        // ======================================================

        const subtotal = itensCarrinho.reduce(
            (total, item) => {
                const preco = obterPrecoItem(item)

                return total +
                    preco * Number(item.quantidade)
            },
            0
        )

        // ======================================================
        // CUPOM
        // ======================================================

        let cupomId = null
        let desconto = 0

        if (codigo) {
            const codigoNormalizado =
                String(codigo)
                    .trim()
                    .toUpperCase()

            const [cupons] = await connection.query(
                `
                SELECT *
                FROM cupons
                WHERE codigo = ?
                AND ativo = TRUE
                FOR UPDATE
                `,
                [codigoNormalizado]
            )

            if (cupons.length === 0) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Cupom inválido ou indisponível"
                })
            }

            const cupom = cupons[0]

            const agora = new Date()

            // --------------------------------------------------
            // DATA INICIAL
            // --------------------------------------------------

            if (
                cupom.data_inicio &&
                new Date(cupom.data_inicio) > agora
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Este cupom ainda não está disponível"
                })
            }

            // --------------------------------------------------
            // DATA FINAL
            // --------------------------------------------------

            if (
                cupom.data_fim &&
                new Date(cupom.data_fim) < agora
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Cupom expirado"
                })
            }

            // --------------------------------------------------
            // VALOR MÍNIMO
            // --------------------------------------------------

            if (
                subtotal <
                Number(cupom.valor_minimo || 0)
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: `Compra mínima de R$ ${Number(
                        cupom.valor_minimo
                    ).toFixed(2)}`
                })
            }

            // --------------------------------------------------
            // LIMITE DE USO
            // --------------------------------------------------

            if (
                cupom.quantidade_uso !== null &&
                Number(cupom.usado) >=
                Number(cupom.quantidade_uso)
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Este cupom atingiu o limite de utilização"
                })
            }

            // --------------------------------------------------
            // CALCULAR DESCONTO
            // --------------------------------------------------

            if (cupom.tipo === "percentual") {
                desconto =
                    subtotal *
                    (Number(cupom.valor) / 100)
            } else {
                desconto =
                    Number(cupom.valor)
            }

            if (desconto > subtotal) {
                desconto = subtotal
            }

            cupomId = cupom.id
        }

        // ======================================================
        // ENTREGA
        // ======================================================

        let frete = 0
        let prazoEntrega = ""

        switch (tipoEntrega) {
            case "padrão":
                frete = 0
                prazoEntrega = "5 a 7 dias úteis"
                break

            case "expressa":
                frete = 25
                prazoEntrega = "3 a 5 dias úteis"
                break

            case "retirada":
                frete = 0
                prazoEntrega =
                    "Disponível em 24h para retirada na loja"
                break
        }

        // ======================================================
        // TOTAL
        // ======================================================

        const total =
            Number(subtotal) -
            Number(desconto) +
            Number(frete)

        // ======================================================
        // CRIAR PEDIDO
        // ======================================================

        const [pedido] = await connection.query(
            `
            INSERT INTO pedidos (
                usuario_id,
                subtotal,
                desconto,
                frete,
                total,
                forma_pagamento,
                tipo_entrega,
                prazo_entrega,
                cupom_id,

                endereco_nome_destinatario,
                endereco_telefone,
                endereco_rua,
                endereco_numero,
                endereco_bairro,
                endereco_cidade,
                endereco_estado,
                endereco_cep,

                cartao_bandeira,
                cartao_final,
                cartao_nome_titular
            )

            VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?
            )
            `,
            [
                usuarioId,

                Number(subtotal.toFixed(2)),
                Number(desconto.toFixed(2)),
                Number(frete.toFixed(2)),
                Number(total.toFixed(2)),

                formaPagamento,
                tipoEntrega,
                prazoEntrega,
                cupomId,

                tipoEntrega !== "retirada"
                    ? endereco.nome
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.telefone
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.endereco
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.numero
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.bairro
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.cidade
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.uf
                    : null,

                tipoEntrega !== "retirada"
                    ? endereco.cep
                    : null,

                cartaoBandeira,
                cartaoFinal,
                cartaoNomeTitular
            ]
        )

        const pedidoId = pedido.insertId

        // ======================================================
        // HISTÓRICO INICIAL
        // ======================================================

        await connection.query(
            `
            INSERT INTO historico_pedidos
            (
                pedido_id,
                status
            )
            VALUES (?, ?)
            `,
            [
                pedidoId,
                "pendente"
            ]
        )

        // ======================================================
        // PAGAMENTO
        // ======================================================

        let pagamento = null

        let txid = null
        let codigoPix = null

        // ======================================================
        // PIX — MERCADO PAGO
        // ======================================================

        if (formaPagamento === "pix") {
            const emailPagador =
                (
                    req.body.emailPagamento ||
                    req.usuario.email ||
                    "test_user@test.com"
                ).trim()

            const mpResposta = pagamentoMock
                ? await gerarPagamentoMock({
                    tipo: "pix",
                    pedidoId,
                    valor: total
                })
                : await mpPayment.create({
                body: {
                    transaction_amount:
                        Number(Number(total).toFixed(2)),

                    description:
                        `Pedido #${pedidoId} - Joalheria`,

                    payment_method_id: "pix",

                    payer: {
                        email: emailPagador
                    },
                },

                requestOptions: {
                    idempotencyKey:
                        `pedido-${pedidoId}-pix`
                },
            })

            const dadosPix =
                mpResposta
                    .point_of_interaction
                    ?.transaction_data || {}

            txid = String(mpResposta.id)

            codigoPix =
                dadosPix.qr_code || null

            const qrBase64 =
                dadosPix.qr_code_base64 || null

            const [pagamentoCriado] =
                await connection.query(
                    `
                    INSERT INTO pagamentos
                        (
                            pedido_id,
                            tipo,
                            status,
                            status_gateway,
                            valor,
                            transacao_id,
                            pix_codigo,
                            pix_qr_base64
                        )

                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        pedidoId,
                        "pix",
                        "pendente",
                        mpResposta.status,
                        total,
                        txid,
                        codigoPix,
                        qrBase64
                    ]
                )

            pagamento = {
                id: pagamentoCriado.insertId,
                tipo: "pix",
                status: "pendente",
                valor: Number(total),
                transacaoId: txid,
                codigoPix,
                qrCodeBase64: qrBase64,
                expiracaoMinutos: 30,
                ambiente: pagamentoMock ? "static_pix" : "mercadopago",
            }
        }

        // ======================================================
        // CARTÃO — MERCADO PAGO
        // ======================================================

        else if (formaPagamento === "cartao") {
            const {
                cardToken,
                paymentMethodId,
                installments,
                issuerId,
                emailPagamento,
                cpf
            } = req.body.dadosCartao || {}

            if (!pagamentoMock && (!cardToken || !paymentMethodId)) {
                throw new Error(
                    "Dados do cartao invalidos (token ausente)"
                )
            }

            const mpResposta = pagamentoMock
                ? await gerarPagamentoMock({
                    tipo: "cartao",
                    pedidoId,
                    valor: total,
                    status: dadosCartao.mockStatus
                })
                : await mpPayment.create({
                body: {
                    transaction_amount:
                        Number(Number(total).toFixed(2)),

                    token: cardToken,

                    description:
                        `Pedido #${pedidoId} - Joalheria`,

                    installments:
                        Number(installments) || 1,

                    payment_method_id:
                        paymentMethodId,

                    issuer_id:
                        issuerId
                            ? Number(issuerId)
                            : undefined,

                    payer: {
                        email:
                            (
                                emailPagamento ||
                                req.usuario.email ||
                                ""
                            ).trim(),

                        identification:
                            cpf
                                ? {
                                    type: "CPF",
                                    number: String(cpf)
                                }
                                : undefined,
                    },
                },

                requestOptions: {
                    idempotencyKey:
                        `pedido-${pedidoId}-card`
                },
            })

            const mapa =
                mapearStatusMP(mpResposta.status)

            const [pagamentoCriado] =
                await connection.query(
                    `
                    INSERT INTO pagamentos
                        (
                            pedido_id,
                            tipo,
                            status,
                            status_gateway,
                            valor,
                            transacao_id
                        )

                    VALUES (?, ?, ?, ?, ?, ?)
                    `,
                    [
                        pedidoId,
                        "cartao",
                        mapa.pagamento,
                        mpResposta.status,
                        total,
                        String(mpResposta.id)
                    ]
                )

            pagamento = {
                id: pagamentoCriado.insertId,
                tipo: "cartao",
                status: mapa.pagamento,
                valor: Number(total),
                transacaoId:
                    String(mpResposta.id),
            }

            if (mapa.pedido === "pago") {
                await connection.query(
                    `
                    UPDATE pedidos
                    SET status_pedido = 'pago'
                    WHERE id = ?
                    `,
                    [pedidoId]
                )

                await connection.query(
                    `
                    INSERT INTO historico_pedidos
                    (
                        pedido_id,
                        status
                    )
                    VALUES (?, ?)
                    `,
                    [
                        pedidoId,
                        "pago"
                    ]
                )
            } else if (
                mapa.pagamento === "recusado"
            ) {
                throw new Error(
                    "Pagamento recusado pela operadora do cartao"
                )
            }
        }

        // ======================================================
        // BOLETO
        // ======================================================

        else {
            const [pagamentoCriado] =
                await connection.query(
                    `
                    INSERT INTO pagamentos
                        (
                            pedido_id,
                            tipo,
                            status,
                            valor
                        )

                    VALUES (?, ?, ?, ?)
                    `,
                    [
                        pedidoId,
                        formaPagamento,
                        "pendente",
                        total
                    ]
                )

            pagamento = {
                id: pagamentoCriado.insertId,
                tipo: formaPagamento,
                status: "pendente",
                valor: Number(total),
            }
        }

        // ======================================================
        // ITENS DO PEDIDO
        // ======================================================

        for (const item of itensCarrinho) {
            const preco =
                obterPrecoItem(item)

            const subtotalItem =
                preco *
                Number(item.quantidade)

            await connection.query(
                `
                INSERT INTO pedidos_itens (
                    pedido_id,
                    produto_id,
                    variacao_id,
                    quantidade,
                    preco_unitario,
                    subtotal
                )

                VALUES (?, ?, ?, ?, ?, ?)
                `,
                [
                    pedidoId,
                    item.produto_id,
                    item.variacao_id || null,
                    item.quantidade,
                    preco,
                    subtotalItem
                ]
            )
        }

        // ======================================================
        // ATUALIZAR ESTOQUE
        // ======================================================

        for (const item of itensCarrinho) {
            if (item.variacao_id) {

                const [resultadoEstoque] =
                    await connection.query(
                        `
                        UPDATE produto_variacoes
                        SET estoque = estoque - ?
                        WHERE id = ?
                        AND estoque >= ?
                        `,
                        [
                            item.quantidade,
                            item.variacao_id,
                            item.quantidade
                        ]
                    )

                if (
                    resultadoEstoque.affectedRows === 0
                ) {
                    throw new Error(
                        `Estoque insuficiente para a variação de ${item.nome}`
                    )
                }

            } else {

                const [resultadoEstoque] =
                    await connection.query(
                        `
                        UPDATE produtos
                        SET estoque = estoque - ?
                        WHERE id = ?
                        AND estoque >= ?
                        `,
                        [
                            item.quantidade,
                            item.produto_id,
                            item.quantidade
                        ]
                    )

                if (
                    resultadoEstoque.affectedRows === 0
                ) {
                    throw new Error(
                        `Estoque insuficiente para o produto ${item.nome}`
                    )
                }
            }
        }

        // ======================================================
        // REGISTRAR USO DO CUPOM
        // ======================================================

        if (cupomId) {
            await connection.query(
                `
                UPDATE cupons
                SET usado = usado + 1
                WHERE id = ?
                `,
                [cupomId]
            )
        }

        // ======================================================
        // LIMPAR CARRINHO
        // ======================================================

        await connection.query(
            `
            DELETE FROM carrinho_itens
            WHERE carrinho_id = ?
            `,
            [carrinhoId]
        )

        // ======================================================
        // COMMIT
        // ======================================================

        await connection.commit()

        return res.status(201).json({
            sucesso: true,

            mensagem:
                formaPagamento === "pix"
                    ? "Pedido criado. Aguardando pagamento PIX."
                    : "Pedido realizado com sucesso!",

            pedidoId,

            total: Number(total),

            status:
                formaPagamento === "cartao"
                    ? "pago"
                    : "pendente",

            formaPagamento,

            pagamento
        })

    } catch (error) {

        await connection.rollback()

        console.error(
            "ERRO AO FINALIZAR PEDIDO:",
            error
        )

        return res.status(500).json({
            erro:
                error.message ||
                "Erro ao finalizar o pedido"
        })

    } finally {
        connection.release()
    }
})

// ======================================================
// SIMULAR PAGAMENTO PIX
// ======================================================

router.post(
    "/:id/pix/simular-pagamento",
    autenticarToken,
    async (req, res) => {

        const connection =
            await db.getConnection()

        try {
            await connection.beginTransaction()

            const pedidoId =
                req.params.id

            const usuarioId =
                req.usuario.id

            // ==================================================
            // BUSCAR PEDIDO
            // ==================================================

            const [pedidos] =
                await connection.query(
                    `
                    SELECT *
                    FROM pedidos
                    WHERE id = ?
                    AND usuario_id = ?
                    FOR UPDATE
                    `,
                    [
                        pedidoId,
                        usuarioId
                    ]
                )

            if (pedidos.length === 0) {
                await connection.rollback()

                return res.status(404).json({
                    erro: "Pedido não encontrado"
                })
            }

            const pedido = pedidos[0]

            // ==================================================
            // VALIDAR FORMA DE PAGAMENTO
            // ==================================================

            if (
                pedido.forma_pagamento !== "pix"
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Este pedido não utiliza PIX"
                })
            }

            // ==================================================
            // VALIDAR STATUS
            // ==================================================

            if (
                pedido.status_pedido === "pago"
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Este pedido já está pago"
                })
            }

            if (
                pedido.status_pedido === "cancelado"
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Este pedido foi cancelado"
                })
            }

            // ==================================================
            // ATUALIZAR PAGAMENTO
            // ==================================================

            const [pagamentoAtualizado] =
                await connection.query(
                    `
                    UPDATE pagamentos
                    SET status = 'aprovado'
                    WHERE pedido_id = ?
                    AND tipo = 'pix'
                    AND status = 'pendente'
                    `,
                    [pedidoId]
                )

            if (
                pagamentoAtualizado.affectedRows === 0
            ) {
                await connection.rollback()

                return res.status(400).json({
                    erro: "Pagamento PIX não encontrado ou já processado"
                })
            }

            // ==================================================
            // ATUALIZAR PEDIDO
            // ==================================================

            await connection.query(
                `
                UPDATE pedidos
                SET status_pedido = 'pago'
                WHERE id = ?
                `,
                [pedidoId]
            )

            // ==================================================
            // HISTÓRICO
            // ==================================================

            await connection.query(
                `
                INSERT INTO historico_pedidos
                (
                    pedido_id,
                    status
                )
                VALUES (?, ?)
                `,
                [
                    pedidoId,
                    "pago"
                ]
            )

            await connection.commit()

            return res.json({
                sucesso: true,
                mensagem: "Pagamento PIX aprovado",
                pedidoId: Number(pedidoId),
                status: "pago",
                valor: Number(pedido.total)
            })

        } catch (error) {

            await connection.rollback()

            console.error(
                "ERRO AO SIMULAR PIX:",
                error
            )

            return res.status(500).json({
                erro: "Erro ao validar pagamento PIX"
            })

        } finally {
            connection.release()
        }
    }
) 

// ======================================================
// MEUS PEDIDOS
// ======================================================

router.get(
    "/meus-pedidos",
    autenticarToken,
    async (req, res) => {

        try {

            const usuarioId =
                req.usuario.id

            // ==================================================
            // PEDIDOS
            // ==================================================

            const [pedidos] =
                await db.query(
                    `
                    SELECT *
                    FROM pedidos
                    WHERE usuario_id = ?
                    ORDER BY criado_em DESC
                    `,
                    [usuarioId]
                )

            if (pedidos.length === 0) {
                return res.json([])
            }

            const pedidoIds =
                pedidos.map(
                    pedido => pedido.id
                )

            // ==================================================
            // ITENS
            // ==================================================

            const [itens] =
                await db.query(
                    `
                    SELECT
                        pi.pedido_id,
                        pi.produto_id,
                        pi.variacao_id,
                        pi.quantidade,
                        pi.preco_unitario,
                        pi.subtotal,

                        p.nome,
                        p.imagem,

                        pv.tipo AS variacao_tipo,
                        pv.valor AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos p
                        ON p.id = pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id = pi.variacao_id

                    WHERE pi.pedido_id IN (?)
                    `,
                    [pedidoIds]
                )

            // ==================================================
            // HISTÓRICO
            // ==================================================

            const [historico] =
                await db.query(
                    `
                    SELECT
                        pedido_id,
                        status,
                        criado_em

                    FROM historico_pedidos

                    WHERE pedido_id IN (?)

                    ORDER BY criado_em ASC
                    `,
                    [pedidoIds]
                )

            // ==================================================
            // PAGAMENTOS
            // ==================================================

            const [pagamentos] =
                await db.query(
                    `
                    SELECT
                        id,
                        pedido_id,
                        tipo,
                        status,
                        valor,
                        transacao_id,
                        pix_codigo,
                        pix_qr_code,
                        criado_em,
                        atualizado_em

                    FROM pagamentos

                    WHERE pedido_id IN (?)
                    `,
                    [pedidoIds]
                )

            // ==================================================
            // MONTAR PEDIDOS
            // ==================================================

            const pedidosCompletos =
                pedidos.map(pedido => ({

                    ...pedido,

                    itens:
                        itens.filter(
                            item =>
                                Number(item.pedido_id) ===
                                Number(pedido.id)
                        ),

                    timeline:
                        historico.filter(
                            evento =>
                                Number(evento.pedido_id) ===
                                Number(pedido.id)
                        ),

                    pagamento:
                        pagamentos.find(
                            pagamento =>
                                Number(pagamento.pedido_id) ===
                                Number(pedido.id)
                        ) || null
                }))

            return res.json(
                pedidosCompletos
            )

        } catch (error) {

            console.error(
                "ERRO AO CARREGAR MEUS PEDIDOS:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao carregar os seus pedidos"
            })
        }
    }
)

// ======================================================
// ADMIN — LISTAR PEDIDOS
// ======================================================

router.get(
    "/pedidos-admin",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {

        try {

            const [pedidos] =
                await db.query(
                    `
                    SELECT
                        p.id,
                        p.total,
                        p.subtotal,
                        p.desconto,
                        p.frete,
                        p.status_pedido,
                        p.forma_pagamento,
                        p.tipo_entrega,
                        p.criado_em,

                        u.nome AS cliente_nome,
                        u.email AS cliente_email,

                        COUNT(pi.id)
                            AS quantidade_itens

                    FROM pedidos p

                    INNER JOIN usuarios u
                        ON u.id = p.usuario_id

                    LEFT JOIN pedidos_itens pi
                        ON pi.pedido_id = p.id

                    GROUP BY
                        p.id,
                        p.total,
                        p.subtotal,
                        p.desconto,
                        p.frete,
                        p.status_pedido,
                        p.forma_pagamento,
                        p.tipo_entrega,
                        p.criado_em,
                        u.nome,
                        u.email

                    ORDER BY
                        p.criado_em DESC
                    `
                )

            return res.json(pedidos)

        } catch (error) {

            console.error(
                "ERRO AO BUSCAR PEDIDOS ADMIN:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao buscar os pedidos"
            })
        }
    }
)

// ======================================================
// ADMIN — DETALHE DO PEDIDO
// ======================================================

router.get(
    "/pedidos-admin/:id",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {

        try {

            const pedidoId =
                req.params.id

            // ==================================================
            // PEDIDO
            // ==================================================

            const [pedido] =
                await db.query(
                    `
                    SELECT
                        p.*,

                        u.nome AS cliente_nome,
                        u.email AS cliente_email

                    FROM pedidos p

                    INNER JOIN usuarios u
                        ON u.id = p.usuario_id

                    WHERE p.id = ?
                    `,
                    [pedidoId]
                )

            if (pedido.length === 0) {
                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }

            // ==================================================
            // ITENS
            // ==================================================

            const [itens] =
                await db.query(
                    `
                    SELECT
                        pi.*,

                        pr.nome,
                        pr.imagem,

                        pv.tipo AS variacao_tipo,
                        pv.valor AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos pr
                        ON pr.id = pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id = pi.variacao_id

                    WHERE pi.pedido_id = ?
                    `,
                    [pedidoId]
                )

            // ==================================================
            // TIMELINE
            // ==================================================

            const [timeline] =
                await db.query(
                    `
                    SELECT
                        status,
                        criado_em

                    FROM historico_pedidos

                    WHERE pedido_id = ?

                    ORDER BY criado_em ASC
                    `,
                    [pedidoId]
                )

            // ==================================================
            // PAGAMENTOS
            // ==================================================

            const [pagamentos] =
                await db.query(
                    `
                    SELECT
                        id,
                        tipo,
                        status,
                        valor,
                        transacao_id,
                        criado_em,
                        atualizado_em

                    FROM pagamentos

                    WHERE pedido_id = ?
                    `,
                    [pedidoId]
                )

            // ==================================================
            // REMOVER DADOS SENSÍVEIS DO CARTÃO
            // ==================================================

            const {
                cartao_bandeira,
                cartao_final,
                cartao_nome_titular,
                ...pedidoSemCartao
            } = pedido[0]

            return res.json({

                pedido: {
                    ...pedidoSemCartao,

                    cartao: cartao_bandeira
                        ? {
                            bandeira:
                                cartao_bandeira,

                            final:
                                cartao_final,

                            nomeTitular:
                                cartao_nome_titular
                        }
                        : null
                },

                itens,

                timeline,

                pagamentos
            })

        } catch (error) {

            console.error(
                "ERRO AO BUSCAR DETALHE DO PEDIDO:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao buscar os detalhes do pedido"
            })
        }
    }
)

// ======================================================
// ADMIN — ALTERAR STATUS
// ======================================================

router.put(
    "/pedidos-admin/:id/status",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {

        const connection =
            await db.getConnection()

        try {

            await connection.beginTransaction()

            const pedidoId =
                req.params.id

            const { status } =
                req.body

            const statusValido = [
                "pendente",
                "pago",
                "separacao",
                "enviado",
                "entregue",
                "cancelado"
            ]

            // ==================================================
            // VALIDAR STATUS
            // ==================================================

            if (
                !statusValido.includes(status)
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro: "Status inválido"
                })
            }

            // ==================================================
            // BUSCAR PEDIDO
            // ==================================================

            const [pedidos] =
                await connection.query(
                    `
                    SELECT *
                    FROM pedidos
                    WHERE id = ?
                    FOR UPDATE
                    `,
                    [pedidoId]
                )

            if (pedidos.length === 0) {

                await connection.rollback()

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }

            const pedido = pedidos[0]

            // ==================================================
            // EVITAR ALTERAÇÃO DESNECESSÁRIA
            // ==================================================

            if (
                pedido.status_pedido === status
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "O pedido já está com este status"
                })
            }

            // ==================================================
            // ATUALIZAR PEDIDO
            // ==================================================

            await connection.query(
                `
                UPDATE pedidos

                SET status_pedido = ?

                WHERE id = ?
                `,
                [
                    status,
                    pedidoId
                ]
            )

            // ==================================================
            // HISTÓRICO
            // ==================================================

            await connection.query(
                `
                INSERT INTO historico_pedidos
                (
                    pedido_id,
                    status
                )

                VALUES (?, ?)
                `,
                [
                    pedidoId,
                    status
                ]
            )

            await connection.commit()

            return res.json({

                sucesso: true,

                mensagem:
                    "Status do pedido atualizado com sucesso",

                pedidoId:
                    Number(pedidoId),

                status
            })

        } catch (error) {

            await connection.rollback()

            console.error(
                "ERRO AO ATUALIZAR STATUS:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao atualizar o status do pedido"
            })

        } finally {

            connection.release()
        }
    }
)

// ======================================================
// DETALHE DO PEDIDO DO USUÁRIO
// ======================================================

router.get(
    "/:id",
    autenticarToken,
    async (req, res) => {

        try {

            const usuarioId =
                req.usuario.id

            const pedidoId =
                req.params.id

            // ==================================================
            // PEDIDO
            // ==================================================

            const [pedido] =
                await db.query(
                    `
                    SELECT *
                    FROM pedidos

                    WHERE id = ?

                    AND usuario_id = ?
                    `,
                    [
                        pedidoId,
                        usuarioId
                    ]
                )

            if (pedido.length === 0) {

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }

            // ==================================================
            // ITENS
            // ==================================================

            const [itens] =
                await db.query(
                    `
                    SELECT
                        pi.*,

                        p.nome,
                        p.imagem,

                        pv.tipo AS variacao_tipo,
                        pv.valor AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos p
                        ON p.id = pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id = pi.variacao_id

                    WHERE pi.pedido_id = ?
                    `,
                    [pedidoId]
                )

            // ==================================================
            // TIMELINE
            // ==================================================

            const [timeline] =
                await db.query(
                    `
                    SELECT
                        status,
                        criado_em

                    FROM historico_pedidos

                    WHERE pedido_id = ?

                    ORDER BY criado_em ASC
                    `,
                    [pedidoId]
                )

            // ==================================================
            // PAGAMENTO
            // ==================================================

            const [pagamentos] =
                await db.query(
                    `
                    SELECT
                        id,
                        pedido_id,
                        tipo,
                        status,
                        valor,
                        transacao_id,
                        pix_codigo,
                        pix_qr_code,
                        criado_em,
                        atualizado_em

                    FROM pagamentos

                    WHERE pedido_id = ?
                    `,
                    [pedidoId]
                )

            // ==================================================
            // RESPOSTA
            // ==================================================

            return res.json({

                pedido: pedido[0],

                itens,

                timeline,

                pagamento:
                    pagamentos[0] || null
            })

        } catch (error) {

            console.error(
                "ERRO AO BUSCAR PEDIDO:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao buscar pedido"
            })
        }
    }
)



// ======================================================
// CONSULTA DE STATUS DO PAGAMENTO
// Front faz polling no PIX
// ======================================================

router.get(
    "/:id/pagamento/status",
    autenticarToken,
    async (req, res) => {

        const connection =
            await db.getConnection()

        try {

            const pedidoId =
                req.params.id

            const usuarioId =
                req.usuario.id

            // ==================================================
            // BUSCAR PAGAMENTO DO PEDIDO
            // ==================================================

            const [pags] =
                await connection.query(
                    `
                    SELECT
                        p.*

                    FROM pagamentos p

                    JOIN pedidos pe
                        ON pe.id = p.pedido_id

                    WHERE p.pedido_id = ?

                    AND pe.usuario_id = ?

                    ORDER BY p.id DESC

                    LIMIT 1
                    `,
                    [
                        pedidoId,
                        usuarioId
                    ]
                )

            if (pags.length === 0) {

                return res.status(404).json({
                    erro:
                        "Pagamento nao encontrado"
                })
            }

            const pagamento =
                pags[0]

            // ==================================================
            // CONSULTAR MERCADO PAGO
            // ==================================================

            if (pagamento.transacao_id && !pagamentoMock) {

                const mp =
                    await mpPayment.get({
                        id: pagamento.transacao_id
                    })

                const mapa =
                    mapearStatusMP(
                        mp.status
                    )

                // ==================================================
                // STATUS MUDOU
                // ==================================================

                if (
                    mapa.pagamento !==
                    pagamento.status
                ) {

                    await connection.beginTransaction()

                    // ------------------------------------------
                    // ATUALIZAR PAGAMENTO
                    // ------------------------------------------

                    await connection.query(
                        `
                        UPDATE pagamentos

                        SET
                            status = ?,
                            status_gateway = ?

                        WHERE id = ?
                        `,
                        [
                            mapa.pagamento,
                            mp.status,
                            pagamento.id
                        ]
                    )

                    // ------------------------------------------
                    // PAGAMENTO APROVADO
                    // ------------------------------------------

                    if (
                        mapa.pedido === "pago"
                    ) {

                        await connection.query(
                            `
                            UPDATE pedidos

                            SET status_pedido = 'pago'

                            WHERE id = ?
                            `,
                            [pedidoId]
                        )

                        // --------------------------------------
                        // HISTÓRICO
                        // --------------------------------------

                        await connection.query(
                            `
                            INSERT INTO historico_pedidos
                            (
                                pedido_id,
                                status
                            )

                            VALUES (?, ?)
                            `,
                            [
                                pedidoId,
                                "pago"
                            ]
                        )
                    }

                    await connection.commit()

                    pagamento.status =
                        mapa.pagamento
                }
            }

            // ==================================================
            // RESPOSTA
            // ==================================================

            return res.json({

                pedidoId:
                    Number(pedidoId),

                status:
                    pagamento.status
            })

        } catch (error) {

            console.error(
                "ERRO STATUS PAGAMENTO:",
                error
            )

            return res.status(500).json({
                erro:
                    "Erro ao consultar status"
            })

        } finally {

            connection.release()
        }
    }
)


// ======================================================
// WEBHOOK MERCADO PAGO
//
// IMPORTANTE:
// NÃO usa autenticarToken.
//
// O Mercado Pago acessa esta rota diretamente.
// ======================================================

router.post(
    "/webhook/mercadopago",
    async (req, res) => {

        try {

            // ==================================================
            // HEADERS DO MERCADO PAGO
            // ==================================================

            const xSignature =
                req.headers["x-signature"]

            const xRequestId =
                req.headers["x-request-id"]

            // ==================================================
            // ID DA TRANSAÇÃO
            // ==================================================

            const dataId =
                req.query["data.id"] ||
                req.body?.data?.id

            // ==================================================
            // VALIDAR ASSINATURA
            // ==================================================

            /*
             * Em produção, se MP_WEBHOOK_SECRET estiver
             * configurado, a assinatura será obrigatoriamente
             * validada.
             *
             * Em ambiente local, caso a variável não exista,
             * o webhook poderá ser testado sem assinatura.
             */

            if (
                process.env.MP_WEBHOOK_SECRET
            ) {

                const ok =
                    validarAssinaturaWebhook({
                        xSignature,
                        xRequestId,
                        dataId
                    })

                if (!ok) {

                    return res
                        .status(401)
                        .send(
                            "assinatura invalida"
                        )
                }
            }

            // ==================================================
            // TIPO DO EVENTO
            // ==================================================

            const tipo =
                req.query.type ||
                req.body?.type

            // ==================================================
            // IGNORAR EVENTOS QUE NÃO SÃO PAYMENT
            // ==================================================

            if (
                tipo !== "payment" ||
                !dataId
            ) {

                return res
                    .status(200)
                    .send("ignorado")
            }

                    if (pagamentoMock) {
                    return res
                        .status(200)
                        .send("ignorado no modo mock")
                    }

            // ==================================================
            // CONSULTAR PAGAMENTO NO MERCADO PAGO
            // ==================================================

            const mp =
                await mpPayment.get({
                    id: dataId
                })

            const mapa =
                mapearStatusMP(
                    mp.status
                )

            // ==================================================
            // CONEXÃO COM BANCO
            // ==================================================

            const connection =
                await db.getConnection()

            try {

                await connection.beginTransaction()

                // ==================================================
                // LOCALIZAR PAGAMENTO
                // ==================================================

                const [pags] =
                    await connection.query(
                        `
                        SELECT *

                        FROM pagamentos

                        WHERE transacao_id = ?

                        LIMIT 1
                        `,
                        [
                            String(dataId)
                        ]
                    )

                // ==================================================
                // PAGAMENTO ENCONTRADO
                // ==================================================

                if (
                    pags.length > 0
                ) {

                    const pg =
                        pags[0]

                    // ----------------------------------------------
                    // ATUALIZAR PAGAMENTO
                    // ----------------------------------------------

                    await connection.query(
                        `
                        UPDATE pagamentos

                        SET
                            status = ?,
                            status_gateway = ?

                        WHERE id = ?
                        `,
                        [
                            mapa.pagamento,
                            mp.status,
                            pg.id
                        ]
                    )

                    // ----------------------------------------------
                    // PAGAMENTO APROVADO
                    // ----------------------------------------------

                    if (
                        mapa.pedido === "pago"
                    ) {

                        await connection.query(
                            `
                            UPDATE pedidos

                            SET status_pedido = 'pago'

                            WHERE id = ?
                            `,
                            [
                                pg.pedido_id
                            ]
                        )

                        // ------------------------------------------
                        // HISTÓRICO
                        // ------------------------------------------

                        await connection.query(
                            `
                            INSERT INTO historico_pedidos
                            (
                                pedido_id,
                                status
                            )

                            VALUES (?, ?)
                            `,
                            [
                                pg.pedido_id,
                                "pago"
                            ]
                        )
                    }
                }

                await connection.commit()

            } catch (e) {

                await connection.rollback()

                throw e

            } finally {

                connection.release()
            }

            // ==================================================
            // RESPOSTA
            // ==================================================

            return res
                .status(200)
                .send("ok")

        } catch (error) {

            console.error(
                "ERRO WEBHOOK MP:",
                error
            )

            /*
             * O Mercado Pago espera uma resposta 200 para
             * evitar reenvios infinitos do webhook.
             */

            return res
                .status(200)
                .send("ok")
        }
    }
)
export default router