import multer from "multer"
import path from "path"

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/")
    },

    filename: (req, file, cb) => {
        const timestamp = Date.now()

        const nomeArquivo =
            timestamp + "-" + file.originalname.replace(/\s+/g, "-")

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