const db = require('../config/database');

class CartController {
  async addToCart(req, res) {
    const { product_id, quantity } = req.body;
    const session_id = req.sessionID;

    try {
      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        const [existingItem] = await connection.query(
          'SELECT id, quantity FROM cart_items WHERE session_id = ? AND product_id = ?',
          [session_id, product_id]
        );

        if (existingItem.length > 0) {
          await connection.query(
            'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
            [quantity, existingItem[0].id]
          );
        } else {
          await connection.query(
            'INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)',
            [session_id, product_id, quantity]
          );
        }

        await connection.commit();

        const [cartItems] = await connection.query(`
          SELECT 
            c.id,
            c.product_id,
            c.quantity,
            p.name,
            p.description,
            p.price as current_price,
            p.old_price,
            p.image_url
          FROM cart_items c
          JOIN products p ON c.product_id = p.id
          WHERE c.session_id = ?`,
          [session_id]
        );

        const total = cartItems.reduce((sum, item) => {
          return sum + (parseFloat(item.current_price) * item.quantity);
        }, 0);

        res.json({
          message: 'Produto adicionado ao carrinho',
          items: cartItems,
          total: total.toFixed(2)
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro ao adicionar ao carrinho:', error);
      res.status(500).json({ error: 'Erro ao adicionar ao carrinho' });
    }
  }

  async removeFromCart(req, res) {
    const { product_id } = req.params;
    const { item_ids } = req.body;
    const session_id = req.sessionID;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Remover o item do carrinho
      await connection.query(
        'DELETE FROM cart_items WHERE session_id = ? AND product_id = ?',
        [session_id, product_id]
      );

      // Liberar os itens reservados se houver
      if (item_ids && item_ids.length > 0) {
        await connection.query(`
          UPDATE stock_items 
          SET status = 'AVAILABLE' 
          WHERE id IN (?) AND status = 'RESERVED'
        `, [item_ids]);
      }

      // Buscar o carrinho atualizado
      const [cartItems] = await connection.query(`
        SELECT 
          c.id,
          c.product_id,
          c.quantity,
          p.name,
          p.description,
          CAST(p.price AS DECIMAL(10,2)) as current_price,
          CAST(p.old_price AS DECIMAL(10,2)) as old_price,
          p.image_url,
          (SELECT COUNT(*) FROM stock_items 
           WHERE product_id = p.id 
           AND status = 'AVAILABLE') as available_quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
        WHERE c.session_id = ?`,
        [session_id]
      );

      const total = cartItems.reduce((sum, item) => {
        return sum + (parseFloat(item.current_price) * item.quantity);
      }, 0);

      await connection.commit();

      res.json({
        message: 'Produto removido do carrinho',
        items: cartItems.map(item => ({
          ...item,
          price: parseFloat(item.current_price).toFixed(2),
          current_price: parseFloat(item.current_price).toFixed(2),
          old_price: item.old_price ? parseFloat(item.old_price).toFixed(2) : null,
          available: item.available_quantity >= item.quantity
        })),
        total: total.toFixed(2)
      });

    } catch (error) {
      await connection.rollback();
      console.error('Erro ao remover do carrinho:', error);
      res.status(500).json({ error: 'Erro ao remover do carrinho' });
    } finally {
      connection.release();
    }
  }

  async getCart(req, res) {
    try {
      const connection = await db.getConnection();
      
      const [cartItems] = await connection.query(`
        SELECT 
          c.id,
          c.product_id,
          c.quantity,
          p.name,
          p.description,
          CAST(p.price AS DECIMAL(10,2)) as current_price,
          CAST(p.old_price AS DECIMAL(10,2)) as old_price,
          p.image_url,
          (SELECT COUNT(*) FROM stock_items 
           WHERE product_id = p.id 
           AND status = 'AVAILABLE') as available_quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
        WHERE c.session_id = ?`,
        [req.sessionID]
      );

      console.log('Preços dos itens:', cartItems.map(item => ({
        name: item.name,
        price: item.current_price,
        type: typeof item.current_price
      })));

      const total = cartItems.reduce((sum, item) => {
        const itemPrice = parseFloat(item.current_price);
        const itemTotal = itemPrice * item.quantity;
        console.log(`Item: ${item.name}, Preço: ${itemPrice}, Quantidade: ${item.quantity}, Total: ${itemTotal}`);
        return sum + itemTotal;
      }, 0);

      res.json({
        items: cartItems.map(item => ({
          ...item,
          price: parseFloat(item.current_price).toFixed(2),
          current_price: parseFloat(item.current_price).toFixed(2),
          old_price: item.old_price ? parseFloat(item.old_price).toFixed(2) : null,
          available: item.available_quantity >= item.quantity
        })),
        total: total.toFixed(2)
      });
    } catch (error) {
      console.error('Erro ao buscar carrinho:', error);
      res.status(500).json({ error: 'Erro ao buscar carrinho' });
    }
  }

  async updateQuantity(req, res) {
    const { product_id } = req.params;
    const { quantity } = req.body;
    const session_id = req.sessionID;

    try {
      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        await connection.query(
          'UPDATE cart_items SET quantity = ? WHERE session_id = ? AND product_id = ?',
          [quantity, session_id, product_id]
        );

        await connection.commit();

        const [cartItems] = await connection.query(`
          SELECT 
            c.id,
            c.product_id,
            c.quantity,
            p.name,
            p.description,
            p.price as current_price,
            p.old_price,
            p.image_url
          FROM cart_items c
          JOIN products p ON c.product_id = p.id
          WHERE c.session_id = ?`,
          [session_id]
        );

        const total = cartItems.reduce((sum, item) => {
          return sum + (parseFloat(item.current_price) * item.quantity);
        }, 0);

        res.json({
          items: cartItems,
          total: total.toFixed(2)
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Erro ao atualizar quantidade:', error);
      res.status(500).json({ error: 'Erro ao atualizar quantidade' });
    }
  }

  async clearCart(req, res) {
    const session_id = req.sessionID;

    try {
      await db.query('DELETE FROM cart_items WHERE session_id = ?', [session_id]);
      res.json({ message: 'Carrinho limpo' });
    } catch (error) {
      console.error('Erro ao limpar carrinho:', error);
      res.status(500).json({ error: 'Erro ao limpar carrinho' });
    }
  }
}

module.exports = new CartController(); 