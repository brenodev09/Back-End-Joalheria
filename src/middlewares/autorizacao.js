export function apenasAdmin(req, res, next) {
    if (req.usuario?.tipo !== "admin") {
        return res.status(403).json({
            erro: "Acesso permitido somente para administradores"
        })
    }

    next()
}