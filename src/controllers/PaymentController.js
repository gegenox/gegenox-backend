const db = require("../config/database");
const nodemailer = require("nodemailer");
const axios = require("axios");
const primepagConfig = require("../config/primepag");

// Configuração do transportador de email
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true, // true para 465, false para outras portas
  auth: {
    user: "entrega@ggnoxofc.com",
    pass: "Geniuscacetada123@",
  },
  debug: true, // Ativa logs detalhados
  logger: true, // Mostra logs do SMTP
});

// Testar a conexão ao inicializar
transporter.verify((error, success) => {
  if (error) {
    console.error("Erro na configuração do email:", error);
  } else {
    console.log("Servidor de email pronto!");
  }
});

class PaymentController {
  constructor() {
    // Verificar a cada 1 minuto
    setInterval(this.checkExpiredPayments.bind(this), 60000);
  }

  async checkExpiredPayments() {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Buscar pagamentos pendentes que expiraram
      const [expiredPayments] = await connection.query(
        `SELECT p.id, p.external_id 
         FROM payments p
         WHERE p.status = 'pending' 
         AND p.created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         AND EXISTS (
           SELECT 1 
           FROM stock_items si 
           WHERE si.payment_id = p.id 
           AND si.status = 'RESERVED'
         )`
      );

      console.log(
        `Encontrados ${expiredPayments.length} pagamentos expirados com itens reservados`
      );

      for (const payment of expiredPayments) {
        console.log(`Processando pagamento expirado ID: ${payment.id}`);

        // Liberar itens reservados
        const [updateResult] = await connection.query(
          `UPDATE stock_items 
           SET status = 'AVAILABLE', 
               payment_id = NULL 
           WHERE payment_id = ? 
           AND status = 'RESERVED'`,
          [payment.id]
        );

        console.log(`Itens liberados: ${updateResult.affectedRows}`);

        // Marcar pagamento como falho
        await connection.query(
          `UPDATE payments 
           SET status = 'failed', 
               completed_at = NOW() 
           WHERE id = ?`,
          [payment.id]
        );
      }

      await connection.commit();
      console.log("Verificação de pagamentos expirados concluída");
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao verificar pagamentos expirados:", error);
    } finally {
      connection.release();
    }
  }

  async createPayment(req, res) {
    const connection = await db.getConnection();
    try {
      const { amount, items, email, customer, cupom } = req.body;
      console.log("Dados recebidos para criação de pagamento:", {
        amount,
        email,
        customer,
        cupom,
        items: items.length,
      });

      const paymentData = {
        amount: parseFloat(amount),
        external_id: `PAY-${Date.now()}`,
        payer: {
          name: customer.name,
          document: customer.document.replace(/\D/g, ""),
          email: email,
        },
        payerQuestion: "Pagamento GGNOX",
        expiresIn: 300,
      };

      try {
        // Buscar informações do cupom se foi usado
        let cupomData = null;
        if (cupom) {
          const [cupomResult] = await connection.query(
            'SELECT * FROM coupons WHERE code = ? AND status = "ATIVO"',
            [cupom.toUpperCase()]
          );

          if (cupomResult.length > 0) {
            cupomData = cupomResult[0];
          }
        }

        // Criar pagamento usando PrimePag
        const response = await primepagConfig.createPayment(paymentData);

        if (!response.qr_code || !response.qr_code.text) {
          throw new Error("QR Code não retornado");
        }

        // Inserir na base de dados
        const [result] = await connection.query(
          `INSERT INTO payments (
            external_id, 
            amount, 
            status, 
            pix_code,
            transaction_id,
            customer_email,
            customer_name,
            customer_document,
            cupom_code,
            cupom_discount,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
          [
            paymentData.external_id,
            amount,
            "pending",
            response.qr_code.text,
            response.payment_id, // Ajustado para usar payment_id da PrimePag
            email,
            customer.name,
            customer.document,
            cupomData ? cupomData.code : null,
            cupomData ? cupomData.discount : null,
          ]
        );

        // Adicionar log para debug
        console.log("Pagamento criado:", {
          payment_id: result.insertId,
          cupom: cupomData
            ? {
                code: cupomData.code,
                discount: cupomData.discount,
              }
            : null,
        });

        // Reservar itens do estoque
        for (const item of items) {
          const quantity = item.quantity || 1; // Garante que tenha quantidade

          // Atualizar a quantidade correta de itens
          await connection.query(
            `UPDATE stock_items 
             SET payment_id = ?, 
                 status = 'RESERVED'
             WHERE product_id = ?
             AND status = 'AVAILABLE'
             LIMIT ?`, // Usar LIMIT com a quantidade
            [result.insertId, item.id, quantity]
          );
        }

        // Salvar informações do cupom
        if (cupomData) {
          await connection.query(
            "UPDATE payments SET cupom_code = ?, cupom_discount = ? WHERE id = ?",
            [cupomData.code, cupomData.discount, result.insertId]
          );

          // Incrementar uso do cupom
          await connection.query(
            "UPDATE coupons SET times_used = times_used + 1 WHERE code = ?",
            [cupomData.code]
          );
        }

        await connection.commit();

        res.json({
          payment_id: result.insertId,
          qrcode_text: response.qr_code.text, // Texto do PIX para copiar e colar
          qrcode_base64: response.qr_code.image, // Imagem base64 do QR code
          transaction_id: response.payment_id,
          external_id: paymentData.external_id,
          expires_in: 300,
          amount: amount,
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      console.error("Erro ao criar pagamento:", error);
      if (!res.headersSent) {
        res.status(500).json({
          message: "Erro ao processar pagamento",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    } finally {
      connection.release();
    }
  }

  async handleWebhook(req, res) {
    // Primeiro respondemos 200 para a PrimePag imediatamente
    res.status(200).end();

    try {
      console.log("Iniciando handleWebhook da PrimePag:", {
        body: req.body,
        headers: req.headers,
        path: req.path,
      });

      const webhookData = await primepagConfig.processWebhook(req.body);
      console.log("Webhook processado:", webhookData);

      if (!webhookData || !webhookData.payment_id) {
        console.error("Webhook inválido - dados faltando:", webhookData);
        return; // Retornamos early pois já enviamos 200
      }

      // Verificar se é um pagamento confirmado
      if (webhookData.status !== "paid") {
        console.log("Status não processável:", webhookData.status);
        return; // Retornamos early pois já enviamos 200
      }

      console.log(
        "Buscando pagamento com external_id:",
        webhookData.external_id
      );

      // Buscar pagamento com informações do cupom
      const [payments] = await db.query(
        `SELECT 
          p.*,
          p.cupom_code,
          p.cupom_discount
        FROM payments p 
        WHERE p.external_id = ?`,
        [webhookData.external_id]
      );

      console.log("Pagamentos encontrados:", payments);

      const payment = payments[0];
      if (!payment) {
        console.error("Pagamento não encontrado:", webhookData.external_id);
        return; // Retornamos early pois já enviamos 200
      }

      console.log("Atualizando status do pagamento ID:", payment.id);

      // Atualizar status do pagamento para completed
      const [updatePaymentResult] = await db.query(
        `UPDATE payments 
         SET status = 'completed', 
             completed_at = NOW() 
         WHERE id = ? 
         AND status = 'pending'`,
        [payment.id]
      );

      console.log("Resultado update pagamento:", updatePaymentResult);

      // Atualizar status dos itens para SOLD
      const [updateItemsResult] = await db.query(
        `UPDATE stock_items 
         SET status = 'SOLD',
             sold_at = NOW() 
         WHERE payment_id = ? 
         AND status = 'RESERVED'`,
        [payment.id]
      );

      console.log("Resultado update itens:", updateItemsResult);

      // Buscar produtos vendidos para o webhook do Discord
      const [soldProducts] = await db.query(
        `
        SELECT p.name, COUNT(*) as quantity
        FROM stock_items si 
        JOIN products p ON si.product_id = p.id 
        WHERE si.payment_id = ? AND si.status = 'SOLD'
        GROUP BY p.id, p.name
      `,
        [payment.id]
      );

      // Preparar o embed para o Discord
      const embed = {
        title: "💰 Nova Venda Realizada!",
        color: 0x199a66,
        fields: [
          {
            name: "👤 Cliente",
            value: payment.customer_email || "Não informado",
            inline: true,
          },
          {
            name: "💵 Valor Final",
            value: `R$ ${webhookData.amount.toFixed(2)}`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      // Adicionar informações do cupom se existir
      if (payment.cupom_code && payment.cupom_discount) {
        const originalValue =
          webhookData.amount / (1 - payment.cupom_discount / 100);
        const discountValue = originalValue - webhookData.amount;

        embed.fields.push(
          {
            name: "🏷️ Cupom Utilizado",
            value: `\`${payment.cupom_code}\``,
            inline: true,
          },
          {
            name: "💹 Desconto Aplicado",
            value: `${payment.cupom_discount}% (-R$ ${discountValue.toFixed(
              2
            )})`,
            inline: true,
          },
          {
            name: "💰 Valor Original",
            value: `R$ ${originalValue.toFixed(2)}`,
            inline: true,
          }
        );
      } else {
        embed.fields.push({
          name: "🏷️ Cupom",
          value: "Nenhum cupom utilizado",
          inline: true,
        });
      }

      // Adicionar produtos vendidos
      embed.fields.push({
        name: "📦 Produtos",
        value: soldProducts.map((p) => `${p.quantity}x ${p.name}`).join("\n"),
        inline: false,
      });

      // Enviar webhook para o Discord (apenas uma vez)
      const [webhooks] = await db.query(
        "SELECT url FROM discord_webhooks WHERE active = 1 LIMIT 1"
      );
      if (webhooks[0]) {
        try {
          await axios.post(webhooks[0].url, { embeds: [embed] });
        } catch (error) {
          console.error(`Erro ao enviar webhook do Discord:`, error);
        }
      }

      // Buscar códigos para enviar por email
      const [items] = await db.query(
        `
        SELECT si.code 
        FROM stock_items si
        WHERE si.payment_id = ? 
        AND si.status = 'SOLD'
      `,
        [payment.id]
      );

      // Enviar email com os códigos
      if (items.length > 0) {
        const emailHtml = `
          <h2>Sua compra foi confirmada!</h2>
          <p>Olá ${payment.customer_name},</p>
          <p>Aqui estão seus códigos:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
            ${items
              .map(
                (item) =>
                  `<div style="font-family: monospace; margin: 5px 0;">${item.code}</div>`
              )
              .join("")}
          </div>
          <p>Obrigado pela compra!</p>
        `;

        await transporter.sendMail({
          from: '"SeuRobux" <entrega@seurobux.com>',
          to: payment.customer_email,
          subject: "Sua compra foi confirmada!",
          html: emailHtml,
        });
      }

      console.log("Webhook processado com sucesso");
    } catch (error) {
      console.error("Erro no webhook:", error);
      // Não precisamos retornar nada pois já respondemos 200
    }
  }

  async getPaymentStatus(req, res) {
    try {
      const { payment_id } = req.params;

      const [payment] = await db.query("SELECT * FROM payments WHERE id = ?", [
        payment_id,
      ]);

      if (!payment[0]) {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }

      if (payment[0].status === "completed") {
        const [items] = await db.query(
          `SELECT si.code 
           FROM stock_items si
           WHERE si.payment_id = ? AND si.status = 'SOLD'`,
          [payment_id]
        );

        return res.json({
          status: "completed",
          items: items.map((item) => item.code),
        });
      }

      try {
        // Usando PrimePag para verificar status
        const status = await primepagConfig.getPaymentStatus(
          payment[0].transaction_id
        );

        if (status.status === "paid") {
          await db.query(
            `UPDATE payments 
               SET status = 'completed',
                   completed_at = NOW()
               WHERE id = ? AND status = 'pending'`,
            [payment_id]
          );

          await db.query(
            `UPDATE stock_items 
               SET status = 'SOLD',
                   sold_at = NOW()
             WHERE payment_id = ? AND status = 'RESERVED'`,
            [payment_id]
          );

          return res.json({
            status: "completed",
            message: "Pagamento confirmado",
          });
        }

        return res.json({
          status: "pending",
          message: "Aguardando pagamento",
        });
      } catch (error) {
        console.error("Erro ao verificar status:", error);
        return res.json({
          status: payment[0].status,
          message: "Aguardando confirmação",
        });
      }
    } catch (error) {
      console.error("Erro ao buscar status:", error);
      res.status(500).json({ message: "Erro interno" });
    }
  }

  async getPaymentStatusByExternalId(req, res) {
    try {
      const { external_id } = req.params;

      const [[payment]] = await db.query(
        `SELECT 
          p.*,
          GROUP_CONCAT(si.code) as codes,
          GROUP_CONCAT(pr.name) as product_names
         FROM payments p
         LEFT JOIN stock_items si ON p.id = si.payment_id
         LEFT JOIN products pr ON pr.id = si.product_id
         WHERE p.external_id = ?
         GROUP BY p.id`,
        [external_id]
      );

      if (!payment) {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }

      return res.json({
        status: payment.status,
        items: payment.codes ? payment.codes.split(",") : [],
        products: payment.product_names ? payment.product_names.split(",") : [],
        paid_at: payment.completed_at,
        message:
          payment.status === "completed"
            ? "Pagamento confirmado"
            : "Aguardando pagamento",
      });
    } catch (error) {
      console.error("Erro ao buscar status:", error);
      res.status(500).json({ message: "Erro interno" });
    }
  }

  async getSoldItems(req, res) {
    try {
      const { external_id } = req.params;

      // Busca os códigos dos itens vendidos
      const [items] = await db.query(
        `SELECT s.code
         FROM stock_items s
         INNER JOIN payments p ON p.id = s.payment_id
         WHERE p.external_id = ?
         AND s.status = 'SOLD'`,
        [external_id]
      );

      // Retorna array de códigos
      return res.json(items.map((item) => item.code));
    } catch (error) {
      console.error("Erro ao buscar itens vendidos:", error);
      res.status(500).json({ message: "Erro interno" });
    }
  }

  async getSales(req, res) {
    try {
      const {
        startDate,
        endDate,
        status,
        search,
        page = 1,
        limit = 25,
      } = req.query;

      let query = `
        SELECT 
          p.*,
          GROUP_CONCAT(DISTINCT pr.name) as product_names
        FROM payments p
        LEFT JOIN stock_items si ON si.payment_id = p.id
        LEFT JOIN products pr ON pr.id = si.product_id
      `;

      const conditions = [];
      const params = [];

      if (startDate) {
        conditions.push("p.created_at >= ?");
        params.push(startDate);
      }

      if (endDate) {
        conditions.push("p.created_at <= ?");
        params.push(endDate);
      }

      if (status) {
        conditions.push("p.status = ?");
        params.push(status);
      }

      if (search) {
        conditions.push(
          "(p.customer_email LIKE ? OR p.customer_name LIKE ? OR pr.name LIKE ?)"
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (conditions.length) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " GROUP BY p.id ORDER BY p.created_at DESC";

      // Contar total antes da paginação
      const [countResult] = await db.query(
        `SELECT COUNT(*) as total FROM (${query}) as subquery`,
        params
      );
      const total = countResult[0].total;

      // Adicionar paginação
      query += " LIMIT ? OFFSET ?";
      params.push(Number(limit), (page - 1) * Number(limit));

      const [sales] = await db.query(query, params);

      res.json({
        sales: sales.map((sale) => ({
          ...sale,
          product_names: sale.product_names
            ? sale.product_names.split(",")
            : [],
        })),
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: Number(page),
          limit: Number(limit),
        },
      });
    } catch (error) {
      console.error("Erro ao buscar vendas:", error);
      res.status(500).json({ error: "Erro ao buscar vendas" });
    }
  }

  // Adicionar método para estatísticas do dashboard
  async getDashboardStats(req, res) {
    const connection = await db.getConnection();
    try {
      const stats = {
        today: { total: 0, count: 0 },
        week: { total: 0, count: 0 },
        month: { total: 0, count: 0 },
        allTime: { total: 0, count: 0 },
        topProducts: [],
        recentSales: [],
        chartData: [],
      };

      // Estatísticas gerais
      const [generalStats] = await connection.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN DATE(completed_at) = CURDATE() THEN amount ELSE 0 END), 0) as today_total,
          COUNT(CASE WHEN DATE(completed_at) = CURDATE() THEN 1 END) as today_count,
          COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN amount ELSE 0 END), 0) as week_total,
          COUNT(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as week_count,
          COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END), 0) as month_total,
          COUNT(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as month_count,
          COALESCE(SUM(amount), 0) as all_time_total,
          COUNT(*) as all_time_count
        FROM payments
        WHERE status = 'completed'
      `);

      // Converter valores para números
      stats.today = {
        total: Number(generalStats[0].today_total || 0),
        count: Number(generalStats[0].today_count || 0),
      };
      stats.week = {
        total: Number(generalStats[0].week_total || 0),
        count: Number(generalStats[0].week_count || 0),
      };
      stats.month = {
        total: Number(generalStats[0].month_total || 0),
        count: Number(generalStats[0].month_count || 0),
      };
      stats.allTime = {
        total: Number(generalStats[0].all_time_total || 0),
        count: Number(generalStats[0].all_time_count || 0),
      };

      // Top 10 produtos
      const [topProducts] = await connection.query(`
        SELECT 
          p.name,
          COUNT(*) as sales_count,
          COALESCE(SUM(pay.amount), 0) as total_amount
        FROM stock_items si
        JOIN products p ON p.id = si.product_id
        JOIN payments pay ON pay.id = si.payment_id
        WHERE si.status = 'SOLD'
        AND pay.status = 'completed'
        GROUP BY p.id
        ORDER BY sales_count DESC
        LIMIT 10
      `);

      // Converter valores para números
      stats.topProducts = topProducts.map((product) => ({
        ...product,
        sales_count: Number(product.sales_count),
        total_amount: Number(product.total_amount),
      }));

      // Últimas 10 vendas
      const [recentSales] = await connection.query(`
        SELECT 
          p.*,
          GROUP_CONCAT(DISTINCT pr.name) as product_names,
          GROUP_CONCAT(si.code) as items
        FROM payments p
        LEFT JOIN stock_items si ON si.payment_id = p.id
        LEFT JOIN products pr ON pr.id = si.product_id
        WHERE p.status = 'completed'
        AND p.completed_at IS NOT NULL
        GROUP BY p.id, p.completed_at
        ORDER BY p.completed_at DESC, p.id DESC
        LIMIT 10
      `);

      // Formatar vendas recentes
      stats.recentSales = recentSales.map((sale) => ({
        ...sale,
        amount: Number(sale.amount),
        items: sale.items ? sale.items.split(",") : [],
        product_names: sale.product_names ? sale.product_names.split(",") : [],
        completed_at: sale.completed_at,
      }));

      // Ordenar novamente para garantir a ordem mais recente primeiro
      stats.recentSales.sort((a, b) => {
        const dateA = new Date(a.completed_at);
        const dateB = new Date(b.completed_at);
        return dateB - dateA;
      });

      // Dados do gráfico (últimos 7 dias)
      const [chartData] = await connection.query(`
        WITH RECURSIVE dates AS (
          SELECT CONVERT_TZ(NOW(), '+00:00', '-03:00') as date
          UNION ALL
          SELECT DATE_SUB(date, INTERVAL 1 DAY)
          FROM dates
          WHERE DATE_SUB(date, INTERVAL 1 DAY) >= DATE_SUB(CONVERT_TZ(NOW(), '+00:00', '-03:00'), INTERVAL 6 DAY)
        )
        SELECT 
          dates.date,
          COALESCE(SUM(p.amount), 0) as total_amount,
          COUNT(p.id) as sales_count
        FROM dates
        LEFT JOIN payments p ON DATE(CONVERT_TZ(p.completed_at, '+00:00', '-03:00')) = DATE(dates.date)
          AND p.status = 'completed'
        GROUP BY dates.date
        ORDER BY dates.date ASC
      `);

      // Formatar dados do gráfico
      stats.chartData = chartData.map((data) => ({
        date: data.date,
        total_amount: Number(data.total_amount),
        sales_count: Number(data.sales_count),
      }));

      res.json({
        today: stats.today,
        week: stats.week,
        month: stats.month,
        allTime: stats.allTime,
        chartData: stats.chartData.reverse(), // Reverter para ordem cronológica
        topProducts: stats.topProducts,
        recentSales: stats.recentSales,
      });
    } catch (error) {
      console.error("Erro ao buscar estatísticas:", error);
      res.status(500).json({ message: "Erro interno" });
    } finally {
      connection.release();
    }
  }

  async checkPaymentStatus(payment_id) {
    try {
      const [payment] = await db.query("SELECT * FROM payments WHERE id = ?", [
        payment_id,
      ]);
      if (!payment || payment.length === 0) return null;

      const paymentData = payment[0];

      // Se já estiver completo, retornar os itens vendidos
      if (paymentData.status === "completed") {
        const [items] = await db.query(
          `
          SELECT si.code 
          FROM stock_items si
          WHERE si.payment_id = ?
        `,
          [payment_id]
        );

        return {
          status: "completed",
          items: items.map((item) => item.code),
        };
      }

      // ... resto do código de verificação
    } catch (error) {
      console.error("Erro ao verificar status:", error);
      return null;
    }
  }

  static async sendDiscordWebhook(payment, items, cupom = null) {
    try {
      const [webhooks] = await db.query(
        "SELECT url FROM discord_webhooks WHERE active = 1"
      );

      if (!webhooks.length) return;

      // Calcular valor original e desconto se houver cupom
      const originalValue = payment.amount;
      const discountValue = cupom ? (originalValue * cupom.discount) / 100 : 0;

      const embed = {
        title: "💰 Nova Venda Realizada!",
        color: 0x199a66,
        fields: [
          {
            name: "👤 Cliente",
            value: payment.customer_email || "Não informado",
            inline: true,
          },
          {
            name: "💵 Valor Final",
            value: `R$ ${Number(payment.amount).toFixed(2)}`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      // Adicionar informações do cupom se foi utilizado
      if (cupom) {
        embed.fields.push(
          {
            name: "🏷️ Cupom Utilizado",
            value: `\`${cupom.code}\``,
            inline: true,
          },
          {
            name: "💹 Desconto Aplicado",
            value: `${cupom.discount}% (-R$ ${discountValue.toFixed(2)})`,
            inline: true,
          },
          {
            name: "💰 Valor Original",
            value: `R$ ${Number(originalValue).toFixed(2)}`,
            inline: true,
          }
        );
      } else {
        embed.fields.push({
          name: "🏷️ Cupom",
          value: "Nenhum cupom utilizado",
          inline: true,
        });
      }

      // Adicionar produtos sempre por último
      embed.fields.push({
        name: "📦 Produtos",
        value: items.map((item) => `• ${item.name}`).join("\n"),
        inline: false,
      });

      const webhookData = {
        embeds: [embed],
      };

      // Enviar para todos os webhooks ativos
      const promises = webhooks.map((webhook) =>
        axios
          .post(webhook.url, webhookData)
          .catch((error) =>
            console.error(`Erro ao enviar webhook para ${webhook.url}:`, error)
          )
      );

      await Promise.all(promises);
    } catch (error) {
      console.error("Erro ao enviar webhook:", error);
    }
  }

  async getDashboardData(req, res) {
    try {
      const { period } = req.query;

      // Ajustando para usar o fuso horário de São Paulo
      const now = `CONVERT_TZ(NOW(), '+00:00', '-03:00')`;

      let startDate, endDate;
      switch (period) {
        case "today":
          startDate = `DATE(${now})`;
          endDate = `DATE(${now} + INTERVAL 1 DAY)`;
          break;
        case "yesterday":
          startDate = `DATE(${now} - INTERVAL 1 DAY)`;
          endDate = `DATE(${now})`;
          break;
        case "week":
          startDate = `DATE(${now} - INTERVAL 7 DAY)`;
          endDate = `DATE(${now} + INTERVAL 1 DAY)`;
          break;
        case "month":
          startDate = `DATE(${now} - INTERVAL 30 DAY)`;
          endDate = `DATE(${now} + INTERVAL 1 DAY)`;
          break;
        default:
          startDate = `DATE(${now})`;
          endDate = `DATE(${now} + INTERVAL 1 DAY)`;
      }

      // Dados das categorias
      const [categoryStats] = await db.query(`
        SELECT 
          c.id,
          c.name as category_name,
          COUNT(DISTINCT CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') >= ${startDate}
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') < ${endDate}
            THEN si.id 
            ELSE NULL 
          END) as total_sales,
          COALESCE(SUM(CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') >= ${startDate}
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') < ${endDate}
            THEN p.amount 
            ELSE 0 
          END), 0) as total_amount
        FROM categories c
        LEFT JOIN products pr ON pr.category_id = c.id
        LEFT JOIN stock_items si ON si.product_id = pr.id
        LEFT JOIN payments p ON p.id = si.payment_id
        GROUP BY c.id
      `);

      // Dados para o gráfico de pizza
      const [pieChartData] = await db.query(`
        SELECT 
          c.name as name,
          COUNT(DISTINCT CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') >= ${startDate}
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') < ${endDate}
            THEN si.id 
            ELSE NULL 
          END) as value,
          COALESCE(SUM(CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') >= ${startDate}
            AND CONVERT_TZ(p.completed_at, '+00:00', '-03:00') < ${endDate}
            THEN p.amount 
            ELSE 0 
          END), 0) as amount
        FROM categories c
        LEFT JOIN products pr ON pr.category_id = c.id
        LEFT JOIN stock_items si ON si.product_id = pr.id
        LEFT JOIN payments p ON p.id = si.payment_id
        GROUP BY c.id
        HAVING value > 0
      `);

      // Dados para o gráfico de linhas (últimos 7 dias com preenchimento)
      const [weeklyStats] = await db.query(`
        WITH RECURSIVE dates AS (
          SELECT 
            DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00')) - INTERVAL 6 DAY as date
          UNION ALL
          SELECT date + INTERVAL 1 DAY
          FROM dates
          WHERE date < DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00'))
        )
        SELECT 
          DATE_FORMAT(dates.date, '%d/%m') as date,
          COUNT(DISTINCT CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            THEN si.id 
            ELSE NULL 
          END) as count,
          COALESCE(SUM(CASE 
            WHEN p.status = 'completed' AND si.status = 'SOLD' 
            THEN p.amount 
            ELSE 0 
          END), 0) as total
        FROM dates
        LEFT JOIN payments p ON 
          DATE(CONVERT_TZ(p.completed_at, '+00:00', '-03:00')) = dates.date
        LEFT JOIN stock_items si ON si.payment_id = p.id
        GROUP BY dates.date
        ORDER BY dates.date ASC
      `);

      // Últimas 10 vendas
      const [recentSales] = await db.query(`
        SELECT 
          p.*,
          GROUP_CONCAT(pr.name) as product_names,
          p.customer_email,
          p.amount,
          p.completed_at
        FROM payments p
        JOIN stock_items si ON si.payment_id = p.id
        JOIN products pr ON pr.id = si.product_id
        WHERE p.status = 'completed'
        GROUP BY p.id
        ORDER BY p.completed_at DESC
        LIMIT 10
      `);

      // Produtos mais vendidos
      const [topProducts] = await db.query(`
        SELECT 
          p.id,
          p.name,
          COUNT(DISTINCT si.id) as total_sales,
          COALESCE(SUM(pay.amount), 0) as total_amount
        FROM products p
        JOIN stock_items si ON si.product_id = p.id
        JOIN payments pay ON pay.id = si.payment_id
        WHERE pay.status = 'completed' 
          AND si.status = 'SOLD'
          AND CONVERT_TZ(pay.completed_at, '+00:00', '-03:00') >= ${startDate}
          AND CONVERT_TZ(pay.completed_at, '+00:00', '-03:00') < ${endDate}
        GROUP BY p.id
        ORDER BY total_sales DESC
        LIMIT 10
      `);

      res.json({
        categoryStats: categoryStats.map((stat) => ({
          ...stat,
          name: stat.category_name,
          total_amount: Number(stat.total_amount),
          total_sales: Number(stat.total_sales),
        })),
        pieChartData: pieChartData.map((item) => ({
          ...item,
          value: Number(item.value),
          amount: Number(item.amount),
        })),
        weeklyStats: weeklyStats.map((stat) => ({
          ...stat,
          count: Number(stat.count),
          total: Number(stat.total),
        })),
        recentSales: recentSales.map((sale) => ({
          ...sale,
          product_names: sale.product_names.split(","),
          amount: Number(sale.amount),
          completed_at: sale.completed_at,
        })),
        topProducts: topProducts.map((product) => ({
          ...product,
          total_amount: Number(product.total_amount),
          total_sales: Number(product.total_sales),
        })),
      });
    } catch (error) {
      console.error("Erro ao buscar dados do dashboard:", error);
      res.status(500).json({ error: "Erro ao buscar dados do dashboard" });
    }
  }
}

module.exports = new PaymentController();
