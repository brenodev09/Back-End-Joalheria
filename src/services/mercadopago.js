/* =========================================================================
   ARQUIVO: src/services/mercadopago.js
   ========================================================================= */

import crypto from "crypto"
import QRCode from "qrcode"

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

function campoPix(id, valor) {
    const conteudo = String(valor)
    return `${id}${String(conteudo.length).padStart(2, "0")}${conteudo}`
}

function crc16(payload) {
    let crc = 0xffff

    for (const caractere of payload) {
        crc ^= caractere.charCodeAt(0) << 8
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1
            crc &= 0xffff
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0")
}

function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^([0-9])\1{10}$/.test(cpf)) return false

    let soma = 0
    for (let indice = 0; indice < 9; indice += 1) soma += Number(cpf[indice]) * (10 - indice)
    let resto = (soma * 10) % 11
    if (resto === 10) resto = 0
    if (resto !== Number(cpf[9])) return false

    soma = 0
    for (let indice = 0; indice < 10; indice += 1) soma += Number(cpf[indice]) * (11 - indice)
    resto = (soma * 10) % 11
    if (resto === 10) resto = 0
    return resto === Number(cpf[10])
}

export async function gerarPixEstatico({ pedidoId, valor }) {
    const chave = String(process.env.PIX_KEY || "").trim()
    if (!chave) {
        throw new Error("PIX_KEY não configurada. Informe a chave PIX que receberá o pagamento.")
    }
    if (/^\d{11}$/.test(chave) && !cpfValido(chave)) {
        throw new Error("PIX_KEY contém um CPF inválido. Use uma chave PIX real cadastrada no banco.")
    }

    const nome = String(process.env.PIX_MERCHANT_NAME || "JOALHERIA").trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().slice(0, 25)
    const cidade = String(process.env.PIX_MERCHANT_CITY || "SAO PAULO").trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().slice(0, 15)
    const valorFormatado = Number(valor).toFixed(2)
    const txid = `PEDIDO${pedidoId}`.replace(/[^A-Z0-9]/gi, "").slice(0, 25) || "***"

    const payloadSemCrc = [
        campoPix("00", "01"),
        campoPix("26", campoPix("00", "BR.GOV.BCB.PIX") + campoPix("01", chave)),
        campoPix("52", "0000"),
        campoPix("53", "986"),
        campoPix("54", valorFormatado),
        campoPix("58", "BR"),
        campoPix("59", nome),
        campoPix("60", cidade),
        campoPix("62", campoPix("05", txid)),
        "6304"
    ].join("")
    const payload = `${payloadSemCrc}${crc16(payloadSemCrc)}`
    const dataUrl = await QRCode.toDataURL(payload, { width: 360, margin: 2 })

    return {
        id: `PIX-ESTATICO-${pedidoId}`,
        status: "pending",
        transaction_amount: Number(valor),
        point_of_interaction: {
            transaction_data: {
                qr_code: payload,
                qr_code_base64: dataUrl.replace(/^data:image\/png;base64,/, ""),
                ticket_url: null
            }
        }
    }
}


// ======================================================
// MOCK
// ======================================================

export const pagamentoMock =
    String(process.env.PAYMENT_MOCK ?? "").toLowerCase() === "true" ||
    !process.env.MP_ACCESS_TOKEN ||
    String(process.env.MP_ACCESS_TOKEN).trim() === ""


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