import nodemailer from "nodemailer"

const senhaSmtp = String(process.env.SMTP_PASSWORD || "")
    .replace(/\s/g, "")

const transporter = process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    senhaSmtp
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
        auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: senhaSmtp
            }
            : undefined
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

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: para,
            subject: assunto,
            text: texto
        })

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
