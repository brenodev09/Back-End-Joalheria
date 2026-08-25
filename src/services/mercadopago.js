/* =========================================================================
   ARQUIVO: src/services/mercadopago.js
   ========================================================================= */

import crypto from "crypto"

import {
    MercadoPagoConfig,
    Payment
} from "mercadopago"


// ======================================================
// CONFIGURAÇÃO MERCADO PAGO
// ======================================================

const accessToken = process.env.MP_ACCESS_TOKEN

if (!accessToken) {
    console.warn(
        "⚠️ MP_ACCESS_TOKEN não configurado."
    )
}

const client = new MercadoPagoConfig({
    accessToken
})

export const mpPayment = new Payment(client)


// ======================================================
// MOCK
// ======================================================

export const pagamentoMock =
    String(
        process.env.PAYMENT_MOCK
    ).toLowerCase() === "true"


// ======================================================
// GERAR PAGAMENTO MOCK
// ======================================================

export async function gerarPagamentoMock({
    tipo,
    pedidoId,
    valor,
    status = "pending"
}) {

    const id =
        `MOCK-${Date.now()}-${pedidoId}`

    if (tipo === "pix") {

        return {
            id,

            status: "pending",

            transaction_amount: Number(valor),

            point_of_interaction: {

                transaction_data: {

                    qr_code:
                        "PIX-MOCK-NAO-UTILIZAR",

                    qr_code_base64:
                        null,

                    ticket_url:
                        null
                }
            }
        }
    }

    return {

        id,

        status,

        transaction_amount:
            Number(valor)
    }
}


// ======================================================
// MAPEAR STATUS MERCADO PAGO
// ======================================================

export function mapearStatusMP(status) {

    switch (status) {

        case "approved":

            return {
                pagamento: "aprovado",
                pedido: "pago"
            }


        case "pending":

        case "in_process":

            return {
                pagamento: "pendente",
                pedido: "pendente"
            }


        case "rejected":

            return {
                pagamento: "recusado",
                pedido: "pendente"
            }


        case "cancelled":

        case "canceled":

            return {
                pagamento: "cancelado",
                pedido: "cancelado"
            }


        case "refunded":

        case "charged_back":

            return {
                pagamento: "estornado",
                pedido: "pendente"
            }


        default:

            return {
                pagamento: "pendente",
                pedido: "pendente"
            }
    }
}


// ======================================================
// VALIDAR ASSINATURA WEBHOOK
// ======================================================

export function validarAssinaturaWebhook({
    xSignature,
    xRequestId,
    dataId
}) {

    const secret =
        process.env.MP_WEBHOOK_SECRET


    if (!secret) {

        console.warn(
            "⚠️ MP_WEBHOOK_SECRET não configurado."
        )

        return true
    }


    if (
        !xSignature ||
        !xRequestId ||
        !dataId
    ) {

        return false
    }


    const parts =
        String(xSignature).split(",")


    let ts = null
    let v1 = null


    for (const part of parts) {

        const [key, ...rest] =
            part.trim().split("=")

        const value =
            rest.join("=")


        if (key === "ts") {
            ts = value
        }


        if (key === "v1") {
            v1 = value
        }
    }


    if (!ts || !v1) {

        return false
    }


    const manifest =
        `id:${dataId};request-id:${xRequestId};ts:${ts};`


    const expected =
        crypto
            .createHmac(
                "sha256",
                secret
            )
            .update(manifest)
            .digest("hex")


    try {

        const expectedBuffer =
            Buffer.from(
                expected,
                "utf8"
            )

        const receivedBuffer =
            Buffer.from(
                v1,
                "utf8"
            )


        if (
            expectedBuffer.length !==
            receivedBuffer.length
        ) {

            return false
        }


        return crypto.timingSafeEqual(
            expectedBuffer,
            receivedBuffer
        )

    } catch {

        return false
    }
}