require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// CONFIGURAÇÃO PADRÃO
// ======================================================

const BARCO_PADRAO_PREFEITURA = "B/M TIO GRACY";
const LIMITE_DIAS_VALIDADE_PADRAO = 7;

// ======================================================
// FUNÇÕES DE APOIO
// ======================================================

function gerarCodigoPublico() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let codigo = "";
  for (let i = 0; i < 10; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

function gerarCodigoPublicoUnico(callback) {
  const codigo = gerarCodigoPublico();

  const sql = "SELECT id FROM requisicoes WHERE codigo_publico = ? LIMIT 1";
  db.query(sql, [codigo], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar codigo_publico:", err);
      return callback(err);
    }

    if (rows.length > 0) {
      return gerarCodigoPublicoUnico(callback);
    }

    callback(null, codigo);
  });
}

function gerarNumeroRequisicaoUnico(ano, callback) {
  const sql = `
    SELECT MAX(CAST(SUBSTRING_INDEX(numero_formatado, '/', 1) AS UNSIGNED)) AS ultimo_numero
    FROM requisicoes
    WHERE numero_formatado LIKE ?
  `;

  db.query(sql, [`%/${ano}`], (err, rows) => {
    if (err) {
      console.error("Erro ao buscar último numero_formatado:", err);
      return callback(err);
    }

    const ultimoNumero = Number(rows?.[0]?.ultimo_numero || 0);
    const proximoNumero = ultimoNumero + 1;
    const numeroFormatado = `${String(proximoNumero).padStart(4, "0")}/${ano}`;

    return callback(null, numeroFormatado);
  });
}

function normalizarStatus(status = "") {
  const s = String(status || "").toUpperCase().trim();
  if (s === "AUTORIZADA") return "APROVADA";
  return s;
}

function mapStatusTrecho(statusReq = "") {
  const s = String(statusReq || "").toUpperCase().trim();
  if (s === "APROVADA" || s === "AUTORIZADA") return "AUTORIZADA";
  if (s === "REPROVADA" || s === "CANCELADA") return "REPROVADA";
  if (s === "UTILIZADA") return "UTILIZADA";
  if (s === "VENCIDA") return "VENCIDA";
  return "PENDENTE";
}

function parseJsonSeguro(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function addDaysToDate(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function normalizarTipoTrecho(tipo = "") {
  const t = String(tipo || "").toUpperCase().trim();
  if (t === "IDA" || t === "VOLTA") return t;
  return "";
}

function extrairConfigValidade(observacoes) {
  const extras = parseJsonSeguro(observacoes);
  const cfg = extras.validade_config || {};

  return {
    ativo: !!cfg.ativo,
    aplica_em: normalizarTipoTrecho(cfg.aplica_em),
    data_inicio: cfg.data_inicio || null,
    data_fim: cfg.data_fim || null,
    validade_ate_ida: cfg.validade_ate_ida || null,
    validade_ate_volta: cfg.validade_ate_volta || null,
    data_maxima: cfg.data_maxima || null,
    dias_limite:
      cfg.dias_limite != null
        ? Number(cfg.dias_limite)
        : LIMITE_DIAS_VALIDADE_PADRAO,
  };
}

function montarObservacoesComValidade(observacoesOriginais, novasInfos = {}) {
  const extras = parseJsonSeguro(observacoesOriginais);

  extras.validade_config = {
    ...(extras.validade_config || {}),
    ...novasInfos,
  };

  return JSON.stringify(extras);
}

// ======================================================
// ROTA DE SAÚDE
// ======================================================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API Prefeitura de Borba ON" });
});

// ======================================================
// LOGIN
// ======================================================
app.post("/api/login", (req, res) => {
  const { login, senha } = req.body;

  if (!login || !senha) {
    return res.status(400).json({ error: "Informe login e senha." });
  }

  const sql = `
    SELECT id, nome, login, perfil, setor_id, cpf, barco
    FROM usuarios
    WHERE LOWER(login) = LOWER(?) AND senha = ? AND ativo = 1
    LIMIT 1
  `;

  db.query(sql, [login, senha], (err, rows) => {
    if (err) {
      console.error("Erro no login:", err);
      return res.status(500).json({ error: "Erro interno no servidor." });
    }

    if (rows.length === 0) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const row = rows[0];

    const user = {
      id: row.id,
      nome: row.nome,
      login: row.login,
      tipo: (row.perfil || "").toLowerCase(),
      setor_id: row.setor_id,
      cpf: row.cpf || null,
      barco: row.barco || null,
    };

    res.json({
      user,
      token: "ok",
    });
  });
});

// ======================================================
// ROTAS DE USUÁRIOS (CRUD)
// ======================================================
const router = express.Router();

router.get("/usuarios", (req, res) => {
  const { perfil } = req.query;

  let sql = `
    SELECT 
      id, nome, login, perfil, cpf, barco, setor_id, ativo
    FROM usuarios
    WHERE ativo = 1
  `;
  const params = [];

  if (perfil) {
    sql += " AND LOWER(perfil) = LOWER(?)";
    params.push(perfil);
  }

  sql += " ORDER BY nome";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Erro ao listar usuários:", err);
      return res.status(500).json({ error: "Erro ao listar usuários." });
    }
    res.json(rows);
  });
});

router.post("/usuarios", (req, res) => {
  let { nome, login, senha, tipo, cpf, barco, setor_id } = req.body;

  if (!nome || !login || !senha || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login, senha e tipo são obrigatórios." });
  }

  login = String(login).trim();
  tipo = String(tipo).toLowerCase();
  cpf = (cpf || "").trim();
  barco = (barco || "").trim();

  if (tipo === "representante" && !cpf) {
    return res.status(400).json({ error: "CPF do representante é obrigatório." });
  }

  if (tipo === "transportador" && (!cpf || !barco)) {
    return res.status(400).json({
      error: "CPF/CNPJ e nome do barco são obrigatórios para transportador.",
    });
  }

  const checkSql =
    "SELECT id FROM usuarios WHERE LOWER(login) = LOWER(?) LIMIT 1";

  db.query(checkSql, [login], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar login:", err);
      return res
        .status(500)
        .json({ error: "Erro ao verificar existência do login." });
    }

    if (rows.length > 0) {
      return res.status(409).json({ error: "Já existe um usuário com esse login." });
    }

    const insertSql = `
      INSERT INTO usuarios (nome, login, senha, perfil, cpf, barco, setor_id, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `;

    db.query(
      insertSql,
      [nome, login, senha, tipo, cpf || null, barco || null, setor_id || null],
      (err, result) => {
        if (err) {
          console.error("Erro ao criar usuário:", err);
          return res.status(500).json({ error: "Erro ao criar usuário." });
        }

        res.status(201).json({
          id: result.insertId,
          nome,
          login,
          perfil: tipo,
          cpf: cpf || null,
          barco: barco || null,
          setor_id: setor_id || null,
        });
      }
    );
  });
});

router.put("/usuarios/:id", (req, res) => {
  const { id } = req.params;
  let { nome, login, senha, tipo, cpf, barco, setor_id } = req.body;

  if (!nome || !login || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login e tipo são obrigatórios." });
  }

  login = String(login).trim();
  tipo = String(tipo).toLowerCase();
  cpf = (cpf || "").trim();
  barco = (barco || "").trim();

  if (tipo === "representante" && !cpf) {
    return res.status(400).json({ error: "CPF do representante é obrigatório." });
  }

  if (tipo === "transportador" && (!cpf || !barco)) {
    return res.status(400).json({
      error: "CPF/CNPJ e nome do barco são obrigatórios para transportador.",
    });
  }

  const fields = [
    "nome = ?",
    "login = ?",
    "perfil = ?",
    "cpf = ?",
    "barco = ?",
    "setor_id = ?",
  ];
  const params = [nome, login, tipo, cpf || null, barco || null, setor_id || null];

  if (senha && senha.trim() !== "") {
    fields.push("senha = ?");
    params.push(senha);
  }

  params.push(id);

  const sql = `
    UPDATE usuarios
    SET ${fields.join(", ")}
    WHERE id = ?
  `;

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error("Erro ao atualizar usuário:", err);
      return res.status(500).json({ error: "Erro ao atualizar usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário atualizado com sucesso." });
  });
});

router.delete("/usuarios/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM usuarios WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Erro ao excluir usuário:", err);
      return res.status(500).json({ error: "Erro ao excluir usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário excluído com sucesso." });
  });
});

// ======================================================
// ROTAS DO MÓDULO FLUVIAL — REQUISIÇÕES
// ======================================================

// Criar requisição
app.post("/api/requisicoes", (req, res) => {
  const {
    emissor_id,
    passageiro_nome,
    passageiro_cpf,
    passageiro_matricula,
    contato,
    solicitante_nome,
    tipo,
    tipo_passagem,
    tipo_viagem,
    setor_id,
    origem,
    destino,
    data_ida,
    data_volta,
    horario_embarque,
    embarcacao,
    embarcacao_volta,
    justificativa,
    observacoes,
    cidade_origem_volta,
    cidade_destino_volta,
  } = req.body || {};

  if (!emissor_id || !passageiro_nome || !origem || !destino || !data_ida) {
    return res.status(400).json({ error: "Campos obrigatórios faltando." });
  }

  if (
    tipo_viagem === "IDA_E_VOLTA" &&
    (!cidade_origem_volta || !cidade_destino_volta)
  ) {
    return res.status(400).json({
      error: "Para ida e volta, informe origem e destino da viagem de volta.",
    });
  }

  const ano = new Date().getFullYear();

  const embarcacaoIdaFinal =
    String(embarcacao || "").trim() || BARCO_PADRAO_PREFEITURA;

  const embarcacaoVoltaFinal =
    tipo_viagem === "IDA_E_VOLTA"
      ? String(embarcacao_volta || "").trim() || BARCO_PADRAO_PREFEITURA
      : null;

  const cfgValidade = extrairConfigValidade(observacoes);
  const validadeAteIda =
    cfgValidade.ativo && cfgValidade.aplica_em === "IDA"
      ? cfgValidade.validade_ate_ida || cfgValidade.data_fim || null
      : null;

  const validadeAteVolta =
    cfgValidade.ativo && cfgValidade.aplica_em === "VOLTA"
      ? cfgValidade.validade_ate_volta || cfgValidade.data_fim || null
      : null;

  gerarCodigoPublicoUnico((errCodigo, codigoPublico) => {
    if (errCodigo) {
      return res.status(500).json({ error: "Erro ao gerar código público." });
    }

    gerarNumeroRequisicaoUnico(ano, (errNum, numero_formatado) => {
      if (errNum) {
        return res
          .status(500)
          .json({ error: "Erro ao gerar número da requisição." });
      }

      const extrasFront = parseJsonSeguro(observacoes);

      const observacoesFinal = JSON.stringify({
        ...extrasFront,
        tipo_solicitante: tipo || null,
        barco_padrao_prefeitura: BARCO_PADRAO_PREFEITURA,
        validade_config: cfgValidade.ativo
          ? {
              ativo: true,
              aplica_em: cfgValidade.aplica_em || null,
              modo: "PERIODO",
              data_inicio: cfgValidade.data_inicio || null,
              data_fim: cfgValidade.data_fim || null,
              data_maxima:
                cfgValidade.data_maxima ||
                addDaysToDate(cfgValidade.data_inicio, cfgValidade.dias_limite),
              dias_limite:
                cfgValidade.dias_limite || LIMITE_DIAS_VALIDADE_PADRAO,
              validade_ate_ida: validadeAteIda,
              validade_ate_volta: validadeAteVolta,
              pode_ajuste_representante: true,
            }
          : {
              ativo: false,
              dias_limite: LIMITE_DIAS_VALIDADE_PADRAO,
              pode_ajuste_representante: true,
            },
        viagem_volta:
          tipo_viagem === "IDA_E_VOLTA"
            ? {
                data_saida: data_volta || null,
                origem: cidade_origem_volta || null,
                destino: cidade_destino_volta || null,
                embarcacao_volta: embarcacaoVoltaFinal,
                validade_ate: validadeAteVolta || null,
              }
            : null,
      });

      const sqlInsert = `
        INSERT INTO requisicoes (
          codigo_publico,
          numero_formatado,
          emissor_id,
          passageiro_nome,
          passageiro_cpf,
          passageiro_matricula,
          contato,
          solicitante_nome,
          tipo,
          tipo_passagem,
          tipo_viagem,
          setor_id,
          origem,
          destino,
          data_ida,
          data_volta,
          horario_embarque,
          embarcacao,
          embarcacao_volta,
          justificativa,
          status,
          qr_hash,
          observacoes,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', NULL, ?, NOW())
      `;

      const paramsInsert = [
        codigoPublico,
        numero_formatado,
        emissor_id,
        passageiro_nome,
        passageiro_cpf || null,
        passageiro_matricula || null,
        contato || null,
        solicitante_nome || null,
        tipo || null,
        tipo_passagem || null,
        tipo_viagem || "IDA",
        setor_id || null,
        origem,
        destino,
        data_ida,
        data_volta || null,
        horario_embarque || null,
        embarcacaoIdaFinal,
        embarcacaoVoltaFinal,
        justificativa || null,
        observacoesFinal || null,
      ];

      db.query(sqlInsert, paramsInsert, (errInsert, result) => {
        if (errInsert) {
          console.error("Erro ao criar requisição:", errInsert);
          return res.status(500).json({ error: "Erro ao criar requisição." });
        }

        const insertedId = result.insertId;

        const trechoIdaSql = `
          INSERT INTO requisicao_trechos (
            requisicao_id,
            tipo_trecho,
            origem,
            destino,
            data_viagem,
            embarcacao,
            validade_ate,
            status,
            created_at
          ) VALUES (?, 'IDA', ?, ?, ?, ?, ?, 'PENDENTE', NOW())
        `;

        db.query(
          trechoIdaSql,
          [
            insertedId,
            origem,
            destino,
            data_ida,
            embarcacaoIdaFinal,
            validadeAteIda || null,
          ],
          (errTrechoIda) => {
            if (errTrechoIda) {
              console.error("Erro ao criar trecho IDA:", errTrechoIda);
              return res.status(500).json({
                error: "Requisição criada, mas houve erro ao criar o trecho de ida.",
              });
            }

            const finalizarResposta = () => {
              const logSql = `
                INSERT INTO requisicao_status_log (
                  requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
                ) VALUES (?, NULL, 'PENDENTE', ?, 'Criação da requisição', NOW())
              `;
              db.query(logSql, [insertedId, emissor_id], () => {});

              res.status(201).json({
                id: insertedId,
                codigo_publico: codigoPublico,
                numero_formatado,
                status: "PENDENTE",
                embarcacao: embarcacaoIdaFinal,
              });
            };

            if (tipo_viagem === "IDA_E_VOLTA") {
              const trechoVoltaSql = `
                INSERT INTO requisicao_trechos (
                  requisicao_id,
                  tipo_trecho,
                  origem,
                  destino,
                  data_viagem,
                  embarcacao,
                  validade_ate,
                  status,
                  created_at
                ) VALUES (?, 'VOLTA', ?, ?, ?, ?, ?, 'PENDENTE', NOW())
              `;

              db.query(
                trechoVoltaSql,
                [
                  insertedId,
                  cidade_origem_volta,
                  cidade_destino_volta,
                  data_volta || null,
                  embarcacaoVoltaFinal,
                  validadeAteVolta || null,
                ],
                (errTrechoVolta) => {
                  if (errTrechoVolta) {
                    console.error("Erro ao criar trecho VOLTA:", errTrechoVolta);
                    return res.status(500).json({
                      error: "Requisição criada, mas houve erro ao criar o trecho de volta.",
                    });
                  }

                  finalizarResposta();
                }
              );
            } else {
              finalizarResposta();
            }
          }
        );
      });
    });
  });
});

// Listar por emissor - COM TRECHOS
app.get("/api/requisicoes/emissor/:emissorId", (req, res) => {
  const { emissorId } = req.params;

  const sql = `
    SELECT
      r.*,
      u.nome AS emissor_nome,
      u.cpf AS emissor_cpf,
      s.nome AS setor_nome,
      (
        SELECT us.nome
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_nome,
      (
        SELECT us.cpf
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_cpf
    FROM requisicoes r
    LEFT JOIN usuarios u ON u.id = r.emissor_id
    LEFT JOIN setores s ON s.id = r.setor_id
    WHERE r.emissor_id = ?
    ORDER BY r.created_at DESC
  `;

  db.query(sql, [emissorId], (err, rows) => {
    if (err) {
      console.error("Erro ao listar requisições do emissor:", err);
      return res
        .status(500)
        .json({ error: "Erro ao listar requisições do emissor." });
    }

    if (!rows.length) {
      return res.json([]);
    }

    const requisicoes = rows;
    const ids = requisicoes.map((r) => r.id);

    const sqlTrechos = `
      SELECT *
      FROM requisicao_trechos
      WHERE requisicao_id IN (?)
      ORDER BY
        requisicao_id ASC,
        CASE
          WHEN UPPER(tipo_trecho) = 'IDA' THEN 1
          WHEN UPPER(tipo_trecho) = 'VOLTA' THEN 2
          ELSE 99
        END,
        id ASC
    `;

    db.query(sqlTrechos, [ids], (errTrechos, trechos) => {
      if (errTrechos) {
        console.error("Erro ao buscar trechos das requisições:", errTrechos);
        return res.json(
          requisicoes.map((r) => ({
            ...r,
            trechos: [],
          }))
        );
      }

      const mapaTrechos = new Map();

      for (const t of trechos || []) {
        const chave = t.requisicao_id;
        if (!mapaTrechos.has(chave)) {
          mapaTrechos.set(chave, []);
        }
        mapaTrechos.get(chave).push(t);
      }

      const resultado = requisicoes.map((r) => ({
        ...r,
        trechos: mapaTrechos.get(r.id) || [],
      }));

      return res.json(resultado);
    });
  });
});

// Pendentes
app.get("/api/requisicoes/pendentes", (req, res) => {
  const sql = `
    SELECT *
    FROM requisicoes
    WHERE status = 'PENDENTE'
    ORDER BY created_at ASC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Erro ao listar pendentes:", err);
      return res.status(500).json({ error: "Erro ao listar pendentes." });
    }
    res.json(rows);
  });
});

// Assinar (aprovar/reprovar)
app.post("/api/requisicoes/:id/assinar", (req, res) => {
  const { id } = req.params;
  const {
    representante_id,
    acao,
    motivo_recusa,
    transportador_id,
    embarcacao,
  } = req.body;

  if (!representante_id || !acao) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const novoStatus = acao === "APROVAR" ? "APROVADA" : "REPROVADA";
  const novoStatusTrechos = mapStatusTrecho(novoStatus);

  const sqlAtual = `
    SELECT id, status
    FROM requisicoes
    WHERE id = ?
    LIMIT 1
  `;

  db.query(sqlAtual, [id], (errAtual, rowsAtual) => {
    if (errAtual) {
      console.error("Erro ao buscar status atual:", errAtual);
      return res.status(500).json({ error: "Erro ao buscar requisição." });
    }

    if (rowsAtual.length === 0) {
      return res.status(404).json({ error: "Requisição não encontrada." });
    }

    const statusAnterior = rowsAtual[0].status || null;

    const campos = ["status = ?", "updated_at = NOW()"];
    const params = [novoStatus];

    if (typeof transportador_id !== "undefined") {
      campos.push("transportador_id = ?");
      params.push(transportador_id || null);
    }

    if (typeof embarcacao !== "undefined") {
      campos.push("embarcacao = ?");
      params.push(embarcacao || null);
    }

    params.push(id);

    const updateSql = `
      UPDATE requisicoes
      SET ${campos.join(", ")}
      WHERE id = ?
    `;

    db.query(updateSql, params, (errUpdate) => {
      if (errUpdate) {
        console.error("Erro ao atualizar status:", errUpdate);
        return res.status(500).json({ error: "Erro ao atualizar status." });
      }

      const updateTrechosSql = `
        UPDATE requisicao_trechos
        SET status = ?, updated_at = NOW()
        WHERE requisicao_id = ?
      `;

      db.query(updateTrechosSql, [novoStatusTrechos, id], (errTrechos) => {
        if (errTrechos) {
          console.error("Erro ao atualizar trechos:", errTrechos);
          return res.status(500).json({ error: "Erro ao atualizar trechos." });
        }

        const insertAss = `
          INSERT INTO assinaturas_representante (
            requisicao_id, representante_id, acao, motivo_recusa, created_at
          ) VALUES (?, ?, ?, ?, NOW())
        `;
        db.query(
          insertAss,
          [id, representante_id, novoStatus, motivo_recusa || null],
          () => {}
        );

        const logSql = `
          INSERT INTO requisicao_status_log (
            requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
          ) VALUES (?, ?, ?, ?, 'Assinatura do representante', NOW())
        `;
        db.query(logSql, [id, statusAnterior, novoStatus, representante_id], () => {});

        res.json({ ok: true, status: novoStatus });
      });
    });
  });
});

// AJUSTAR VALIDADE - SOMENTE REPRESENTANTE / VALIDADOR
app.put("/api/requisicoes/:id/validade", (req, res) => {
  const { id } = req.params;
  const { representante_id, tipo_trecho, validade_ate } = req.body || {};

  if (!representante_id || !tipo_trecho) {
    return res.status(400).json({
      error: "representante_id e tipo_trecho são obrigatórios.",
    });
  }

  const trechoNormalizado = normalizarTipoTrecho(tipo_trecho);
  if (!trechoNormalizado) {
    return res.status(400).json({
      error: "tipo_trecho deve ser IDA ou VOLTA.",
    });
  }

  const sqlUsuario = `
    SELECT id, perfil, nome
    FROM usuarios
    WHERE id = ? AND ativo = 1
    LIMIT 1
  `;

  db.query(sqlUsuario, [representante_id], (errUser, rowsUser) => {
    if (errUser) {
      console.error("Erro ao validar representante:", errUser);
      return res.status(500).json({ error: "Erro ao validar usuário." });
    }

    if (rowsUser.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    const usuario = rowsUser[0];
    if ((usuario.perfil || "").toLowerCase() !== "representante") {
      return res.status(403).json({
        error: "Somente o validador/representante pode alterar a validade.",
      });
    }

    const sqlReq = `
      SELECT id, observacoes
      FROM requisicoes
      WHERE id = ?
      LIMIT 1
    `;

    db.query(sqlReq, [id], (errReq, rowsReq) => {
      if (errReq) {
        console.error("Erro ao buscar requisição:", errReq);
        return res.status(500).json({ error: "Erro ao buscar requisição." });
      }

      if (rowsReq.length === 0) {
        return res.status(404).json({ error: "Requisição não encontrada." });
      }

      const requisicao = rowsReq[0];

      const sqlTrecho = `
        SELECT id, tipo_trecho, data_viagem, validade_ate
        FROM requisicao_trechos
        WHERE requisicao_id = ? AND tipo_trecho = ?
        LIMIT 1
      `;

      db.query(sqlTrecho, [id, trechoNormalizado], (errTrecho, rowsTrecho) => {
        if (errTrecho) {
          console.error("Erro ao buscar trecho:", errTrecho);
          return res.status(500).json({ error: "Erro ao buscar trecho." });
        }

        if (rowsTrecho.length === 0) {
          return res.status(404).json({ error: "Trecho não encontrado." });
        }

        const trecho = rowsTrecho[0];

        const sqlAtualizaTrecho = `
          UPDATE requisicao_trechos
          SET validade_ate = ?, updated_at = NOW()
          WHERE id = ?
        `;

        db.query(
          sqlAtualizaTrecho,
          [validade_ate || null, trecho.id],
          (errUpdateTrecho) => {
            if (errUpdateTrecho) {
              console.error("Erro ao atualizar validade do trecho:", errUpdateTrecho);
              return res.status(500).json({
                error: "Erro ao atualizar validade do trecho.",
              });
            }

            const cfgAtual = extrairConfigValidade(requisicao.observacoes);

            let novoCfg = {
              ativo: true,
              aplica_em: trechoNormalizado,
              modo: "PERIODO",
              data_inicio: trecho.data_viagem || null,
              data_fim: validade_ate || null,
              data_maxima: cfgAtual.data_maxima || null,
              dias_limite:
                cfgAtual.dias_limite || LIMITE_DIAS_VALIDADE_PADRAO,
              validade_ate_ida:
                trechoNormalizado === "IDA"
                  ? validade_ate || null
                  : cfgAtual.validade_ate_ida || null,
              validade_ate_volta:
                trechoNormalizado === "VOLTA"
                  ? validade_ate || null
                  : cfgAtual.validade_ate_volta || null,
              pode_ajuste_representante: true,
              ajustado_por_representante: true,
              ajustado_em: new Date().toISOString(),
            };

            // se limpou validade e ambos ficarem nulos, pode marcar como inativo
            if (
              !novoCfg.validade_ate_ida &&
              !novoCfg.validade_ate_volta
            ) {
              novoCfg = {
                ...novoCfg,
                ativo: false,
                aplica_em: trechoNormalizado,
              };
            }

            const observacoesAtualizadas = montarObservacoesComValidade(
              requisicao.observacoes,
              novoCfg
            );

            const sqlUpdateReq = `
              UPDATE requisicoes
              SET observacoes = ?, updated_at = NOW()
              WHERE id = ?
            `;

            db.query(
              sqlUpdateReq,
              [observacoesAtualizadas, id],
              (errUpdateReq) => {
                if (errUpdateReq) {
                  console.error("Erro ao atualizar observações:", errUpdateReq);
                  return res.status(500).json({
                    error: "Erro ao atualizar observações da requisição.",
                  });
                }

                const logSql = `
                  INSERT INTO requisicao_status_log (
                    requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
                  ) VALUES (?, NULL, NULL, ?, ?, NOW())
                `;

                const obsLog = validade_ate
                  ? `Validade do trecho ${trechoNormalizado} ajustada para ${validade_ate}`
                  : `Validade do trecho ${trechoNormalizado} removida`;

                db.query(logSql, [id, representante_id, obsLog], () => {});

                return res.json({
                  ok: true,
                  requisicao_id: Number(id),
                  trecho_id: trecho.id,
                  tipo_trecho: trechoNormalizado,
                  validade_ate: validade_ate || null,
                });
              }
            );
          }
        );
      });
    });
  });
});

// Validar viagem (transportador)
app.post("/api/requisicoes/:id/validar", (req, res) => {
  const { id } = req.params;
  const {
    transportador_id,
    tipo_validacao,
    codigo_lido,
    local_validacao,
    observacao,
    trecho_id,
    tipo_trecho,
  } = req.body;

  if (!transportador_id || !codigo_lido) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const sqlTransportador = `
    SELECT id, nome, barco, perfil, ativo
    FROM usuarios
    WHERE id = ? AND ativo = 1
    LIMIT 1
  `;

  db.query(sqlTransportador, [transportador_id], (errTransp, rowsTransp) => {
    if (errTransp) {
      console.error("Erro ao buscar transportador:", errTransp);
      return res.status(500).json({ error: "Erro ao validar requisição." });
    }

    if (rowsTransp.length === 0) {
      return res.status(404).json({ error: "Transportador não encontrado." });
    }

    const transportador = rowsTransp[0];
    if ((transportador.perfil || "").toLowerCase() !== "transportador") {
      return res.status(403).json({ error: "Usuário não é transportador." });
    }

    const barcoDoTransportador = transportador.barco || null;

    if (!barcoDoTransportador) {
      return res.status(400).json({
        error: "Este transportador não possui barco cadastrado.",
      });
    }

    const sqlReq = `
      SELECT id, status
      FROM requisicoes
      WHERE id = ?
      LIMIT 1
    `;

    db.query(sqlReq, [id], (errReq, rowsReq) => {
      if (errReq) {
        console.error("Erro ao buscar requisição:", errReq);
        return res.status(500).json({ error: "Erro ao validar requisição." });
      }

      if (rowsReq.length === 0) {
        return res.status(404).json({ error: "Requisição não encontrada." });
      }

      const reqAtual = rowsReq[0];
      const statusAnteriorReq = reqAtual.status || null;

      let sqlTrecho = `
        SELECT *
        FROM requisicao_trechos
        WHERE requisicao_id = ?
          AND status = 'AUTORIZADA'
      `;
      const paramsTrecho = [id];

      if (trecho_id) {
        sqlTrecho += " AND id = ?";
        paramsTrecho.push(trecho_id);
      } else if (tipo_trecho) {
        sqlTrecho += " AND tipo_trecho = ?";
        paramsTrecho.push(String(tipo_trecho).toUpperCase());
      }

      sqlTrecho += " ORDER BY id ASC LIMIT 1";

      db.query(sqlTrecho, paramsTrecho, (errTrecho, rowsTrecho) => {
        if (errTrecho) {
          console.error("Erro ao buscar trecho:", errTrecho);
          return res.status(500).json({ error: "Erro ao validar requisição." });
        }

        if (rowsTrecho.length === 0) {
          return res.status(400).json({
            error: "Nenhum trecho autorizado disponível para validação.",
          });
        }

        const trecho = rowsTrecho[0];

        if (trecho.validade_ate) {
          const hoje = new Date();
          const hojeStr = hoje.toISOString().slice(0, 10);
          if (String(trecho.validade_ate).slice(0, 10) < hojeStr) {
            const sqlVencerTrecho = `
              UPDATE requisicao_trechos
              SET status = 'VENCIDA', updated_at = NOW()
              WHERE id = ?
            `;
            return db.query(sqlVencerTrecho, [trecho.id], () => {
              return res.status(400).json({
                error: "Este trecho está com prazo vencido para utilização.",
              });
            });
          }
        }

        const sqlInsertVal = `
          INSERT INTO validacoes_transportador (
            requisicao_id,
            transportador_id,
            tipo_validacao,
            codigo_lido,
            local_validacao,
            observacao,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;

        db.query(
          sqlInsertVal,
          [
            id,
            transportador_id,
            tipo_validacao || "EMBARQUE",
            codigo_lido,
            local_validacao || null,
            observacao || null,
          ],
          (errVal) => {
            if (errVal) {
              console.error("Erro ao validar:", errVal);
              return res.status(500).json({ error: "Erro ao validar requisição." });
            }

            const sqlUpdateTrecho = `
              UPDATE requisicao_trechos
              SET
                transportador_id = ?,
                embarcacao = ?,
                status = 'UTILIZADA',
                utilizado_em = NOW(),
                updated_at = NOW()
              WHERE id = ?
            `;

            db.query(
              sqlUpdateTrecho,
              [transportador_id, barcoDoTransportador, trecho.id],
              (errUpdateTrecho) => {
                if (errUpdateTrecho) {
                  console.error("Erro ao atualizar trecho:", errUpdateTrecho);
                  return res.status(500).json({
                    error: "Erro ao finalizar validação do trecho.",
                  });
                }

                const logSql = `
                  INSERT INTO requisicao_status_log (
                    requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
                  ) VALUES (?, ?, 'UTILIZADA', ?, ?, NOW())
                `;
                db.query(
                  logSql,
                  [
                    id,
                    statusAnteriorReq,
                    transportador_id,
                    `Validação pelo transportador no trecho ${trecho.tipo_trecho} com embarcação ${barcoDoTransportador}`,
                  ],
                  () => {}
                );

                const sqlVerificaTrechos = `
                  SELECT
                    SUM(CASE WHEN status IN ('AUTORIZADA', 'PENDENTE') THEN 1 ELSE 0 END) AS abertos,
                    SUM(CASE WHEN status = 'UTILIZADA' THEN 1 ELSE 0 END) AS utilizados
                  FROM requisicao_trechos
                  WHERE requisicao_id = ?
                `;

                db.query(sqlVerificaTrechos, [id], (errCheck, rowsCheck) => {
                  if (errCheck) {
                    console.error("Erro ao verificar trechos:", errCheck);
                    return res.json({
                      ok: true,
                      status: "UTILIZADA",
                      trecho_id: trecho.id,
                      tipo_trecho: trecho.tipo_trecho,
                      embarcacao: barcoDoTransportador,
                    });
                  }

                  const info = rowsCheck[0] || {};
                  const abertos = Number(info.abertos || 0);

                  if (abertos === 0) {
                    const sqlUpdateReq = `
                      UPDATE requisicoes
                      SET
                        status = 'UTILIZADA',
                        transportador_id = ?,
                        embarcacao = ?,
                        updated_at = NOW()
                      WHERE id = ?
                    `;
                    db.query(
                      sqlUpdateReq,
                      [transportador_id, barcoDoTransportador, id],
                      () => {
                        return res.json({
                          ok: true,
                          status: "UTILIZADA",
                          trecho_id: trecho.id,
                          tipo_trecho: trecho.tipo_trecho,
                          embarcacao: barcoDoTransportador,
                        });
                      }
                    );
                  } else {
                    const sqlUpdateReqParcial = `
                      UPDATE requisicoes
                      SET
                        transportador_id = ?,
                        embarcacao = ?,
                        updated_at = NOW()
                      WHERE id = ?
                    `;
                    db.query(
                      sqlUpdateReqParcial,
                      [transportador_id, barcoDoTransportador, id],
                      () => {
                        return res.json({
                          ok: true,
                          status: "UTILIZADA",
                          trecho_id: trecho.id,
                          tipo_trecho: trecho.tipo_trecho,
                          embarcacao: barcoDoTransportador,
                        });
                      }
                    );
                  }
                });
              }
            );
          }
        );
      });
    });
  });
});

// ======================================================
// ROTA DO CANHOTO / TRANSPORTADOR — Buscar por CÓDIGO PÚBLICO
// ======================================================
app.get("/api/requisicoes/codigo/:codigo", (req, res) => {
  const { codigo } = req.params;

  const sql = `
    SELECT
      r.*,
      u.nome AS emissor_nome,
      u.cpf  AS emissor_cpf,
      s.nome AS setor_nome,
      (
        SELECT us.nome
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_nome,
      (
        SELECT us.cpf
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_cpf
    FROM requisicoes r
    LEFT JOIN usuarios u ON u.id = r.emissor_id
    LEFT JOIN setores s ON s.id = r.setor_id
    WHERE r.codigo_publico = ?
    LIMIT 1
  `;

  db.query(sql, [codigo], (err, rows) => {
    if (err) {
      console.error("Erro ao buscar requisição por codigo_publico:", err);
      return res
        .status(500)
        .json({ error: "Erro ao buscar dados da requisição." });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "Requisição não encontrada." });
    }

    const requisicao = rows[0];

    db.query(
      `SELECT * FROM requisicao_trechos WHERE requisicao_id = ? ORDER BY id ASC`,
      [requisicao.id],
      (errTrechos, trechos) => {
        if (errTrechos) {
          console.error("Erro ao buscar trechos da requisição:", errTrechos);
          return res.json({ ...requisicao, trechos: [] });
        }

        res.json({
          ...requisicao,
          trechos: trechos || [],
        });
      }
    );
  });
});

// ======================================================
// ROTA DO CANHOTO — Buscar uma requisição específica (por ID)
// ======================================================
app.get("/api/requisicoes/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      r.*,
      u.nome AS emissor_nome,
      u.cpf AS emissor_cpf,
      s.nome AS setor_nome,
      (
        SELECT us.nome
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_nome,
      (
        SELECT us.cpf
        FROM requisicao_status_log l
        JOIN usuarios us ON us.id = l.usuario_id
        WHERE l.requisicao_id = r.id
          AND l.status_novo IN ('APROVADA','AUTORIZADA')
        ORDER BY l.created_at DESC
        LIMIT 1
      ) AS representante_cpf
    FROM requisicoes r
    LEFT JOIN usuarios u ON u.id = r.emissor_id
    LEFT JOIN setores s ON s.id = r.setor_id
    WHERE r.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, rows) => {
    if (err) {
      console.error("Erro ao buscar requisição por ID:", err);
      return res
        .status(500)
        .json({ error: "Erro ao buscar dados da requisição." });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "Requisição não encontrada." });
    }

    const requisicao = rows[0];

    db.query(
      `SELECT * FROM requisicao_trechos WHERE requisicao_id = ? ORDER BY id ASC`,
      [requisicao.id],
      (errTrechos, trechos) => {
        if (errTrechos) {
          console.error("Erro ao buscar trechos da requisição:", errTrechos);
          return res.json({ ...requisicao, trechos: [] });
        }

        res.json({
          ...requisicao,
          trechos: trechos || [],
        });
      }
    );
  });
});

// ======================================================
// LISTA GERAL
// ======================================================
app.get("/api/requisicoes", (req, res) => {
  const { data_ini, data_fim, status, codigo_publico } = req.query;

  let sql = "SELECT * FROM requisicoes WHERE 1=1";
  const params = [];

  if (codigo_publico) {
    sql += " AND codigo_publico = ?";
    params.push(codigo_publico);
  }

  if (data_ini) {
    sql += " AND data_ida >= ?";
    params.push(data_ini);
  }
  if (data_fim) {
    sql += " AND data_ida <= ?";
    params.push(data_fim);
  }
  if (status && status !== "TODOS") {
    sql += " AND status = ?";
    params.push(normalizarStatus(status));
  }

  sql += " ORDER BY created_at DESC";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Erro ao listar requisições:", err);
      return res.status(500).json({ error: "Erro ao listar requisições." });
    }
    res.json(rows);
  });
});

// ======================================================
// PLUGA AS ROTAS /api/usuarios
// ======================================================
app.use("/api", router);

// ======================================================
// SERVIDOR
// ======================================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API Prefeitura de Borba rodando na porta ${PORT}`);
});