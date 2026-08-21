/* =========================================================================
   ARQUIVO: src/services/mercadopago.js
   ========================================================================= */

import dotenv from "dotenv"
import crypto from "crypto"
import QRCode from "qrcode"

dotenv.config()

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const ambientePagamento =
    String(process.env.PAYMENT_PROVIDER || "mock")
        .trim()
        .toLowerCase()

export const pagamentoMock =
    ["mock", "static_pix"].includes(ambientePagamento)

export const pixEstatico =
    ambientePagamento === "static_pix"

// ======================================================
// MERCADO PAGO
// ======================================================
//
// O SDK só é carregado quando realmente estamos usando
// o Mercado Pago.
//
// Isso permite que o projeto rode normalmente em MOCK
// mesmo sem Access Token.
// ======================================================

let mpPayment = null

if (!pagamentoMock) {

    const { MercadoPagoConfig, Payment } =
        await import("mercadopago")

    const accessToken =
        process.env.MP_ACCESS_TOKEN?.trim()

    if (!accessToken) {
        throw new Error(
            "MP_ACCESS_TOKEN não foi encontrado no arquivo .env"
        )
    }

    mpPayment =
        new Payment(
            new MercadoPagoConfig({
                accessToken
            })
        )
}

export { mpPayment }

// ======================================================
// GERAR ID MOCK
// ======================================================

export function gerarTransacaoMock(prefixo = "MOCK") {

    return `${prefixo}-${Date.now()}-${crypto
        .randomBytes(4)
        .toString("hex")}`
}

// ======================================================
// GERAR PIX ESTATICO
// ======================================================

function campoPix(id, valor) {

    const texto = String(valor)

    return `${id}${String(texto.length).padStart(2, "0")}${texto}`
}

function calcularCrc16(payload) {

    let crc = 0xFFFF

    for (const caractere of payload) {
        crc ^= caractere.charCodeAt(0) << 8

        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000)
                ? (crc << 1) ^ 0x1021
                : crc << 1

            crc &= 0xFFFF
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, "0")
}

function normalizarTextoPix(valor, limite) {

    return String(valor)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9 .\-]/g, "")
        .trim()
        .toUpperCase()
        .slice(0, limite)
}

function gerarPayloadPixEstatico({ chave, valor, pedidoId }) {

    const nome = normalizarTextoPix(
        process.env.PIX_STATIC_NAME || "JOALHERIA",
        25
    )

    const cidade = normalizarTextoPix(
        process.env.PIX_STATIC_CITY || "SAO PAULO",
        15
    )

    const valorFormatado = Number(valor).toFixed(2)
    const txid = `PED${pedidoId}`.slice(0, 25)

    const merchantAccount =
        campoPix("00", "BR.GOV.BCB.PIX") +
        campoPix("01", chave)

    const semCrc =
        campoPix("00", "01") +
        campoPix("01", "12") +
        campoPix("26", merchantAccount) +
        campoPix("52", "0000") +
        campoPix("53", "986") +
        campoPix("54", valorFormatado) +
        campoPix("58", "BR") +
        campoPix("59", nome) +
        campoPix("60", cidade) +
        campoPix("62", campoPix("05", txid)) +
        "6304"

    return `${semCrc}${calcularCrc16(semCrc)}`
}

export async function gerarPixMock({
    pedidoId,
    valor
}) {

    const transacaoId =
        gerarTransacaoMock("PIX")

    const chavePix =
        String(process.env.PIX_STATIC_KEY || "").trim()

    if (!chavePix) {
        throw new Error(
            "PIX_STATIC_KEY não foi configurada no arquivo .env"
        )
    }

    const codigoPix = gerarPayloadPixEstatico({
        chave: chavePix,
        valor,
        pedidoId
    })

    const qrCodeBase64 =
        await QRCode.toDataURL(codigoPix)

    return {

        id: transacaoId,

        status: "pending",

        status_detail: "pending",

        transaction_amount:
            Number(valor),

        point_of_interaction: {

            transaction_data: {

                qr_code:
                    codigoPix,

                qr_code_base64:
                    qrCodeBase64.replace(
                        /^data:image\/png;base64,/,
                        ""
                    )
            }
        },

        pedido_id:
            Number(pedidoId)
    }
}

// ======================================================
// GERAR CARTÃO MOCK
// ======================================================
//
// Para testar diferentes cenários:
//
// approved
// pending
// rejected
//
// Você pode enviar:
// dadosCartao.mockStatus
//
// ======================================================

export function gerarCartaoMock({
    pedidoId,
    valor,
    status = "approved"
}) {

    const statusValido = [
        "approved",
        "pending",
        "rejected"
    ]

    const statusFinal =
        statusValido.includes(status)
            ? status
            : "approved"

    return {

        id:
            gerarTransacaoMock("CARD"),

        status:
            statusFinal,

        status_detail:
            statusFinal === "approved"
                ? "accredited"
                : statusFinal === "pending"
                    ? "pending_review"
                    : "cc_rejected_other_reason",

        transaction_amount:
            Number(valor),

        pedido_id:
            Number(pedidoId)
    }
}

// ======================================================
// GERAR PAGAMENTO MOCK
// ======================================================

export async function gerarPagamentoMock({
    tipo,
    pedidoId,
    valor,
    status
}) {

    if (tipo === "pix") {

        return gerarPixMock({
            pedidoId,
            valor
        })
    }

    if (tipo === "cartao") {

        return gerarCartaoMock({
            pedidoId,
            valor,
            status
        })
    }

    return {

        id:
            gerarTransacaoMock("PAY"),

        status:
            "pending",

        transaction_amount:
            Number(valor),

        pedido_id:
            Number(pedidoId)
    }
}

// ======================================================
// MAPEAR STATUS
// ======================================================

export function mapearStatusMP(statusMP) {

    switch (statusMP) {

        case "approved":

            return {

                pagamento: "aprovado",

                pedido: "pago"
            }

        case "pending":

        case "in_process":

        case "authorized":

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

        case "refunded":

        case "charged_back":

            return {

                pagamento: "cancelado",

                pedido: "cancelado"
            }

        default:

            console.warn(
                `Status do gateway não mapeado: ${statusMP}`
            )

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

    if (
        !xSignature ||
        !xRequestId ||
        !dataId ||
        !process.env.MP_WEBHOOK_SECRET
    ) {

        return false
    }

    const partes = {}

    for (
        const parte of String(xSignature).split(",")
    ) {

        const [chave, valor] =
            parte.split("=")

        if (chave && valor) {

            partes[chave.trim()] =
                valor.trim()
        }
    }

    const ts =
        partes.ts

    const v1 =
        partes.v1

    if (!ts || !v1) {

        return false
    }

    const manifest =
        `id:${dataId};request-id:${xRequestId};ts:${ts};`

    const hmac =
        crypto
            .createHmac(
                "sha256",
                process.env.MP_WEBHOOK_SECRET
            )
            .update(manifest)
            .digest("hex")

    try {

        const assinaturaGerada =
            Buffer.from(hmac, "utf8")

        const assinaturaRecebida =
            Buffer.from(v1, "utf8")

        if (
            assinaturaGerada.length !==
            assinaturaRecebida.length
        ) {

            return false
        }

        return crypto.timingSafeEqual(
            assinaturaGerada,
            assinaturaRecebida
        )

    } catch {

        return false
    }
}