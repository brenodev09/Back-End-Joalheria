import multer from "multer"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pastaUploads = path.join(raizProjeto, "uploads", "relatorios")
export const pastaRelatorios = path.join(raizProjeto, "uploads", "relatorios")
fs.mkdirSync(pastaUploads, { recursive: true })
fs.mkdirSync(pastaRelatorios, { recursive: true })


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, pastaUploads)
    },

    filename: (req, file, cb) => {
        const timestamp = Date.now()
        const extensao = path.extname(file.originalname).toLowerCase()
        const nome = path.basename(file.originalname, extensao)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
        const nomeArquivo = `${timestamp}-${nome || "arquivo"}${extensao}`

        cb(null, nomeArquivo)
    }
})

const fileFilter = (req, file, cb) => {
    const tiposPermitidos = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
    ]

    if (tiposPermitidos.includes(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error("Formato de arquivo inválido"))
    }
}

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
})


export default upload

