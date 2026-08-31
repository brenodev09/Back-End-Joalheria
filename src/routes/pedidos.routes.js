/* =========================================================================
   ARQUIVO: src/routes/pedidos.routes.js
   ========================================================================= */

import express from "express"

import db from "../database.js"

import {
    autenticarToken
} from "../middlewares/autenticacao.js"

import {
    mpPayment,
    pagamentoMock,
    gerarPagamentoMock,
    mapearStatusMP,
    validarAssinaturaWebhook
} from "../services/mercadopago.js"

import {
    enviarEmail,
    enviarEmailAdministradores
} from "../services/notificacoes.js"
import { statusEfetivoLoja } from "../services/configuracoes.js"
import { validarConfiguracao } from "../services/personalizacoes.js"


const router = express.Router()


// ======================================================
// CONFIGURAÇÕES
// ======================================================

const prazoPagamentoMinutos =
    Number(
        process.env.PAYMENT_EXPIRATION_MINUTES || 30
    )


// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================


function obterPrecoItem(item) {

    if (
        item.preco_personalizado !== null &&
        item.preco_personalizado !== undefined
    ) {
        return Number(item.preco_personalizado)
    }

    if (item.variacao_id) {

        return Number(
            item.preco_variacao
        )
    }

    return Number(
        item.preco_produto
    )
}


// ======================================================
// ADMIN
// ======================================================

function apenasAdmin(req, res, next) {

    if (
        req.usuario?.tipo !== "admin"
    ) {

        return res.status(403).json({
            erro:
                "Acesso permitido somente para administradores"
        })
    }

    next()
}


// ======================================================
// NOTIFICAR ADMINISTRADORES
// ======================================================

async function notificarAdministradores(
    connection,
    pedidoId,
    mensagem
) {

    await connection.query(
        `
        INSERT INTO notificacoes
            (
                usuario_id,
                pedido_id,
                tipo,
                mensagem
            )

        SELECT
            id,
            ?,
            'pedido',
            ?

        FROM usuarios

        WHERE tipo = 'admin'
        AND ativo = TRUE
        `,
        [
            pedidoId,
            mensagem
        ]
    )
}


// ======================================================
// REGISTRAR USO DO CUPOM
// ======================================================

async function registrarUsoCupom(
    connection,
    pedidoId
) {

    const [pedidoCupom] =
        await connection.query(
            `
            SELECT
                usuario_id,
                cupom_id,
                desconto

            FROM pedidos

            WHERE id = ?

            FOR UPDATE
            `,
            [pedidoId]
        )


    if (
        !pedidoCupom.length ||
        !pedidoCupom[0].cupom_id
    ) {

        return
    }


    const cupomId =
        pedidoCupom[0].cupom_id

    const usuarioId =
        pedidoCupom[0].usuario_id


    const [usoExistente] =
        await connection.query(
            `
            SELECT id

            FROM cupons_usos

            WHERE cupom_id = ?
            AND pedido_id = ?

            LIMIT 1
            `,
            [
                cupomId,
                pedidoId
            ]
        )


    if (usoExistente.length > 0) {

        return
    }


    await connection.query(
        `
        INSERT INTO cupons_usos
            (
                cupom_id,
                usuario_id,
                pedido_id,
                valor_desconto
            )

        VALUES (?, ?, ?, ?)
        `,
        [
            cupomId,
            usuarioId,
            pedidoId,
            pedidoCupom[0].desconto
        ]
    )


    await connection.query(
        `
        UPDATE cupons

        SET usado =
            COALESCE(usado, 0) + 1

        WHERE id = ?
        `,
        [cupomId]
    )
}


// ======================================================
// CONFIRMAR PAGAMENTO
// ======================================================

async function confirmarPagamentoPedido(
    connection,
    {
        pedidoId,
        pagamentoId,
        statusGateway = "approved"
    }
) {

    // ==================================================
    // BUSCAR PAGAMENTO
    // ==================================================

    const [pagamentos] =
        await connection.query(
            `
            SELECT *

            FROM pagamentos

            WHERE id = ?

            FOR UPDATE
            `,
            [pagamentoId]
        )


    if (!pagamentos.length) {

        throw new Error(
            "Pagamento não encontrado"
        )
    }


    const pagamento =
        pagamentos[0]


    // ==================================================
    // JÁ PROCESSADO
    // ==================================================

    if (
        pagamento.status === "aprovado"
    ) {

        return {
            jaProcessado: true,
            pedidoPago: true
        }
    }


    // ==================================================
    // ATUALIZAR PAGAMENTO
    // ==================================================

    await connection.query(
        `
        UPDATE pagamentos

        SET
            status = 'aprovado',
            status_gateway = ?

        WHERE id = ?
        `,
        [
            statusGateway,
            pagamento.id
        ]
    )


    // ==================================================
    // PEDIDO
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


    if (!pedidos.length) {

        throw new Error(
            "Pedido não encontrado"
        )
    }


    const pedido =
        pedidos[0]


    // ==================================================
    // PEDIDO JÁ PAGO
    // ==================================================

    if (
        pedido.status_pedido === "pago"
    ) {

        await registrarUsoCupom(
            connection,
            pedidoId
        )

        return {
            jaProcessado: true,
            pedidoPago: true
        }
    }


    // ==================================================
    // VALIDAR EXPIRAÇÃO
    // ==================================================

    if (
        pedido.data_expiracao_pagamento &&
        new Date(
            pedido.data_expiracao_pagamento
        ) <= new Date()
    ) {

        throw new Error(
            "O prazo para pagamento deste pedido terminou"
        )
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

        VALUES (?, 'pago')
        `,
        [pedidoId]
    )


    // ==================================================
    // CUPOM
    // ==================================================

    await registrarUsoCupom(
        connection,
        pedidoId
    )


    // ==================================================
    // NOTIFICAÇÃO
    // ==================================================

    await notificarAdministradores(
        connection,
        pedidoId,
        `Pagamento confirmado no pedido #${pedidoId}`
    )


    return {
        jaProcessado: false,
        pedidoPago: true
    }
}


// ======================================================
// CANCELAR PEDIDOS EXPIRADOS
// ======================================================

export async function cancelarPedidosExpirados() {

    const connection =
        await db.getConnection()

    const emails = []


    try {

        await connection.beginTransaction()


        const [pedidos] =
            await connection.query(
                `
                SELECT id

                FROM pedidos

                WHERE status_pedido = 'pendente'

                AND data_expiracao_pagamento
                    IS NOT NULL

                AND data_expiracao_pagamento
                    <= NOW()

                FOR UPDATE
                `
            )


        for (const pedido of pedidos) {

            const [atualizado] =
                await connection.query(
                    `
                    UPDATE pedidos

                    SET status_pedido = 'cancelado'

                    WHERE id = ?

                    AND status_pedido = 'pendente'
                    `,
                    [pedido.id]
                )


            if (
                atualizado.affectedRows === 0
            ) {

                continue
            }


            const [itens] =
                await connection.query(
                    `
                    SELECT
                        produto_id,
                        variacao_id,
                        quantidade

                    FROM pedidos_itens

                    WHERE pedido_id = ?
                    `,
                    [pedido.id]
                )


            for (const item of itens) {

                if (item.variacao_id) {

                    await connection.query(
                        `
                        UPDATE produto_variacoes

                        SET estoque =
                            estoque + ?

                        WHERE id = ?
                        `,
                        [
                            item.quantidade,
                            item.variacao_id
                        ]
                    )

                } else {

                    await connection.query(
                        `
                        UPDATE produtos

                        SET estoque =
                            estoque + ?

                        WHERE id = ?
                        `,
                        [
                            item.quantidade,
                            item.produto_id
                        ]
                    )
                }
            }


            await connection.query(
                `
                UPDATE pagamentos

                SET status = 'expirado'

                WHERE pedido_id = ?

                AND status = 'pendente'
                `,
                [pedido.id]
            )


            await connection.query(
                `
                INSERT INTO historico_pedidos
                    (
                        pedido_id,
                        status
                    )

                VALUES (?, 'cancelado')
                `,
                [pedido.id]
            )


            const [usuarios] =
                await connection.query(
                    `
                    SELECT
                        u.nome,
                        u.email

                    FROM usuarios u

                    INNER JOIN pedidos p
                        ON p.usuario_id = u.id

                    WHERE p.id = ?
                    `,
                    [pedido.id]
                )


            emails.push({
                pedidoId: pedido.id,
                nome: usuarios[0]?.nome,
                email: usuarios[0]?.email
            })
        }


        await connection.commit()


        await Promise.all(
            emails.map(item =>
                Promise.all([

                    enviarEmail({
                        para: item.email,

                        assunto:
                            `Pedido #${item.pedidoId} cancelado`,

                        texto:
                            `Olá ${item.nome || "cliente"}, seu pedido #${item.pedidoId} foi cancelado porque o prazo para pagamento terminou.`
                    }),

                    enviarEmailAdministradores({
                        assunto:
                            `Pedido #${item.pedidoId} expirado`,

                        texto:
                            `O pedido #${item.pedidoId} foi cancelado automaticamente por falta de pagamento no prazo.`
                    })
                ])
            )
        )


    } catch (error) {

        await connection.rollback()

        console.error(
            "ERRO AO EXPIRAR PEDIDOS:",
            error
        )

    } finally {

        connection.release()
    }
}


// ======================================================
// CRIAR PEDIDO
// ======================================================

router.post(
    "/",
    autenticarToken,
    async (req, res) => {

        const { status } = await statusEfetivoLoja()
        if (status !== "online") {
            return res.status(503).json({
                erro: status === "maintenance"
                    ? "A loja está em manutenção"
                    : "A loja está fechada para novas operações",
                status
            })
        }

        const connection =
            await db.getConnection()


        try {

            await connection.beginTransaction()


            const usuarioId =
                req.usuario.id


            // ==================================================
            // DADOS
            // ==================================================

            const formaPagamentoInformada =
                req.body.formaPagamento ||
                req.body.pagamento ||
                req.body.metodoPagamento


            const entregaInformada =
                req.body.tipoEntrega ||
                req.body.formaEntrega ||
                req.body.entrega


            const pagamentoMapeado = {

                credit_card: "cartao",

                credito: "cartao",

                cartao_credito: "cartao"
            }


            const pagamentoNormalizado =
                String(
                    formaPagamentoInformada || ""
                )
                    .trim()
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    )


            const formaPagamento =
                pagamentoMapeado[
                    pagamentoNormalizado
                ] ||
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
                    String(
                        entregaInformada || ""
                    )
                        .trim()
                        .toLowerCase()
                        .normalize("NFD")
                        .replace(
                            /[\u0300-\u036f]/g,
                            ""
                        )
                ] ||
                entregaInformada


            const codigo =
                req.body.codigo ||
                req.body.codigoCupom ||
                req.body.couponCode ||
                req.body.cupom?.codigo ||
                req.body.coupon?.codigo


            const endereco =
                req.body.endereco ||
                req.body.enderecoEntrega


            const dadosCartao =
                req.body.dadosCartao ||
                req.body.cartao


            // ==================================================
            // VALIDAÇÕES
            // ==================================================

            if (!formaPagamento) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Selecione uma forma de pagamento"
                })
            }


            if (
                ![
                    "cartao",
                    "pix",
                    "boleto"
                ].includes(formaPagamento)
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Forma de pagamento inválida"
                })
            }


            if (!tipoEntrega) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Selecione uma forma de entrega"
                })
            }


            if (
                ![
                    "padrão",
                    "expressa",
                    "retirada"
                ].includes(tipoEntrega)
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Tipo de entrega inválido"
                })
            }


            // ==================================================
            // ENDEREÇO
            // ==================================================

            if (
                tipoEntrega !== "retirada"
            ) {

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
                        erro:
                            "Endereço de entrega incompleto"
                    })
                }
            }


            // ==================================================
            // CARTÃO
            // ==================================================

            if (
                formaPagamento === "cartao"
            ) {

                if (
                    !dadosCartao ||
                    !dadosCartao.numero ||
                    !dadosCartao.nomeTitular ||
                    !dadosCartao.bandeira
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Dados do cartão incompletos"
                    })
                }


                const numeroCartao =
                    String(
                        dadosCartao.numero
                    )
                        .replace(/\D/g, "")


                if (
                    numeroCartao.length < 4
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Número do cartão inválido"
                    })
                }
            }


            const cartaoFinal =
                formaPagamento === "cartao"
                    ? String(
                        dadosCartao.numero
                    )
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


            // ==================================================
            // CARRINHO
            // ==================================================

            const [carrinho] =
                await connection.query(
                    `
                    SELECT *

                    FROM carrinhos

                    WHERE usuario_id = ?

                    FOR UPDATE
                    `,
                    [usuarioId]
                )


            if (
                carrinho.length === 0
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Seu carrinho está vazio"
                })
            }


            const carrinhoId =
                carrinho[0].id


            // ==================================================
            // ITENS
            // ==================================================

            const [itensCarrinho] =
                await connection.query(
                    `
                    SELECT

                        ci.id
                            AS carrinho_item_id,

                        ci.produto_id,

                        ci.variacao_id,

                        ci.quantidade,

                        ci.configuracao,

                        ci.preco_personalizado,

                        p.nome,

                        p.preco
                            AS preco_produto,

                        p.estoque
                            AS estoque_produto,

                        p.ativo
                            AS produto_ativo,

                        pv.tipo
                            AS variacao_tipo,

                        pv.valor
                            AS variacao_valor,

                        pv.preco
                            AS preco_variacao,

                        pv.estoque
                            AS estoque_variacao

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


            if (
                itensCarrinho.length === 0
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Seu carrinho está vazio"
                })
            }


            // ==================================================
            // PRODUTOS
            // ==================================================

            for (
                const item of itensCarrinho
            ) {

                if (
                    !item.produto_ativo
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            `O produto ${item.nome} não está mais disponível`
                    })
                }
            }


            // ==================================================
            // VARIAÇÕES
            // ==================================================

            for (const item of itensCarrinho) {
                if (!item.configuracao) continue
                let configuracao
                try {
                    configuracao = typeof item.configuracao === "string"
                        ? JSON.parse(item.configuracao)
                        : item.configuracao
                    const calculo = await validarConfiguracao(item.produto_id, configuracao, connection)
                    item.preco_personalizado = calculo.precoFinal
                    item.configuracao_snapshot = {
                        produto: calculo.produto,
                        opcoes: calculo.configuracao,
                        precoBase: calculo.precoBase,
                        adicionais: calculo.adicionais,
                        precoFinal: calculo.precoFinal
                    }
                } catch (erro) {
                    await connection.rollback()
                    return res.status(erro.statusCode || 422).json({ erro: `Configuração inválida para ${item.nome}: ${erro.message}` })
                }
            }

            for (
                const item of itensCarrinho
            ) {

                if (
                    item.variacao_id
                ) {

                    if (
                        item.preco_variacao === null ||
                        item.preco_variacao === undefined
                    ) {

                        await connection.rollback()

                        return res.status(400).json({
                            erro:
                                `A variação selecionada para ${item.nome} não existe mais`
                        })
                    }


                    const [variacao] =
                        await connection.query(
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


                    if (
                        variacao.length === 0
                    ) {

                        await connection.rollback()

                        return res.status(400).json({
                            erro:
                                `A variação do produto ${item.nome} é inválida`
                        })
                    }
                }
            }


            // ==================================================
            // ESTOQUE
            // ==================================================

            for (
                const item of itensCarrinho
            ) {

                const quantidade =
                    Number(
                        item.quantidade
                    )


                if (
                    !Number.isInteger(
                        quantidade
                    ) ||
                    quantidade <= 0
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            `Quantidade inválida para ${item.nome}`
                    })
                }


                const estoqueDisponivel =
                    item.variacao_id
                        ? Number(
                            item.estoque_variacao
                        )
                        : Number(
                            item.estoque_produto
                        )


                if (
                    quantidade >
                    estoqueDisponivel
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            item.variacao_id
                                ? `A variação ${item.variacao_valor} de ${item.nome} não possui estoque suficiente`
                                : `Produto ${item.nome} não possui estoque suficiente`
                    })
                }
            }


            // ==================================================
            // SUBTOTAL
            // ==================================================

            const subtotal =
                itensCarrinho.reduce(
                    (
                        total,
                        item
                    ) => {

                        const preco =
                            obterPrecoItem(
                                item
                            )


                        return (
                            total +
                            preco *
                            Number(
                                item.quantidade
                            )
                        )

                    },
                    0
                )


            // ==================================================
            // CUPOM
            // ==================================================

            let cupomId = null

            let desconto = 0

            let cupomTipo = null


            if (codigo) {

                const codigoNormalizado =
                    String(codigo)
                        .trim()
                        .toUpperCase()


                const [cupons] =
                    await connection.query(
                        `
                        SELECT *

                        FROM cupons

                        WHERE codigo = ?

                        AND ativo = TRUE

                        AND (data_inicio IS NULL OR data_inicio <= NOW())

                        AND (data_fim IS NULL OR DATE(data_fim) >= CURRENT_DATE())

                        FOR UPDATE
                        `,
                        [codigoNormalizado]
                    )


                if (
                    cupons.length === 0
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Cupom inválido ou indisponível"
                    })
                }


                const cupom =
                    cupons[0]


                cupomId =
                    cupom.id


                cupomTipo =
                    cupom.tipo


                // ==================================================
                // LIMITE POR CLIENTE
                // ==================================================

                if (
                    cupom.limite_por_cliente !== null
                ) {

                    const [usosCliente] =
                        await connection.query(
                            `
                            SELECT
                                COUNT(*) AS total

                            FROM cupons_usos

                            WHERE cupom_id = ?

                            AND usuario_id = ?
                            `,
                            [
                                cupom.id,
                                usuarioId
                            ]
                        )


                    if (
                        Number(
                            usosCliente[0].total
                        ) >=
                        Number(
                            cupom.limite_por_cliente
                        )
                    ) {

                        await connection.rollback()

                        return res.status(400).json({
                            erro:
                                "Você atingiu o limite de uso deste cupom"
                        })
                    }
                }


                // ==================================================
                // RESTRIÇÕES
                // ==================================================

                const [restricoes] =
                    await connection.query(
                        `
                        SELECT

                            EXISTS(
                                SELECT 1
                                FROM cupons_produtos
                                WHERE cupom_id = ?
                            ) AS possui_produtos,

                            EXISTS(
                                SELECT 1
                                FROM cupons_colecoes
                                WHERE cupom_id = ?
                            ) AS possui_colecoes
                        `,
                        [
                            cupom.id,
                            cupom.id
                        ]
                    )


                if (
                    restricoes[0]
                        .possui_produtos ||
                    restricoes[0]
                        .possui_colecoes
                ) {

                    const [itensPermitidos] =
                        await connection.query(
                            `
                            SELECT
                                COUNT(
                                    DISTINCT ci.id
                                ) AS total

                            FROM carrinho_itens ci

                            LEFT JOIN cupons_produtos cp

                                ON cp.produto_id =
                                    ci.produto_id

                                AND cp.cupom_id = ?

                            LEFT JOIN cupons_colecoes cc

                                ON cc.cupom_id = ?

                            LEFT JOIN colecoes_produtos cop

                                ON cop.colecao_id =
                                    cc.colecao_id

                                AND cop.produto_id =
                                    ci.produto_id

                            WHERE ci.carrinho_id = ?

                            AND (
                                cp.produto_id
                                    IS NOT NULL

                                OR cop.produto_id
                                    IS NOT NULL
                            )
                            `,
                            [
                                cupom.id,
                                cupom.id,
                                carrinhoId
                            ]
                        )


                    if (
                        Number(
                            itensPermitidos[0]
                                .total
                        ) === 0
                    ) {

                        await connection.rollback()

                        return res.status(400).json({
                            erro:
                                "Este cupom não se aplica aos produtos do carrinho"
                        })
                    }
                }


                // ==================================================
                // DATA
                // ==================================================

                const agora =
                    new Date()


                if (
                    cupom.data_inicio &&
                    new Date(
                        cupom.data_inicio
                    ) > agora
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Este cupom ainda não está disponível"
                    })
                }


                if (
                    cupom.data_fim &&
                    new Date(
                        cupom.data_fim
                    ) < agora
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Cupom expirado"
                    })
                }


                // ==================================================
                // VALOR MÍNIMO
                // ==================================================

                if (
                    subtotal <
                    Number(
                        cupom.valor_minimo || 0
                    )
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            `Compra mínima de R$ ${Number(
                                cupom.valor_minimo
                            ).toFixed(2)}`
                    })
                }


                // ==================================================
                // LIMITE TOTAL
                // ==================================================

                if (
                    cupom.quantidade_uso !== null &&
                    Number(cupom.usado || 0) >=
                    Number(cupom.quantidade_uso)
                ) {

                    await connection.rollback()

                    return res.status(400).json({
                        erro:
                            "Este cupom atingiu o limite de utilização"
                    })
                }


                // ==================================================
                // DESCONTO
                // ==================================================

                if (
                    cupom.tipo === "percentual"
                ) {

                    desconto =
                        subtotal *
                        (
                            Number(
                                cupom.valor
                            ) / 100
                        )

                } else if (
                    cupom.tipo === "frete_gratis"
                ) {

                    desconto = 0

                } else {

                    desconto =
                        Number(
                            cupom.valor
                        )
                }


                if (
                    desconto > subtotal
                ) {

                    desconto =
                        subtotal
                }
            }


            // ==================================================
            // ENTREGA
            // ==================================================

            let frete = 0

            let prazoEntrega = ""


            switch (tipoEntrega) {

                case "padrão":

                    frete = 0

                    prazoEntrega =
                        "5 a 7 dias úteis"

                    break


                case "expressa":

                    frete = 25

                    prazoEntrega =
                        "3 a 5 dias úteis"

                    break


                case "retirada":

                    frete = 0

                    prazoEntrega =
                        "Disponível em 24h para retirada na loja"

                    break
            }


            if (
                cupomTipo ===
                "frete_gratis"
            ) {

                frete = 0
            }


            // ==================================================
            // TOTAL
            // ==================================================

            const total =
                Number(subtotal) -
                Number(desconto) +
                Number(frete)


            // ==================================================
            // EXPIRAÇÃO
            // ==================================================

            const dataExpiracaoPagamento =
                new Date(
                    Date.now() +
                    prazoPagamentoMinutos *
                    60 *
                    1000
                )


            // ==================================================
            // PEDIDO
            // ==================================================

            const [pedido] =
                await connection.query(
                    `
                    INSERT INTO pedidos
                    (
                        usuario_id,

                        subtotal,

                        desconto,

                        frete,

                        total,

                        forma_pagamento,

                        tipo_entrega,

                        prazo_entrega,

                        cupom_id,

                        data_expiracao_pagamento,

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

                    VALUES
                    (
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?
                    )
                    `,
                    [
                        usuarioId,

                        Number(
                            subtotal.toFixed(2)
                        ),

                        Number(
                            desconto.toFixed(2)
                        ),

                        Number(
                            frete.toFixed(2)
                        ),

                        Number(
                            total.toFixed(2)
                        ),

                        formaPagamento,

                        tipoEntrega,

                        prazoEntrega,

                        cupomId,

                        dataExpiracaoPagamento,

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


            const pedidoId =
                pedido.insertId


            // ==================================================
            // HISTÓRICO INICIAL
            // ==================================================

            await connection.query(
                `
                INSERT INTO historico_pedidos
                    (
                        pedido_id,
                        status
                    )

                VALUES (?, 'pendente')
                `,
                [pedidoId]
            )


            // ==================================================
            // PAGAMENTO
            // ==================================================

            let pagamento = null


            // ==================================================
            // PIX
            // ==================================================

            if (
                formaPagamento === "pix"
            ) {

                const emailPagador =
                    (
                        req.body.emailPagamento ||
                        req.usuario.email ||
                        "test_user@test.com"
                    ).trim()


                const mpResposta =
                    pagamentoMock

                        ? await gerarPagamentoMock({
                            tipo: "pix",
                            pedidoId,
                            valor: total
                        })

                        : await mpPayment.create({

                            body: {

                                transaction_amount:
                                    Number(
                                        Number(total)
                                            .toFixed(2)
                                    ),

                                description:
                                    `Pedido #${pedidoId} - Joalheria`,

                                payment_method_id:
                                    "pix",

                                payer: {
                                    email:
                                        emailPagador
                                }
                            },

                            requestOptions: {

                                idempotencyKey:
                                    `pedido-${pedidoId}-pix`
                            }
                        })


                const dadosPix =
                    mpResposta
                        .point_of_interaction
                        ?.transaction_data ||
                    {}


                const txid =
                    String(
                        mpResposta.id
                    )


                const codigoPix =
                    dadosPix.qr_code ||
                    null


                const qrBase64 =
                    dadosPix.qr_code_base64 ||
                    null


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

                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                        [
                            pedidoId,

                            "pix",

                            "pendente",

                            mpResposta.status,

                            Number(total),

                            txid,

                            codigoPix,

                            qrBase64
                        ]
                    )


                pagamento = {

                    id:
                        pagamentoCriado.insertId,

                    tipo:
                        "pix",

                    status:
                        "pendente",

                    valor:
                        Number(total),

                    transacaoId:
                        txid,

                    codigoPix,

                    qrCodeBase64:
                        qrBase64,

                    expiracaoMinutos:
                        prazoPagamentoMinutos,

                    ambiente:
                        pagamentoMock
                            ? "static_pix"
                            : "mercadopago"
                }
            }


            // ==================================================
            // CARTÃO
            // ==================================================

            else if (
                formaPagamento === "cartao"
            ) {

                const {
                    cardToken,
                    paymentMethodId,
                    installments,
                    issuerId,
                    emailPagamento,
                    cpf
                } =
                    req.body.dadosCartao || {}


                if (
                    !pagamentoMock &&
                    (
                        !cardToken ||
                        !paymentMethodId
                    )
                ) {

                    throw new Error(
                        "Dados do cartão inválidos (token ausente)"
                    )
                }


                const mpResposta =
                    pagamentoMock

                        ? await gerarPagamentoMock({
                            tipo: "cartao",
                            pedidoId,
                            valor: total,
                            status:
                                dadosCartao.mockStatus ||
                                "pending"
                        })

                        : await mpPayment.create({

                            body: {

                                transaction_amount:
                                    Number(
                                        Number(total)
                                            .toFixed(2)
                                    ),

                                token:
                                    cardToken,

                                description:
                                    `Pedido #${pedidoId} - Joalheria`,

                                installments:
                                    Number(
                                        installments
                                    ) || 1,

                                payment_method_id:
                                    paymentMethodId,

                                issuer_id:
                                    issuerId
                                        ? Number(
                                            issuerId
                                        )
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
                                                number:
                                                    String(cpf)
                                            }
                                            : undefined
                                }
                            },

                            requestOptions: {

                                idempotencyKey:
                                    `pedido-${pedidoId}-card`
                            }
                        })


                const mapa =
                    mapearStatusMP(
                        mpResposta.status
                    )


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

                        VALUES
                        (?, ?, ?, ?, ?, ?)
                        `,
                        [
                            pedidoId,

                            "cartao",

                            mapa.pagamento,

                            mpResposta.status,

                            Number(total),

                            String(
                                mpResposta.id
                            )
                        ]
                    )


                pagamento = {

                    id:
                        pagamentoCriado.insertId,

                    tipo:
                        "cartao",

                    status:
                        mapa.pagamento,

                    valor:
                        Number(total),

                    transacaoId:
                        String(
                            mpResposta.id
                        )
                }


                // ==================================================
                // CARTÃO APROVADO IMEDIATAMENTE
                // ==================================================

                if (
                    mapa.pedido === "pago"
                ) {

                    await confirmarPagamentoPedido(
                        connection,
                        {
                            pedidoId,

                            pagamentoId:
                                pagamento.id,

                            statusGateway:
                                mpResposta.status
                        }
                    )

                    pagamento.status =
                        "aprovado"
                }


                // ==================================================
                // CARTÃO RECUSADO
                // ==================================================

                else if (
                    mapa.pagamento ===
                    "recusado"
                ) {

                    throw new Error(
                        "Pagamento recusado pela operadora do cartão"
                    )
                }
            }


            // ==================================================
            // BOLETO
            // ==================================================

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

                        VALUES
                        (?, ?, ?, ?)
                        `,
                        [
                            pedidoId,

                            "boleto",

                            "pendente",

                            Number(total)
                        ]
                    )


                pagamento = {

                    id:
                        pagamentoCriado.insertId,

                    tipo:
                        "boleto",

                    status:
                        "pendente",

                    valor:
                        Number(total)
                }
            }


            // ==================================================
            // ITENS DO PEDIDO
            // ==================================================

            for (
                const item of itensCarrinho
            ) {

                const preco =
                    obterPrecoItem(
                        item
                    )


                const subtotalItem =
                    preco *
                    Number(
                        item.quantidade
                    )


                await connection.query(
                    `
                    INSERT INTO pedidos_itens
                    (
                        pedido_id,

                        produto_id,

                        variacao_id,

                        quantidade,

                        preco_unitario,

                        subtotal,

                        configuracao_snapshot
                    )

                    VALUES
                    (?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        pedidoId,

                        item.produto_id,

                        item.variacao_id ||
                            null,

                        item.quantidade,

                        preco,

                        subtotalItem,

                        item.configuracao_snapshot
                            ? JSON.stringify(item.configuracao_snapshot)
                            : null
                    ]
                )
            }


            // ==================================================
            // ESTOQUE
            // ==================================================

            for (
                const item of itensCarrinho
            ) {

                if (
                    item.variacao_id
                ) {

                    const [
                        resultadoEstoque
                    ] =
                        await connection.query(
                            `
                            UPDATE produto_variacoes

                            SET estoque =
                                estoque - ?

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
                        resultadoEstoque
                            .affectedRows === 0
                    ) {

                        throw new Error(
                            `Estoque insuficiente para a variação de ${item.nome}`
                        )
                    }

                } else {

                    const [
                        resultadoEstoque
                    ] =
                        await connection.query(
                            `
                            UPDATE produtos

                            SET estoque =
                                estoque - ?

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
                        resultadoEstoque
                            .affectedRows === 0
                    ) {

                        throw new Error(
                            `Estoque insuficiente para o produto ${item.nome}`
                        )
                    }
                }
            }


            // ==================================================
            // LIMPAR CARRINHO
            // ==================================================

            await connection.query(
                `
                DELETE FROM carrinho_itens

                WHERE carrinho_id = ?
                `,
                [carrinhoId]
            )


            // ==================================================
            // NOTIFICAÇÃO ADMIN
            // ==================================================

            await notificarAdministradores(
                connection,

                pedidoId,

                `Nova compra criada: pedido #${pedidoId}, valor R$ ${Number(total).toFixed(2)}`
            )


            // ==================================================
            // COMMIT
            // ==================================================

            await connection.commit()


            // ==================================================
            // DADOS DO USUÁRIO
            // ==================================================

            const [usuarios] =
                await db.query(
                    `
                    SELECT
                        nome,
                        email

                    FROM usuarios

                    WHERE id = ?
                    `,
                    [usuarioId]
                )


            // ==================================================
            // E-MAIL CLIENTE
            // ==================================================

            await enviarEmail({

                para:
                    usuarios[0]?.email,

                assunto:
                    `Pedido #${pedidoId} aguardando pagamento`,

                texto:
                    `Olá ${usuarios[0]?.nome || "cliente"}, seu pedido #${pedidoId} foi criado e aguarda pagamento até ${dataExpiracaoPagamento.toLocaleString("pt-BR")}.`
            })


            // ==================================================
            // E-MAIL ADMIN
            // ==================================================

            await enviarEmailAdministradores({

                assunto:
                    `Novo pedido #${pedidoId}`,

                texto:
                    `Um novo pedido foi criado pelo cliente. Pedido #${pedidoId}, valor R$ ${Number(total).toFixed(2)}. Aguardando pagamento.`
            })


            // ==================================================
            // RESPOSTA
            // ==================================================

            return res.status(201).json({

                sucesso:
                    true,

                mensagem:
                    formaPagamento === "pix"
                        ? "Pedido criado. Aguardando pagamento PIX."
                        : "Pedido realizado com sucesso!",

                pedidoId,

                total:
                    Number(total),

                status:
                    pagamento?.status === "aprovado"
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
    }
)


// ======================================================
// CANCELAR PEDIDO
// ======================================================

router.patch(
    "/:id/cancelar",
    autenticarToken,
    async (req, res) => {

        const connection =
            await db.getConnection()


        try {

            await connection.beginTransaction()


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
                        req.params.id,
                        req.usuario.id
                    ]
                )


            if (
                !pedidos.length
            ) {

                await connection.rollback()

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }


            const pedido =
                pedidos[0]


            if (
                pedido.status_pedido !==
                "pendente"
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Este pedido não pode ser cancelado"
                })
            }


            const [itens] =
                await connection.query(
                    `
                    SELECT
                        produto_id,
                        variacao_id,
                        quantidade

                    FROM pedidos_itens

                    WHERE pedido_id = ?
                    `,
                    [pedido.id]
                )


            for (
                const item of itens
            ) {

                if (
                    item.variacao_id
                ) {

                    await connection.query(
                        `
                        UPDATE produto_variacoes

                        SET estoque =
                            estoque + ?

                        WHERE id = ?
                        `,
                        [
                            item.quantidade,
                            item.variacao_id
                        ]
                    )

                } else {

                    await connection.query(
                        `
                        UPDATE produtos

                        SET estoque =
                            estoque + ?

                        WHERE id = ?
                        `,
                        [
                            item.quantidade,
                            item.produto_id
                        ]
                    )
                }
            }


            await connection.query(
                `
                UPDATE pedidos

                SET status_pedido =
                    'cancelado'

                WHERE id = ?
                `,
                [pedido.id]
            )


            await connection.query(
                `
                UPDATE pagamentos

                SET status = 'cancelado'

                WHERE pedido_id = ?

                AND status = 'pendente'
                `,
                [pedido.id]
            )


            await connection.query(
                `
                INSERT INTO historico_pedidos
                (
                    pedido_id,
                    status
                )

                VALUES (?, 'cancelado')
                `,
                [pedido.id]
            )


            await notificarAdministradores(
                connection,

                pedido.id,

                `Cliente cancelou o pedido #${pedido.id}`
            )


            await connection.commit()


            const [usuarios] =
                await db.query(
                    `
                    SELECT
                        nome,
                        email

                    FROM usuarios

                    WHERE id = ?
                    `,
                    [req.usuario.id]
                )


            await enviarEmail({

                para:
                    usuarios[0]?.email,

                assunto:
                    `Pedido #${pedido.id} cancelado`,

                texto:
                    `Olá ${usuarios[0]?.nome || "cliente"}, seu pedido #${pedido.id} foi cancelado.`
            })


            await enviarEmailAdministradores({

                assunto:
                    `Pedido #${pedido.id} cancelado`,

                texto:
                    `O cliente cancelou o pedido #${pedido.id}.`
            })


            return res.json({

                sucesso:
                    true,

                status:
                    "cancelado"
            })


        } catch (error) {

            await connection.rollback()

            console.error(
                "ERRO AO CANCELAR PEDIDO:",
                error
            )


            return res.status(500).json({
                erro:
                    "Erro ao cancelar pedido"
            })

        } finally {

            connection.release()
        }
    }
)


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
            // PEDIDO
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


            if (
                pedidos.length === 0
            ) {

                await connection.rollback()

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }


            const pedido =
                pedidos[0]


            // ==================================================
            // FORMA
            // ==================================================

            if (
                pedido.forma_pagamento !==
                "pix"
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Este pedido não utiliza PIX"
                })
            }


            // ==================================================
            // STATUS
            // ==================================================

            if (
                pedido.status_pedido ===
                "pago"
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Este pedido já está pago"
                })
            }


            if (
                pedido.status_pedido ===
                "cancelado"
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Este pedido foi cancelado"
                })
            }


            // ==================================================
            // EXPIRAÇÃO
            // ==================================================

            if (
                pedido.data_expiracao_pagamento &&
                new Date(
                    pedido.data_expiracao_pagamento
                ) <= new Date()
            ) {

                await connection.rollback()

                await cancelarPedidosExpirados()

                return res.status(400).json({
                    erro:
                        "O prazo para pagamento deste pedido terminou"
                })
            }


            // ==================================================
            // PAGAMENTO
            // ==================================================

            const [pagamentos] =
                await connection.query(
                    `
                    SELECT *

                    FROM pagamentos

                    WHERE pedido_id = ?

                    AND tipo = 'pix'

                    AND status = 'pendente'

                    ORDER BY id DESC

                    LIMIT 1

                    FOR UPDATE
                    `,
                    [pedidoId]
                )


            if (
                pagamentos.length === 0
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Pagamento PIX não encontrado ou já processado"
                })
            }


            const pagamento =
                pagamentos[0]


            // ==================================================
            // CONFIRMAR
            // ==================================================

            await confirmarPagamentoPedido(
                connection,
                {
                    pedidoId,

                    pagamentoId:
                        pagamento.id,

                    statusGateway:
                        "approved"
                }
            )


            await connection.commit()


            return res.json({

                sucesso:
                    true,

                mensagem:
                    "Pagamento PIX aprovado",

                pedidoId:
                    Number(pedidoId),

                status:
                    "pago",

                valor:
                    Number(pedido.total)
            })


        } catch (error) {

            await connection.rollback()

            console.error(
                "ERRO AO SIMULAR PIX:",
                error
            )


            return res.status(500).json({
                erro:
                    error.message ||
                    "Erro ao validar pagamento PIX"
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


            if (
                pedidos.length === 0
            ) {

                return res.json([])
            }


            const pedidoIds =
                pedidos.map(
                    pedido => pedido.id
                )


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

                        pi.configuracao_snapshot,

                        p.nome,

                        p.imagem,

                        pv.tipo
                            AS variacao_tipo,

                        pv.valor
                            AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos p
                        ON p.id =
                            pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id =
                            pi.variacao_id

                    WHERE pi.pedido_id IN (?)
                    `,
                    [pedidoIds]
                )


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

                        pix_qr_base64
                            AS pix_qr_code,

                        criado_em,

                        atualizado_em

                    FROM pagamentos

                    WHERE pedido_id IN (?)
                    `,
                    [pedidoIds]
                )


            const pedidosCompletos =
                pedidos.map(
                    pedido => ({

                        ...pedido,

                        itens:
                            itens.filter(
                                item =>
                                    Number(
                                        item.pedido_id
                                    ) ===
                                    Number(
                                        pedido.id
                                    )
                            ),

                        timeline:
                            historico.filter(
                                evento =>
                                    Number(
                                        evento.pedido_id
                                    ) ===
                                    Number(
                                        pedido.id
                                    )
                            ),

                        pagamento:
                            pagamentos.find(
                                pagamento =>
                                    Number(
                                        pagamento.pedido_id
                                    ) ===
                                    Number(
                                        pedido.id
                                    )
                            ) || null
                    })
                )


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

                        u.nome
                            AS cliente_nome,

                        u.email
                            AS cliente_email,

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


            return res.json(
                pedidos
            )


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
// ADMIN — DETALHE
// ======================================================

router.get(
    "/pedidos-admin/:id",
    autenticarToken,
    apenasAdmin,
    async (req, res) => {

        try {

            const pedidoId =
                req.params.id


            const [pedido] =
                await db.query(
                    `
                    SELECT

                        p.*,

                        u.nome
                            AS cliente_nome,

                        u.email
                            AS cliente_email

                    FROM pedidos p

                    INNER JOIN usuarios u
                        ON u.id =
                            p.usuario_id

                    WHERE p.id = ?
                    `,
                    [pedidoId]
                )


            if (
                pedido.length === 0
            ) {

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }


            const [itens] =
                await db.query(
                    `
                    SELECT

                        pi.*,

                        pr.nome,

                        pr.imagem,

                        pv.tipo
                            AS variacao_tipo,

                        pv.valor
                            AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos pr
                        ON pr.id =
                            pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id =
                            pi.variacao_id

                    WHERE pi.pedido_id = ?
                    `,
                    [pedidoId]
                )


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


            const {
                cartao_bandeira,
                cartao_final,
                cartao_nome_titular,
                ...pedidoSemCartao
            } =
                pedido[0]


            return res.json({

                pedido: {

                    ...pedidoSemCartao,

                    cartao:
                        cartao_bandeira
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


            if (
                !statusValido.includes(
                    status
                )
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "Status inválido"
                })
            }


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


            if (
                pedidos.length === 0
            ) {

                await connection.rollback()

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }


            const pedido =
                pedidos[0]


            if (
                pedido.status_pedido ===
                status
            ) {

                await connection.rollback()

                return res.status(400).json({
                    erro:
                        "O pedido já está com este status"
                })
            }


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

                sucesso:
                    true,

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


            if (
                pedido.length === 0
            ) {

                return res.status(404).json({
                    erro:
                        "Pedido não encontrado"
                })
            }


            const [itens] =
                await db.query(
                    `
                    SELECT

                        pi.*,

                        p.nome,

                        p.imagem,

                        pv.tipo
                            AS variacao_tipo,

                        pv.valor
                            AS variacao_valor

                    FROM pedidos_itens pi

                    INNER JOIN produtos p
                        ON p.id =
                            pi.produto_id

                    LEFT JOIN produto_variacoes pv
                        ON pv.id =
                            pi.variacao_id

                    WHERE pi.pedido_id = ?
                    `,
                    [pedidoId]
                )


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

                        pix_qr_base64
                            AS pix_qr_code,

                        criado_em,

                        atualizado_em

                    FROM pagamentos

                    WHERE pedido_id = ?
                    `,
                    [pedidoId]
                )


            return res.json({

                pedido:
                    pedido[0],

                itens,

                timeline,

                pagamento:
                    pagamentos[0] ||
                    null
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
// STATUS DO PAGAMENTO
// POLLING DO FRONTEND
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


            const [pags] =
                await connection.query(
                    `
                    SELECT

                        p.*

                    FROM pagamentos p

                    INNER JOIN pedidos pe
                        ON pe.id =
                            p.pedido_id

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


            if (
                pags.length === 0
            ) {

                return res.status(404).json({
                    erro:
                        "Pagamento não encontrado"
                })
            }


            const pagamento =
                pags[0]


            // ==================================================
            // MOCK
            // ==================================================

            if (
                pagamentoMock
            ) {

                return res.json({

                    pedidoId:
                        Number(pedidoId),

                    status:
                        pagamento.status
                })
            }


            // ==================================================
            // MERCADO PAGO
            // ==================================================

            if (
                pagamento.transacao_id
            ) {

                const mp =
                    await mpPayment.get({
                        id:
                            pagamento.transacao_id
                    })


                const mapa =
                    mapearStatusMP(
                        mp.status
                    )


                // ==================================================
                // STATUS ALTERADO
                // ==================================================

                if (
                    mapa.pagamento !==
                    pagamento.status
                ) {

                    await connection.beginTransaction()


                    try {

                        const [pedidoRows] =
                            await connection.query(
                                `
                                SELECT *

                                FROM pedidos

                                WHERE id = ?

                                FOR UPDATE
                                `,
                                [pedidoId]
                            )


                        if (
                            !pedidoRows.length
                        ) {

                            throw new Error(
                                "Pedido não encontrado"
                            )
                        }


                        const pedido =
                            pedidoRows[0]


                        // ==================================================
                        // EXPIRADO
                        // ==================================================

                        if (
                            pedido.status_pedido ===
                                "pendente" &&

                            pedido.data_expiracao_pagamento &&

                            new Date(
                                pedido.data_expiracao_pagamento
                            ) <= new Date()
                        ) {

                            await connection.rollback()

                            await cancelarPedidosExpirados()

                            return res.json({

                                pedidoId:
                                    Number(
                                        pedidoId
                                    ),

                                status:
                                    "cancelado"
                            })
                        }


                        // ==================================================
                        // APROVADO
                        // ==================================================

                        if (
                            mapa.pedido ===
                            "pago"
                        ) {

                            await confirmarPagamentoPedido(
                                connection,
                                {
                                    pedidoId,

                                    pagamentoId:
                                        pagamento.id,

                                    statusGateway:
                                        mp.status
                                }
                            )

                        } else {

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
                        }


                        await connection.commit()


                        pagamento.status =
                            mapa.pagamento


                    } catch (error) {

                        await connection.rollback()

                        throw error
                    }
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
// ======================================================

export async function processarWebhookMercadoPago(
    req,
    res
) {

    try {

        // ==================================================
        // HEADERS
        // ==================================================

        const xSignature =
            req.headers[
                "x-signature"
            ]


        const xRequestId =
            req.headers[
                "x-request-id"
            ]


        // ==================================================
        // ID
        // ==================================================

        const dataId =
            req.query["data.id"] ||
            req.body?.data?.id


        // ==================================================
        // ASSINATURA
        // ==================================================

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
        // TIPO
        // ==================================================

        const tipo =
            req.query.type ||
            req.body?.type


        if (
            tipo !== "payment" ||
            !dataId
        ) {

            return res
                .status(200)
                .send("ignorado")
        }


        // ==================================================
        // CONSULTAR MP
        // ==================================================

        const mp =
            pagamentoMock

                ? {
                    status:
                        "approved"
                }

                : await mpPayment.get({
                    id:
                        dataId
                })


        const mapa =
            mapearStatusMP(
                mp.status
            )


        // ==================================================
        // BANCO
        // ==================================================

        const connection =
            await db.getConnection()


        let pagamentoConfirmado =
            null


        try {

            await connection.beginTransaction()


            const [pags] =
                await connection.query(
                    `
                    SELECT *

                    FROM pagamentos

                    WHERE transacao_id = ?

                    LIMIT 1

                    FOR UPDATE
                    `,
                    [
                        String(dataId)
                    ]
                )


            // ==================================================
            // PAGAMENTO NÃO ENCONTRADO
            // ==================================================

            if (
                pags.length === 0
            ) {

                await connection.commit()

                return res
                    .status(200)
                    .send("ok")
            }


            const pg =
                pags[0]


            // ==================================================
            // PEDIDO
            // ==================================================

            const [pedidos] =
                await connection.query(
                    `
                    SELECT *

                    FROM pedidos

                    WHERE id = ?

                    FOR UPDATE
                    `,
                    [pg.pedido_id]
                )


            if (
                !pedidos.length
            ) {

                await connection.commit()

                return res
                    .status(200)
                    .send("ok")
            }


            const pedido =
                pedidos[0]


            // ==================================================
            // EXPIRADO
            // ==================================================

            if (
                pedido.status_pedido ===
                    "pendente" &&

                pedido.data_expiracao_pagamento &&

                new Date(
                    pedido.data_expiracao_pagamento
                ) <= new Date()
            ) {

                await connection.rollback()

                await cancelarPedidosExpirados()

                return res
                    .status(200)
                    .send(
                        "pedido expirado"
                    )
            }


            // ==================================================
            // APROVADO
            // ==================================================

            if (
                mapa.pedido ===
                "pago"
            ) {

                if (
                    pg.status !==
                    "aprovado"
                ) {

                    await confirmarPagamentoPedido(
                        connection,
                        {
                            pedidoId:
                                pg.pedido_id,

                            pagamentoId:
                                pg.id,

                            statusGateway:
                                mp.status
                        }
                    )

                    pagamentoConfirmado =
                        pg.pedido_id
                }

            } else {

                // ==================================================
                // OUTROS STATUS
                // ==================================================

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
            }


            await connection.commit()


        } catch (error) {

            await connection.rollback()

            throw error

        } finally {

            connection.release()
        }


        // ==================================================
        // E-MAIL PAGAMENTO CONFIRMADO
        // ==================================================

        if (
            pagamentoConfirmado
        ) {

            const [usuarios] =
                await db.query(
                    `
                    SELECT

                        u.nome,

                        u.email

                    FROM usuarios u

                    INNER JOIN pedidos p
                        ON p.usuario_id =
                            u.id

                    WHERE p.id = ?
                    `,
                    [
                        pagamentoConfirmado
                    ]
                )


            await enviarEmail({

                para:
                    usuarios[0]?.email,

                assunto:
                    `Pagamento confirmado do pedido #${pagamentoConfirmado}`,

                texto:
                    `Olá ${usuarios[0]?.nome || "cliente"}, seu pagamento do pedido #${pagamentoConfirmado} foi confirmado.`
            })
        }


        return res
            .status(200)
            .send("ok")


    } catch (error) {

        console.error(
            "ERRO WEBHOOK MP:",
            error
        )


        /*
         * O Mercado Pago espera 200
         * para evitar reenvios infinitos.
         */

        return res
            .status(200)
            .send("ok")
    }
}


// ======================================================
// ROTAS WEBHOOK
// ======================================================

router.post(
    "/webhook/mercadopago",
    processarWebhookMercadoPago
)


router.post(
    "/pagamentos/webhook",
    processarWebhookMercadoPago
)


// ======================================================
// EXPORT
// ======================================================

export default router