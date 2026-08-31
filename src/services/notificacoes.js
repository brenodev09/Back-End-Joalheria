import nodemailer from "nodemailer"

const senhaSmtp = String(process.env.SMTP_PASSWORD || "")
    .replace(/\s/g, "")

const transporter = process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    senhaSmtp
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: senhaSmtp
            }
            : undefined,
        connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
        greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 5000),
        socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 5000)
    })
    : null

export const emailConfigurado = Boolean(transporter)

export async function enviarEmail({ para, assunto, texto }) {
    if (!para) {
        console.warn("E-MAIL NÃO ENVIADO: destinatário ausente")
        return false
    }

    if (!transporter) {
        console.warn(
            "E-MAIL NÃO ENVIADO: configure SMTP_PASSWORD com uma senha de aplicativo do Gmail"
        )
        return false
    }

    const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 5000)

    try {
        await Promise.race([
            transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: para,
                subject: assunto,
                text: texto
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("SMTP timeout")), timeoutMs))
        ])

        console.log(`E-MAIL ENVIADO: ${assunto} -> ${para}`)
        return true
    } catch (error) {
        console.error("ERRO AO ENVIAR E-MAIL:", error.message)
        return false
    }
}

export async function enviarEmailAdministradores({ assunto, texto }) {
    const destinatarios = String(process.env.ADMIN_EMAIL || "")
        .split(",")
        .map(email => email.trim())
        .filter(Boolean)

    await Promise.all(
        destinatarios.map(para => enviarEmail({
            para,
            assunto,
            texto
        }))
    )
}
