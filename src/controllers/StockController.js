const db = require('../config/database');

class StockController {
  constructor() {
    // Iniciar verificação periódica do estoque
    this.startStockCheck();
  }

  // Função para iniciar a verificação periódica
  startStockCheck() {
    // Verificar a cada 5 minutos
    setInterval(async () => {
      try {
        console.log('Iniciando verificação periódica de estoque...');
        await this.checkAllProductsStock();
      } catch (error) {
        console.error('Erro na verificação periódica de estoque:', error);
      }
    }, 5 * 60 * 1000); // 5 minutos em milissegundos
  }

  // Função para verificar o estoque de todos os produtos
  async checkAllProductsStock() {
    try {
      // Buscar todos os produtos ativos
      const [products] = await db.query('SELECT id FROM products WHERE status = "DISPONÍVEL"');

      for (const product of products) {
        await this.checkAndRefillStock(product.id);
      }
    } catch (error) {
      console.error('Erro ao verificar estoque de todos os produtos:', error);
    }
  }

  async addItems(req, res) {
    console.log('Recebendo requisição:', req.body);
    const { product_id, items } = req.body;

    try {
      if (!product_id || !items || !Array.isArray(items)) {
        return res.status(400).json({ 
          error: 'Dados inválidos. Necessário product_id e array de items' 
        });
      }

      const [product] = await db.query('SELECT * FROM products WHERE id = ?', [product_id]);
      
      if (product.length === 0) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }

      const values = items.map(code => [product_id, code.trim(), 'AVAILABLE']);
      
      await db.query(
        'INSERT INTO stock_items (product_id, code, status) VALUES ?',
        [values]
      );

      await db.query(
        `UPDATE products SET 
         stock = (SELECT COUNT(*) FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE')
         WHERE id = ?`,
        [product_id, product_id]
      );

      res.status(201).json({ message: 'Itens adicionados ao estoque' });
    } catch (error) {
      console.error('Erro ao adicionar itens:', error);
      res.status(500).json({ error: 'Erro ao adicionar itens ao estoque' });
    }
  }

  async listItems(req, res) {
    const { product_id } = req.params;
    const { status } = req.query;

    try {
      let query = `
        SELECT 
          si.*,
          p.customer_email as sold_to,
          p.customer_name,
          p.external_id as transaction_id,
          p.completed_at as sale_date
        FROM stock_items si
        LEFT JOIN payments p ON p.id = si.payment_id
        WHERE si.product_id = ?
      `;
      
      const params = [product_id];

      if (status) {
        query += ' AND si.status = ?';
        params.push(status);
      }

      query += ' ORDER BY si.created_at DESC';

      const [items] = await db.query(query, params);
      
      // Formatar os dados
      const formattedItems = items.map(item => ({
        ...item,
        sold_to: item.sold_to || '-',
        customer_name: item.customer_name || '-',
        transaction_id: item.transaction_id || '-',
        sale_date: item.sale_date ? new Date(item.sale_date).toLocaleString() : '-'
      }));

      res.json(formattedItems);
    } catch (error) {
      console.error('Erro ao listar itens:', error);
      res.status(500).json({ error: 'Erro ao listar itens do estoque' });
    }
  }

  async markAsSold(req, res) {
    const { item_id } = req.params;
    const { email } = req.body;

    try {
      await db.query('START TRANSACTION');

      // Obter informações do item antes de marcar como vendido
      const [itemInfo] = await db.query(
        'SELECT product_id FROM stock_items WHERE id = ?',
        [item_id]
      );

      if (!itemInfo || itemInfo.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Item não encontrado' });
      }

      const productId = itemInfo[0].product_id;

      // Marcar item como vendido
      await db.query(
        'UPDATE stock_items SET status = ?, email = ?, sold_at = NOW() WHERE id = ?',
        ['SOLD', email, item_id]
      );

      await db.query('COMMIT');

      // Após marcar como vendido, verificar e reabastecer se necessário
      await this.checkAndRefillStock(productId);

      res.json({ message: 'Item marcado como vendido com sucesso' });
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Erro ao marcar item como vendido:', error);
      res.status(500).json({ error: 'Erro ao marcar item como vendido' });
    }
  }

  async getNextAvailable(req, res) {
    const { product_id } = req.params;

    try {
      const [item] = await db.query(
        'SELECT * FROM stock_items WHERE product_id = ? AND status = "AVAILABLE" ORDER BY created_at ASC LIMIT 1',
        [product_id]
      );

      if (item.length === 0) {
        return res.status(404).json({ error: 'Nenhum item disponível' });
      }

      res.json(item[0]);
    } catch (error) {
      console.error('Erro ao obter próximo item:', error);
      res.status(500).json({ error: 'Erro ao obter próximo item disponível' });
    }
  }

  async removeItems(req, res) {
    const { items } = req.body;

    try {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Lista de itens inválida' });
      }

      await db.query(
        'DELETE FROM stock_items WHERE id IN (?) AND status = "AVAILABLE"',
        [items]
      );

      const [affectedProducts] = await db.query(
        'SELECT DISTINCT product_id FROM stock_items WHERE id IN (?)',
        [items]
      );

      for (const { product_id } of affectedProducts) {
        await db.query(
          `UPDATE products SET 
           stock = (SELECT COUNT(*) FROM stock_items WHERE product_id = ? AND status = 'AVAILABLE')
           WHERE id = ?`,
          [product_id, product_id]
        );
      }

      res.json({ message: 'Itens removidos com sucesso' });
    } catch (error) {
      console.error('Erro ao remover itens:', error);
      res.status(500).json({ error: 'Erro ao remover itens do estoque' });
    }
  }

  async updateItem(req, res) {
    const { id } = req.params;
    const { code } = req.body;

    try {
      const [existing] = await db.query(
        'SELECT id FROM stock_items WHERE code = ? AND id != ?',
        [code, id]
      );

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Código já está em uso' });
      }

      await db.query(
        'UPDATE stock_items SET code = ? WHERE id = ?',
        [code, id]
      );

      res.json({ message: 'Item atualizado com sucesso' });
    } catch (error) {
      console.error('Erro ao atualizar item:', error);
      res.status(500).json({ error: 'Erro ao atualizar item' });
    }
  }

  async checkAndRefillStock(productId) {
    try {
      // Códigos de reabastecimento automático
      const autoRefillCodes = [
        '4Z7X7-QFQ93-ZNDXD',
        'UM3V8-M82L4-6YF9C',
        '8G4CR-WT4D5-AFQYJ',
        '77CXB-ZP4QH-H6NS4',
        '2T7MN-NLTRJ-2G6D8',
        'JTVLQ-444D2-FP6Q7'
      ];

      // Verificar estoque atual
      const [currentStock] = await db.query(
        `SELECT COUNT(*) as stock_count 
         FROM stock_items 
         WHERE product_id = ? AND status = 'AVAILABLE'`,
        [productId]
      );

      console.log(`Verificando produto ${productId} - Estoque atual: ${currentStock[0].stock_count}`);

      // Se o estoque for igual a 2, adicionar os códigos
      if (currentStock[0].stock_count <= 2) {
        console.log(`Reabastecendo produto ${productId} automaticamente`);
        
        // Verificar se os códigos já existem para este produto
        for (const code of autoRefillCodes) {
          const [existingCode] = await db.query(
            'SELECT id FROM stock_items WHERE product_id = ? AND code = ?',
            [productId, code]
          );

          if (existingCode.length === 0) {
            // Inserir apenas se o código não existir
            await db.query(
              'INSERT INTO stock_items (product_id, code, status, created_at) VALUES (?, ?, ?, NOW())',
              [productId, code, 'AVAILABLE']
            );
            console.log(`Código ${code} adicionado ao produto ${productId}`);
          }
        }

        // Atualizar o contador de estoque no produto
        await db.query(
          `UPDATE products p 
           SET p.stock = (
             SELECT COUNT(*) 
             FROM stock_items si 
             WHERE si.product_id = p.id AND si.status = 'AVAILABLE'
           )
           WHERE p.id = ?`,
          [productId]
        );

        console.log(`Produto ${productId} reabastecido com sucesso`);
      }
    } catch (error) {
      console.error(`Erro ao verificar/reabastecer estoque do produto ${productId}:`, error);
    }
  }
}

module.exports = new StockController(); 