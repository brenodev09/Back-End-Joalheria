import express from "express";
import db from "../database.js";
import upload from "../../config/multer.js";

const router = express.Router();

// Status de pedido considerados "venda válida" para receita/pedidos/vendidos.
// Ajuste aqui se quiser incluir/excluir algum status.
const STATUS_VENDA_VALIDA = ["pago", "enviado", "entregue"];

// ======================================================
// HELPERS DE STATUS INTELIGENTE
// ------------------------------------------------------
// O admin NUNCA define o status manualmente.
// Ele apenas configura as datas + o tipo (permanente/campanha),
// e o backend calcula o estado real da coleção.
// ======================================================

// Converte um valor de data (Date do mysql2 OU string) para "YYYY-MM-DD".
// Assim conseguimos comparar datas por string, sem problema de fuso.
function paraYMD(valor) {
    if (!valor) {
        return null;
    }

    if (valor instanceof Date) {
        const ano = valor.getFullYear();
        const mes = String(valor.getMonth() + 1).padStart(2, "0");
        const dia = String(valor.getDate()).padStart(2, "0");

        return `${ano}-${mes}-${dia}`;
    }

    return String(valor).slice(0, 10);
}

// Retorna a data de hoje no formato "YYYY-MM-DD".
function hojeYMD() {
    return paraYMD(new Date());
}

// Calcula o status da coleção com base em ativo + permanente + datas.
// Possíveis retornos: "rascunho" | "permanente" | "agendada" | "ativa" | "encerrada"
function calcularStatus(colecao) {
    // Coleção desligada = rascunho (não aparece para o cliente).
    if (Number(colecao.ativo) === 0) {
        return "rascunho";
    }

    // Coleção permanente fica sempre disponível (linha fixa da loja).
    if (Number(colecao.permanente) === 1) {
        return "permanente";
    }

    const hoje = hojeYMD();
    const inicio = paraYMD(colecao.data_inicio);
    const fim = paraYMD(colecao.data_fim);

    // Sem data de início definida ainda = rascunho.
    if (!inicio) {
        return "rascunho";
    }

    // Antes da data de início = agendada (aguardando lançamento).
    if (hoje < inicio) {
        return "agendada";
    }

    // Passou da data de encerramento = encerrada.
    if (fim && hoje > fim) {
        return "encerrada";
    }

    // Dentro do período (ou sem data fim) = ativa.
    return "ativa";
}

// Quantos dias faltam para o lançamento (ou null se não se aplica).
function diasParaLancamento(colecao) {
    const inicio = paraYMD(colecao.data_inicio);

    if (!inicio) {
        return null;
    }

    const hoje = new Date(`${hojeYMD()}T00:00:00`);
    const dataInicio = new Date(`${inicio}T00:00:00`);

    const diferenca = dataInicio.getTime() - hoje.getTime();
    const dias = Math.ceil(diferenca / (1000 * 60 * 60 * 24));

    return dias > 0 ? dias : 0;
}

// Enriquece a coleção com os campos calculados (status, dias_para_lancamento).
function comStatus(colecao) {
    return {
        ...colecao,
        status: calcularStatus(colecao),
        dias_para_lancamento: diasParaLancamento(colecao)
    };
}

const paraBooleano = (valor) =>
    valor === "true" || valor === true || valor === "1" || valor === 1 ? 1 : 0;

// ======================================================
// LISTAR TODAS AS COLEÇÕES (com métricas reais + status)
// GET /colecoes
// ======================================================

router.get("/", async (req, res) => {
    try {
        const placeholdersStatus = STATUS_VENDA_VALIDA.map(() => "?").join(",");

        const [colecoes] = await db.query(
            `
            SELECT
                c.*,
                COUNT(DISTINCT cp.produto_id) AS quantidade_produtos,
                COALESCE(vendas.receita, 0)   AS receita,
                COALESCE(vendas.pedidos, 0)   AS pedidos,
                COALESCE(vendas.vendidos, 0)  AS vendidos,
                CASE
                    WHEN c.visualizacoes > 0
                        THEN ROUND((COALESCE(vendas.pedidos, 0) / c.visualizacoes) * 100, 1)
                    ELSE NULL
                END AS conversao,
                CASE
                    WHEN c.meta_receita IS NOT NULL AND c.meta_receita > 0
                        THEN ROUND((COALESCE(vendas.receita, 0) / c.meta_receita) * 100, 1)
                    ELSE NULL
                END AS meta_percentual
            FROM colecoes c
            LEFT JOIN colecoes_produtos cp
                ON cp.colecao_id = c.id
            LEFT JOIN (
                SELECT
                    cp2.colecao_id AS colecao_id,
                    SUM(pi.subtotal)          AS receita,
                    COUNT(DISTINCT pi.pedido_id) AS pedidos,
                    SUM(pi.quantidade)        AS vendidos
                FROM colecoes_produtos cp2
                INNER JOIN pedidos_itens pi
                    ON pi.produto_id = cp2.produto_id
                INNER JOIN pedidos p
                    ON p.id = pi.pedido_id
                WHERE p.status_pedido IN (${placeholdersStatus})
                GROUP BY cp2.colecao_id
            ) vendas ON vendas.colecao_id = c.id
            GROUP BY c.id
            ORDER BY c.id DESC
            `,
            STATUS_VENDA_VALIDA
        );

        // Adiciona o status calculado em cada coleção.
        res.json(colecoes.map(comStatus));
    } catch (error) {
        console.error("ERRO AO LISTAR COLEÇÕES:", error);
        res.status(500).json({
            erro: "Erro ao listar coleções"
        });
    }
});

// ======================================================
// ROTAS PÚBLICAS (LOJA / CLIENTE)
// ------------------------------------------------------
// Precisam vir ANTES de "/:id" para não serem capturadas
// pela rota de detalhes.
// ======================================================

// PRÓXIMAS COLEÇÕES (agendadas) -> usadas no contador regressivo.
// GET /colecoes/publicas/proximas
router.get("/publicas/proximas", async (req, res) => {
    try {
        const [colecoes] = await db.query(
            `
            SELECT
                c.*,
                COUNT(DISTINCT cp.produto_id) AS quantidade_produtos
            FROM colecoes c
            LEFT JOIN colecoes_produtos cp
                ON cp.colecao_id = c.id
            WHERE c.ativo = 1
              AND c.permanente = 0
              AND c.data_inicio IS NOT NULL
              AND c.data_inicio > CURDATE()
            GROUP BY c.id
            ORDER BY c.data_inicio ASC
            `
        );

        res.json(colecoes.map(comStatus));
    } catch (error) {
        console.error("ERRO AO LISTAR PRÓXIMAS COLEÇÕES:", error);
        res.status(500).json({
            erro: "Erro ao listar próximas coleções"
        });
    }
});

// COLEÇÕES ATIVAS (já lançadas) -> usadas na Home/catálogo.
// GET /colecoes/publicas/ativas
router.get("/publicas/ativas", async (req, res) => {
    try {
        const [colecoes] = await db.query(
            `
            SELECT
                c.*,
                COUNT(DISTINCT cp.produto_id) AS quantidade_produtos
            FROM colecoes c
            LEFT JOIN colecoes_produtos cp
                ON cp.colecao_id = c.id
            WHERE c.ativo = 1
              AND (
                    c.permanente = 1
                    OR (
                        c.data_inicio IS NOT NULL
                        AND c.data_inicio <= CURDATE()
                        AND (c.data_fim IS NULL OR c.data_fim >= CURDATE())
                    )
              )
            GROUP BY c.id
            ORDER BY c.destaque DESC, c.data_inicio DESC
            `
        );

        res.json(colecoes.map(comStatus));
    } catch (error) {
        console.error("ERRO AO LISTAR COLEÇÕES ATIVAS:", error);
        res.status(500).json({
            erro: "Erro ao listar coleções ativas"
        });
    }
});

// ======================================================
// INTERESSADOS ("Quero ser avisado")
// ======================================================

// AVISOS PENDENTES DO USUÁRIO (para o modal ao logar).
// Retorna as coleções que o usuário pediu para ser avisado,
// que JÁ estão ativas e que ainda não foram notificadas.
// GET /colecoes/avisos/:usuarioId
router.get("/avisos/:usuarioId", async (req, res) => {
    try {
        const { usuarioId } = req.params;

        const [colecoes] = await db.query(
            `
            SELECT
                c.*,
                ic.id AS interesse_id
            FROM interessados_colecao ic
            INNER JOIN colecoes c
                ON c.id = ic.colecao_id
            WHERE ic.usuario_id = ?
              AND ic.notificado = 0
              AND c.ativo = 1
              AND (
                    c.permanente = 1
                    OR (
                        c.data_inicio IS NOT NULL
                        AND c.data_inicio <= CURDATE()
                        AND (c.data_fim IS NULL OR c.data_fim >= CURDATE())
                    )
              )
            ORDER BY c.data_inicio DESC
            `,
            [usuarioId]
        );

        res.json(colecoes.map(comStatus));
    } catch (error) {
        console.error("ERRO AO BUSCAR AVISOS:", error);
        res.status(500).json({
            erro: "Erro ao buscar avisos de lançamento"
        });
    }
});

// MARCAR AVISOS COMO NOTIFICADOS (ao fechar o modal).
// Se vier colecao_ids no corpo, marca só essas; senão marca todas as pendentes.
// PUT /colecoes/avisos/:usuarioId/notificar
router.put("/avisos/:usuarioId/notificar", async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { colecao_ids } = req.body;

        if (Array.isArray(colecao_ids) && colecao_ids.length > 0) {
            const ids = colecao_ids
                .map(Number)
                .filter((id) => Number.isInteger(id) && id > 0);

            if (ids.length === 0) {
                return res.status(400).json({
                    erro: "colecao_ids inválido"
                });
            }

            const placeholders = ids.map(() => "?").join(",");

            await db.query(
                `
                UPDATE interessados_colecao
                SET notificado = 1
                WHERE usuario_id = ?
                  AND colecao_id IN (${placeholders})
                `,
                [usuarioId, ...ids]
            );
        } else {
            await db.query(
                `
                UPDATE interessados_colecao
                SET notificado = 1
                WHERE usuario_id = ?
                `,
                [usuarioId]
            );
        }

        res.json({
            mensagem: "Avisos marcados como notificados"
        });
    } catch (error) {
        console.error("ERRO AO NOTIFICAR AVISOS:", error);
        res.status(500).json({
            erro: "Erro ao atualizar avisos"
        });
    }
});

// CADASTRAR INTERESSE ("Quero ser avisado").
// POST /colecoes/:id/interessados   body: { usuario_id }
router.post("/:id/interessados", async (req, res) => {
    try {
        const { id } = req.params;
        const { usuario_id } = req.body;

        if (!usuario_id) {
            return res.status(400).json({
                erro: "usuario_id é obrigatório"
            });
        }

        const [colecao] = await db.query(
            `SELECT permitir_interessados FROM colecoes WHERE id = ?`,
            [id]
        );

        if (colecao.length === 0) {
            return res.status(404).json({
                erro: "Coleção não encontrada"
            });
        }

        if (Number(colecao[0].permitir_interessados) === 0) {
            return res.status(400).json({
                erro: "Esta coleção não permite lista de interessados"
            });
        }

        // INSERT IGNORE evita erro caso o usuário clique duas vezes
        // (existe UNIQUE (usuario_id, colecao_id) no banco).
        await db.query(
            `
            INSERT IGNORE INTO interessados_colecao
            (usuario_id, colecao_id)
            VALUES (?, ?)
            `,
            [usuario_id, id]
        );

        res.status(201).json({
            mensagem: "Você será avisado quando a coleção for lançada"
        });
    } catch (error) {
        console.error("ERRO AO CADASTRAR INTERESSE:", error);
        res.status(500).json({
            erro: "Erro ao cadastrar interesse"
        });
    }
});

// VERIFICAR SE O USUÁRIO JÁ É INTERESSADO.
// GET /colecoes/:id/interessados/:usuarioId
router.get("/:id/interessados/:usuarioId", async (req, res) => {
    try {
        const { id, usuarioId } = req.params;

        const [registro] = await db.query(
            `
            SELECT id
            FROM interessados_colecao
            WHERE colecao_id = ?
              AND usuario_id = ?
            `,
            [id, usuarioId]
        );

        res.json({
            interessado: registro.length > 0
        });
    } catch (error) {
        console.error("ERRO AO VERIFICAR INTERESSE:", error);
        res.status(500).json({
            erro: "Erro ao verificar interesse"
        });
    }
});

// REMOVER INTERESSE.
// DELETE /colecoes/:id/interessados/:usuarioId
router.delete("/:id/interessados/:usuarioId", async (req, res) => {
    try {
        const { id, usuarioId } = req.params;

        await db.query(
            `
            DELETE FROM interessados_colecao
            WHERE colecao_id = ?
              AND usuario_id = ?
            `,
            [id, usuarioId]
        );

        res.json({
            mensagem: "Interesse removido"
        });
    } catch (error) {
        console.error("ERRO AO REMOVER INTERESSE:", error);
        res.status(500).json({
            erro: "Erro ao remover interesse"
        });
    }
});

// ======================================================
// BUSCAR COLEÇÃO COMPLETA (incrementa visualizações)
// GET /colecoes/:id
// ======================================================

router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        // Conta como 1 visualização real toda vez que os detalhes
        // da coleção são abertos (equivalente ao "Ver detalhes" da tela).
        await db.query(
            `
            UPDATE colecoes
            SET visualizacoes = visualizacoes + 1
            WHERE id = ?
            `,
            [id]
        );

        const [colecoes] = await db.query(`
            SELECT *
            FROM colecoes
            WHERE id = ?
        `, [id]);

        if (colecoes.length === 0) {
            return res.status(404).json({
                erro: "Coleção não encontrada"
            });
        }

        // Produtos já respeitando a ordem definida na tabela de relacionamento.
        const [produtos] = await db.query(`
            SELECT
                p.id,
                p.nome,
                p.preco,
                p.imagem,
                p.ativo,
                p.destaque,
                cp.ordem
            FROM produtos p
            INNER JOIN colecoes_produtos cp
                ON cp.produto_id = p.id
            WHERE cp.colecao_id = ?
            ORDER BY cp.ordem ASC, p.id DESC
        `, [id]);

        res.json({
            ...comStatus(colecoes[0]),
            produtos
        });

    } catch (error) {
        console.error("ERRO AO BUSCAR COLEÇÃO:", error);
        res.status(500).json({
            erro: "Erro ao buscar coleção"
        });
    }
});

// ======================================================
// CADASTRAR COLEÇÃO
// POST /colecoes
// ------------------------------------------------------
// OBS: NÃO recebemos "status". Ele é sempre calculado.
// ======================================================
router.post(
    "/",
    upload.single("imagem"),
    async (req, res) => {
        const conexao = await db.getConnection();

        try {
            const {
                nome,
                descricao,
                ativo,
                destaque,
                produto_ids,
                data_inicio,
                data_fim,
                categoria,
                permanente,
                meta_receita,
                mostrar_contador,
                permitir_interessados
            } = req.body;

            // ==================================================
            // VALIDAR NOME
            // ==================================================

            if (!nome || nome.trim() === "") {
                return res.status(400).json({
                    erro: "O nome da coleção é obrigatório"
                });
            }

            // ==================================================
            // VALIDAÇÃO INTELIGENTE DE DATAS (regra de negócio)
            // ==================================================

            const permanenteConvertido = paraBooleano(permanente);

            if (permanenteConvertido === 0) {
                // Campanha precisa de data de início.
                if (!data_inicio) {
                    return res.status(400).json({
                        erro: "Coleções de campanha precisam de uma data de início."
                    });
                }

                // Data fim não pode ser anterior à data início.
                if (data_fim && data_fim < data_inicio) {
                    return res.status(400).json({
                        erro: "A data de encerramento não pode ser anterior à data de início."
                    });
                }
            }

            // ==================================================
            // PROCESSAR IMAGEM
            // ==================================================

            const imagem = req.file
                ? `/uploads/${req.file.filename}`
                : null;

            // ==================================================
            // CONVERSÕES BOOLEANAS
            // ==================================================

            const ativoConvertido = paraBooleano(ativo);
            const destaqueConvertido = paraBooleano(destaque);
            const contadorConvertido =
                mostrar_contador === undefined ? 1 : paraBooleano(mostrar_contador);
            const interessadosConvertido =
                permitir_interessados === undefined ? 1 : paraBooleano(permitir_interessados);

            // ==================================================
            // PROCESSAR PRODUTOS
            // ==================================================

            let produtos = [];
            if (produto_ids) {
                if (typeof produto_ids === "string") {
                    try {
                        produtos = JSON.parse(produto_ids);
                    } catch {
                        produtos = produto_ids
                            .split(",")
                            .map(id => Number(id.trim()))
                            .filter(Boolean);
                    }
                } else if (Array.isArray(produto_ids)) {
                    produtos = produto_ids;
                }
            }

            // ==================================================
            // NORMALIZAR IDS
            // ==================================================

            produtos = [
                ...new Set(
                    produtos
                        .map(Number)
                        .filter(id => Number.isInteger(id) && id > 0)
                )
            ];

            // ==================================================
            // VALIDAR PRODUTOS
            // ==================================================

            if (produtos.length === 0) {
                return res.status(400).json({
                    erro: "Selecione pelo menos um produto para a coleção."
                });
            }

            // ==================================================
            // INICIAR TRANSAÇÃO
            // ==================================================

            await conexao.beginTransaction();

            // ==================================================
            // CRIAR COLEÇÃO
            // ==================================================

            const [resultado] = await conexao.query(
                `
                INSERT INTO colecoes
                (
                    nome,
                    descricao,
                    imagem,
                    ativo,
                    destaque,
                    data_inicio,
                    data_fim,
                    categoria,
                    permanente,
                    meta_receita,
                    mostrar_contador,
                    permitir_interessados
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    nome.trim(),
                    descricao?.trim() || null,
                    imagem,
                    ativoConvertido,
                    destaqueConvertido,
                    data_inicio || null,
                    data_fim || null,
                    categoria?.trim() || null,
                    permanenteConvertido,
                    meta_receita || null,
                    contadorConvertido,
                    interessadosConvertido
                ]
            );

            const colecaoId = resultado.insertId;

            // ==================================================
            // VALIDAR SE OS PRODUTOS EXISTEM
            // ==================================================

            const placeholders = produtos.map(() => "?").join(",");

            const [produtosExistentes] = await conexao.query(
                `
                SELECT id
                FROM produtos
                WHERE id IN (${placeholders})
                `,
                produtos
            );

            const idsExistentes = produtosExistentes.map(produto => produto.id);

            if (idsExistentes.length !== produtos.length) {
                throw new Error(
                    "Um ou mais produtos selecionados não existem."
                );
            }

            // ==================================================
            // RELACIONAR PRODUTOS (com ordem)
            // ==================================================

            const valoresRelacionamento = produtos.map((produtoId, indice) => [
                colecaoId,
                produtoId,
                indice
            ]);

            await conexao.query(
                `
                INSERT INTO colecoes_produtos
                (
                    colecao_id,
                    produto_id,
                    ordem
                )
                VALUES ?
                `,
                [valoresRelacionamento]
            );

            // ==================================================
            // FINALIZAR TRANSAÇÃO
            // ==================================================

            await conexao.commit();

            // ==================================================
            // BUSCAR COLEÇÃO CRIADA
            // ==================================================

            const [novaColecao] = await conexao.query(
                `
                SELECT *
                FROM colecoes
                WHERE id = ?
                `,
                [colecaoId]
            );

            // ==================================================
            // RESPOSTA
            // ==================================================

            res.status(201).json({
                ...comStatus(novaColecao[0]),
                produtos: produtos
            });

        } catch (error) {
            await conexao.rollback();
            console.error("ERRO AO CRIAR COLEÇÃO:", error);
            res.status(500).json({
                erro: "Erro ao criar coleção",
                detalhes: error.message
            });
        } finally {
            conexao.release();
        }
    }
);

// ======================================================
// EDITAR COLEÇÃO
// PUT /colecoes/:id
// ======================================================

router.put("/:id", upload.single("imagem"), async (req, res) => {
    try {
        const { id } = req.params;

        const {
            nome,
            descricao,
            ativo,
            destaque,
            data_inicio,
            data_fim,
            categoria,
            permanente,
            meta_receita,
            mostrar_contador,
            permitir_interessados
        } = req.body;

        const [colecaoExistente] = await db.query(`
            SELECT *
            FROM colecoes
            WHERE id = ?
        `, [id]);

        if (colecaoExistente.length === 0) {
            return res.status(404).json({
                erro: "Coleção não encontrada"
            });
        }

        const permanenteConvertido = paraBooleano(permanente);

        // Mesma validação inteligente de datas da criação.
        if (permanenteConvertido === 0) {
            if (data_fim && data_inicio && data_fim < data_inicio) {
                return res.status(400).json({
                    erro: "A data de encerramento não pode ser anterior à data de início."
                });
            }
        }

        const ativoConvertido = paraBooleano(ativo);
        const destaqueConvertido = paraBooleano(destaque);
        const contadorConvertido =
            mostrar_contador === undefined
                ? colecaoExistente[0].mostrar_contador
                : paraBooleano(mostrar_contador);
        const interessadosConvertido =
            permitir_interessados === undefined
                ? colecaoExistente[0].permitir_interessados
                : paraBooleano(permitir_interessados);

        let query = `
            UPDATE colecoes SET
            nome = ?,
            descricao = ?,
            ativo = ?,
            destaque = ?,
            data_inicio = ?,
            data_fim = ?,
            categoria = ?,
            permanente = ?,
            meta_receita = ?,
            mostrar_contador = ?,
            permitir_interessados = ?
        `;

        let valores = [
            nome,
            descricao || null,
            ativoConvertido,
            destaqueConvertido,
            data_inicio || null,
            data_fim || null,
            categoria?.trim() || null,
            permanenteConvertido,
            meta_receita || null,
            contadorConvertido,
            interessadosConvertido
        ];

        if (req.file) {
            query += `, imagem = ?`;
            valores.push(`/uploads/${req.file.filename}`);
        }

        query += ` WHERE id = ?`;
        valores.push(id);

        await db.query(query, valores);

        const [colecaoAtualizada] = await db.query(`
            SELECT *
            FROM colecoes
            WHERE id = ?
        `, [id]);

        res.json(comStatus(colecaoAtualizada[0]));

    } catch (error) {
        console.error("ERRO AO EDITAR COLEÇÃO:", error);
        res.status(500).json({
            erro: "Erro ao editar coleção",
            detalhes: error.message
        });
    }
});

// ======================================================
// DELETAR COLEÇÃO
// DELETE /colecoes/:id
// ======================================================

router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [resultado] = await db.query(`
            DELETE FROM colecoes
            WHERE id = ?
        `, [id]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Coleção não encontrada"
            });
        }

        res.json({
            mensagem: "Coleção removida com sucesso"
        });

    } catch (error) {
        console.error("ERRO AO DELETAR COLEÇÃO:", error);
        res.status(500).json({
            erro: "Erro ao deletar coleção"
        });
    }
});

// ======================================================
// SINCRONIZAR AS COLEÇÕES DE UM PRODUTO
// ------------------------------------------------------
// Usada nos modais de ADICIONAR / EDITAR PRODUTO.
// Recebe a lista final de coleções do produto e ajusta
// a tabela colecoes_produtos de uma vez (remove + insere).
// PUT /colecoes/produto/:produtoId   body: { colecao_ids: [] }
// ======================================================

router.put("/produto/:produtoId", async (req, res) => {
    const conexao = await db.getConnection();

    try {
        const { produtoId } = req.params;
        const { colecao_ids } = req.body;

        const ids = Array.isArray(colecao_ids)
            ? [
                  ...new Set(
                      colecao_ids
                          .map(Number)
                          .filter((id) => Number.isInteger(id) && id > 0)
                  )
              ]
            : [];

        await conexao.beginTransaction();

        // Remove todos os vínculos atuais do produto.
        await conexao.query(
            `DELETE FROM colecoes_produtos WHERE produto_id = ?`,
            [produtoId]
        );

        // Recria os vínculos com a lista enviada (mantendo uma ordem).
        if (ids.length > 0) {
            const valores = ids.map((colecaoId, indice) => [
                colecaoId,
                produtoId,
                indice
            ]);

            await conexao.query(
                `
                INSERT INTO colecoes_produtos
                (colecao_id, produto_id, ordem)
                VALUES ?
                `,
                [valores]
            );
        }

        await conexao.commit();

        res.json({
            mensagem: "Coleções do produto atualizadas",
            colecao_ids: ids
        });
    } catch (error) {
        await conexao.rollback();
        console.error("ERRO AO SINCRONIZAR COLEÇÕES DO PRODUTO:", error);
        res.status(500).json({
            erro: "Erro ao atualizar coleções do produto",
            detalhes: error.message
        });
    } finally {
        conexao.release();
    }
});

// LISTAR AS COLEÇÕES DE UM PRODUTO (para pré-marcar no modal de edição).
// GET /colecoes/produto/:produtoId
router.get("/produto/:produtoId", async (req, res) => {
    try {
        const { produtoId } = req.params;

        const [colecoes] = await db.query(
            `
            SELECT c.id, c.nome
            FROM colecoes c
            INNER JOIN colecoes_produtos cp
                ON cp.colecao_id = c.id
            WHERE cp.produto_id = ?
            ORDER BY cp.ordem ASC
            `,
            [produtoId]
        );

        res.json(colecoes);
    } catch (error) {
        console.error("ERRO AO LISTAR COLEÇÕES DO PRODUTO:", error);
        res.status(500).json({
            erro: "Erro ao listar coleções do produto"
        });
    }
});

// ======================================================
// ADICIONAR PRODUTOS À COLEÇÃO
// POST /colecoes/:id/produtos
// ======================================================

router.post("/:id/produtos", async (req, res) => {
    try {
        const { id } = req.params;
        const { produto_ids } = req.body;

        if (!Array.isArray(produto_ids)) {
            return res.status(400).json({
                erro: "produto_ids deve ser um array"
            });
        }

        const [colecao] = await db.query(`
            SELECT id
            FROM colecoes
            WHERE id = ?
        `, [id]);

        if (colecao.length === 0) {
            return res.status(404).json({
                erro: "Coleção não encontrada"
            });
        }

        for (const produtoId of produto_ids) {
            await db.query(`
                INSERT IGNORE INTO colecoes_produtos
                (
                    colecao_id,
                    produto_id
                )
                VALUES (?, ?)
            `, [
                id,
                produtoId
            ]);
        }

        res.json({
            mensagem: "Produtos adicionados à coleção"
        });

    } catch (error) {
        console.error("ERRO AO ADICIONAR PRODUTOS:", error);
        res.status(500).json({
            erro: "Erro ao adicionar produtos à coleção",
            detalhes: error.message
        });
    }
});

// ======================================================
// REMOVER PRODUTO DA COLEÇÃO
// DELETE /colecoes/:id/produtos/:produtoId
// ======================================================

router.delete("/:id/produtos/:produtoId", async (req, res) => {
    try {
        const {
            id,
            produtoId
        } = req.params;

        const [resultado] = await db.query(`
            DELETE FROM colecoes_produtos
            WHERE colecao_id = ?
            AND produto_id = ?
        `, [
            id,
            produtoId
        ]);

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                erro: "Produto não está nesta coleção"
            });
        }

        res.json({
            mensagem: "Produto removido da coleção"
        });

    } catch (error) {
        console.error("ERRO AO REMOVER PRODUTO:", error);
        res.status(500).json({
            erro: "Erro ao remover produto da coleção"
        });
    }
});

export default router;
