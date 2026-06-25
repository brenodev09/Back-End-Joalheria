import jwt from 'jsonwebtoken';

export function autenticarToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json(
                { erro: "Token invalido ou expirado." }
            );
        }
        const [tipo, token] = authHeader.split(' ');
        if (tipo !== 'Bearer' || !token) {
            return res.status(401).json(
                { erro: "Token invalido ou expirado." }
            );
        }
        const usuario = jwt.verify(token, process.env.JWT_SECRET)

        req.usuario = usuario;

        next();

    } catch (error) {
        console.error(error);
        return res.status(401).json({ erro: "Token invalido ou expirado." });
    }

}