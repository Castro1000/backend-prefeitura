// src/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// FUNÇÕES DE APOIO
// ======================================================

// Gera um código público de 10 caracteres (letras + números)
function gerarCodigoPublico() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let codigo = "";
  for (let i = 0; i < 10; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

// Garante que o codigo_publico seja único na tabela `requisicoes`
function gerarCodigoPublicoUnico(callback) {
  const codigo = gerarCodigoPublico();

  const sql = "SELECT id FROM requisicoes WHERE codigo_publico = ? LIMIT 1";
  db.query(sql, [codigo], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar codigo_publico:", err);
      return callback(err);
    }

    if (rows.length > 0) {
      // já existe, tenta de novo
      return gerarCodigoPublicoUnico(callback);
    }

    callback(null, codigo);
  });
}

// Gera numero_formatado único no formato NNNN.../ANO (4 a 6 dígitos)
function gerarNumeroRequisicaoUnico(ano, callback) {
  function tentarFaixa(min, max, proximaFaixa) {
    const numero = Math.floor(Math.random() * (max - min + 1)) + min;
    const numStr = `${numero}/${ano}`;

    const sql = "SELECT id FROM requisicoes WHERE numero_formatado = ? LIMIT 1";
    db.query(sql, [numStr], (err, rows) => {
      if (err) {
        console.error("Erro ao verificar numero_formatado:", err);
        return callback(err);
      }

      if (rows.length > 0) {
        // já existe → tenta novamente na mesma faixa / próxima
        return proximaFaixa();
      }

      // único → retornamos
      callback(null, numStr);
    });
  }

  // 1ª tentativa: 4 dígitos (1000–9999)
  function tentativa4() {
    tentarFaixa(1000, 9999, tentativa5);
  }

  // 2ª tentativa: 5 dígitos (10000–99999)
  function tentativa5() {
    tentarFaixa(10000, 99999, tentativa6);
  }

  // 3ª tentativa: 6 dígitos (100000–999999)
  function tentativa6() {
    tentarFaixa(100000, 999999, tentativa6); // continua tentando até achar um livre
  }

  tentativa4();
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
      tipo: (row.perfil || "").toLowerCase(), // emissor / representante / transportador / admin
      setor_id: row.setor_id,
      cpf: row.cpf || null,
      barco: row.barco || null,
    };

    res.json({
      user,
      token: "ok", // placeholder
    });
  });
});

// ======================================================
// ROTAS DE USUÁRIOS (CRUD)
// ======================================================
const router = express.Router();

/**
 * LISTAR usuários (suporta filtro perfil: /api/usuarios?perfil=transportador)
 */
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

/**
 * CRIAR novo usuário
 */
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

/**
 * ATUALIZAR usuário
 */
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

/**
 * REMOVER usuário
 */
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

// Criar requisição (numero_formatado aleatório tipo 4821/2025 ou 120493/2025)
app.post("/api/requisicoes", (req, res) => {
  const {
    emissor_id,
    passageiro_nome,
    passageiro_cpf,
    passageiro_matricula,
    setor_id,
    origem,
    destino,
    data_ida,
    data_volta,
    horario_embarque,
    justificativa,
    observacoes,
  } = req.body || {};

  if (!emissor_id || !passageiro_nome || !origem || !destino || !data_ida) {
    return res.status(400).json({ error: "Campos obrigatórios faltando." });
  }

  const ano = new Date().getFullYear();

  // 1) Gera código público único
  gerarCodigoPublicoUnico((errCodigo, codigoPublico) => {
    if (errCodigo) {
      return res.status(500).json({ error: "Erro ao gerar código público." });
    }

    // 2) Gera numero_formatado aleatório do tipo NNNN.../ANO
    gerarNumeroRequisicaoUnico(ano, (errNum, numero_formatado) => {
      if (errNum) {
        return res
          .status(500)
          .json({ error: "Erro ao gerar número da requisição." });
      }

      // 3) Insere a requisição
      const sqlInsert = `
        INSERT INTO requisicoes (
          codigo_publico,
          numero_formatado,
          emissor_id,
          passageiro_nome,
          passageiro_cpf,
          passageiro_matricula,
          setor_id,
          origem,
          destino,
          data_ida,
          data_volta,
          horario_embarque,
          justificativa,
          status,
          qr_hash,
          observacoes,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', NULL, ?, NOW())
      `;

      const paramsInsert = [
        codigoPublico,
        numero_formatado,
        emissor_id,
        passageiro_nome,
        passageiro_cpf || null,
        passageiro_matricula || null,
        setor_id || null,
        origem,
        destino,
        data_ida,
        data_volta || null,
        horario_embarque || null,
        justificativa || null,
        observacoes || null,
      ];

      db.query(sqlInsert, paramsInsert, (errInsert, result) => {
        if (errInsert) {
          console.error("Erro ao criar requisição:", errInsert);
          return res.status(500).json({ error: "Erro ao criar requisição." });
        }

        const insertedId = result.insertId;

        // 4) Log de status inicial
        const logSql = `
          INSERT INTO requisicao_status_log (
            requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
          ) VALUES (?, NULL, 'PENDENTE', ?, 'Criação da requisição', NOW())
        `;
        db.query(logSql, [insertedId, emissor_id], () => {});

        // 5) Resposta
        res.status(201).json({
          id: insertedId,
          codigo_publico: codigoPublico,
          numero_formatado, // ex.: "4821/2025" ou "120493/2025"
          status: "PENDENTE",
        });
      });
    });
  });
});

// Listar por emissor
app.get("/api/requisicoes/emissor/:emissorId", (req, res) => {
  const { emissorId } = req.params;

  const sql = `
    SELECT *
    FROM requisicoes
    WHERE emissor_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [emissorId], (err, rows) => {
    if (err) {
      console.error("Erro ao listar requisições:", err);
      return res.status(500).json({ error: "Erro ao listar requisições." });
    }
    res.json(rows);
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
  const { representante_id, acao, motivo_recusa } = req.body;

  if (!representante_id || !acao) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const novoStatus = acao === "APROVAR" ? "APROVADA" : "REPROVADA";

  const updateSql = `
    UPDATE requisicoes
    SET status = ?, updated_at = NOW()
    WHERE id = ?
  `;

  db.query(updateSql, [novoStatus, id], (err) => {
    if (err) {
      console.error("Erro ao atualizar status:", err);
      return res.status(500).json({ error: "Erro ao atualizar status." });
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
      ) VALUES (?, 'PENDENTE', ?, ?, 'Assinatura do representante', NOW())
    `;
    db.query(logSql, [id, novoStatus, representante_id], () => {});

    res.json({ ok: true, status: novoStatus });
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
  } = req.body;

  if (!transportador_id || !codigo_lido) {
    return res.status(400).json({ error: "Dados incompletos." });
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
    (err) => {
      if (err) {
        console.error("Erro ao validar:", err);
        return res.status(500).json({ error: "Erro ao validar requisição." });
      }

      const updateStatus = `
        UPDATE requisicoes
        SET status = 'UTILIZADA', updated_at = NOW()
        WHERE id = ?
      `;
      db.query(updateStatus, [id], () => {});

      const logSql = `
        INSERT INTO requisicao_status_log (
          requisicao_id, status_anterior, status_novo, usuario_id, observacao, created_at
        ) VALUES (?, 'APROVADA', 'UTILIZADA', ?, 'Validação pelo transportador', NOW())
      `;
      db.query(logSql, [id, transportador_id], () => {});

      res.json({ ok: true, status: "UTILIZADA" });
    }
  );
});

// ======================================================
// >>>>>>> ROTA DO CANHOTO — Buscar uma requisição específica
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

    res.json(rows[0]);
  });
});

// ======================================================
// LISTA GERAL
// ======================================================
app.get("/api/requisicoes", (req, res) => {
  const { data_ini, data_fim, status } = req.query;

  let sql = "SELECT * FROM requisicoes WHERE 1=1";
  const params = [];

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
    params.push(status);
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
