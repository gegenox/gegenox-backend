const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class CategoryController {
  async index(req, res) {
    try {
      const [categories] = await db.query(`
        SELECT 
          c.*,
          COUNT(p.id) as total_products,
          SUM(p.sold) as total_sold,
          SUM(p.stock) as total_stock
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        GROUP BY c.id
        ORDER BY c.id ASC  -- Ordenar por ID para prioridade
      `);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async store(req, res) {
    const { id, name } = req.body;
    
    try {
      const [existing] = await db.query('SELECT id FROM categories WHERE id = ?', [id]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'ID já está em uso. Escolha outro ID.' });
      }

      await db.query('INSERT INTO categories (id, name) VALUES (?, ?)', [id, name]);
      
      const [newCategory] = await db.query('SELECT * FROM categories WHERE id = ?', [id]);
      res.status(201).json(newCategory[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async show(req, res) {
    const { id } = req.params;
    try {
      const [category] = await db.query(`
        SELECT 
          c.*,
          COUNT(p.id) as total_products,
          SUM(p.sold) as total_sold,
          SUM(p.stock) as total_stock
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        WHERE c.id = ?
        GROUP BY c.id
      `, [id]);

      if (category.length === 0) {
        return res.status(404).json({ message: 'Categoria não encontrada' });
      }

      const [products] = await db.query('SELECT * FROM products WHERE category_id = ?', [id]);
      
      res.json({
        ...category[0],
        products
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async update(req, res) {
    const { id } = req.params;
    const { name, newId } = req.body;
    
    try {
      await db.query('START TRANSACTION');

      if (newId && newId !== id) {
        const [existing] = await db.query('SELECT id FROM categories WHERE id = ?', [newId]);
        if (existing.length > 0) {
          await db.query('ROLLBACK');
          return res.status(400).json({ error: 'O novo ID já está em uso' });
        }

        await db.query('UPDATE categories SET id = ?, name = ? WHERE id = ?', [newId, name, id]);
        
        await db.query('UPDATE products SET category_id = ? WHERE category_id = ?', [newId, id]);
      } else {
        await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
      }

      await db.query('COMMIT');

      const [updatedCategory] = await db.query(`
        SELECT 
          c.*,
          COUNT(p.id) as total_products,
          SUM(CASE WHEN si.status = 'AVAILABLE' THEN 1 ELSE 0 END) as total_stock,
          SUM(CASE WHEN si.status = 'SOLD' THEN 1 ELSE 0 END) as total_sold
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id
        LEFT JOIN stock_items si ON p.id = si.product_id
        WHERE c.id = ?
        GROUP BY c.id
      `, [newId || id]);

      res.json(updatedCategory[0]);
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Erro ao atualizar categoria:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async delete(req, res) {
    const { id } = req.params;
    try {
      await db.query('START TRANSACTION');

      const [products] = await db.query('SELECT image FROM products WHERE category_id = ?', [id]);

      for (const product of products) {
        if (product.image?.startsWith('/uploads/')) {
          try {
            await fs.unlink(path.join('public', product.image));
          } catch (err) {
            console.error('Erro ao deletar imagem:', err);
          }
        }
      }

      await db.query('DELETE FROM products WHERE category_id = ?', [id]);
      
      await db.query('DELETE FROM categories WHERE id = ?', [id]);

      await db.query('COMMIT');
      res.json({ message: 'Categoria e produtos relacionados deletados com sucesso' });
    } catch (error) {
      await db.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new CategoryController(); 