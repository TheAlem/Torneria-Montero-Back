const API_TOKEN = process.env.API_TOKEN || '';
export function apiKeyAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!API_TOKEN)
        return res.status(500).json({ error: 'Configuración del servidor inválida: falta API_TOKEN' });
    if (!key || key !== API_TOKEN)
        return res.status(401).json({ error: 'API key inválida' });
    next();
}
export default apiKeyAuth;
