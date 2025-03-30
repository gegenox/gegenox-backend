const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class ProductController {
  async index(req, res) {
    const { category_id } = req.query;
    try {
      let query = `
        SELECT 
          p.*,
          p.sold as sold,
          COUNT(DISTINCT si.id) as total_stock,
          COUNT(DISTINCT CASE WHEN si.status = 'AVAILABLE' THEN si.id END) as available_stock,
          COUNT(DISTINCT CASE WHEN si.status = 'SOLD' THEN si.id END) as sold_count,
          GROUP_CONCAT(
            CASE WHEN si.status = 'AVAILABLE' 
            THEN si.code
            END
          ) as available_codes
        FROM products p
        LEFT JOIN stock_items si ON p.id = si.product_id
      `;

      let params = [];

      if (category_id) {
        query += ' WHERE p.category_id = ?';
        params.push(category_id);
      }

      query += ' GROUP BY p.id ORDER BY p.id ASC';

      const [products] = await db.query(query, params);

      const processedProducts = products.map(product => ({
        ...product,
        stock: parseInt(product.available_stock || 0),
        available_stock: parseInt(product.available_stock || 0),
        sold: parseInt(product.sold || 0),
        status: parseInt(product.available_stock || 0) > 0 ? 'DISPONÍVEL' : 'ESGOTADO',
        available_codes: product.available_codes ? product.available_codes.split(',') : []
      }));

      res.json(processedProducts);
    } catch (error) {
      console.error('Erro ao listar produtos:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async store(req, res) {
    const { 
      id,
      category_id, 
      name, 
      price, 
      old_price,
      description,
      video_url,
      sold,
      icon_url
    } = req.body;

    console.log('Dados recebidos:', {
      id,
      category_id,
      name,
      price,
      old_price,
      description,
      video_url,
      sold,
      icon_url
    });

    let image = null;
    
    try {
      // Validação dos campos obrigatórios
      if (!category_id) {
        console.log('Categoria não fornecida');
        return res.status(400).json({ error: 'Categoria é obrigatória' });
      }

      if (!name || !price) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
      }

      await db.query('START TRANSACTION');

      const [existing] = await db.query('SELECT id FROM products WHERE id = ?', [id]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'ID já está em uso. Escolha outro ID.' });
      }

      // Validar se a categoria existe
      const [categoryExists] = await db.query('SELECT id FROM categories WHERE id = ?', [category_id]);
      if (categoryExists.length === 0) {
        return res.status(400).json({ error: 'Categoria não encontrada' });
      }

      if (req.file) {
        image = `/uploads/${req.file.filename}`;
      } else if (req.body.image) {
        image = req.body.image;
      }

      const formattedPrice = parseFloat(price);
      const formattedOldPrice = old_price ? parseFloat(old_price) : null;
      const formattedSold = sold ? parseInt(sold) : 0;

      await db.query(
        `INSERT INTO products (
          id, category_id, name, price, old_price, 
          description, image, video_url, sold, icon_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id, 
          category_id, 
          name, 
          formattedPrice, 
          formattedOldPrice, 
          description, 
          image,
          video_url || '',
          formattedSold,
          icon_url || null
        ]
      );

      await db.query('COMMIT');
      
      const [newProduct] = await db.query(`
        SELECT 
          p.*,
          0 as available_stock,
          0 as sold_count
        FROM products p
        WHERE p.id = ?
      `, [id]);

      const product = {
        ...newProduct[0],
        stock: 0,
        sold: formattedSold,
        status: 'ESGOTADO'
      };

      res.status(201).json({ 
        ...product,
        message: 'Produto criado com sucesso'
      });
    } catch (error) {
      await db.query('ROLLBACK');
      if (req.file) {
        try {
          await fs.unlink(path.join('public/uploads', req.file.filename));
        } catch (err) {
          console.error('Erro ao deletar imagem:', err);
        }
      }
      console.error('Erro ao criar produto:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async update(req, res) {
    const { id } = req.params;
    let updateData = { ...req.body };
    
    try {
      await db.query('START TRANSACTION');

      const [existingProduct] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
      if (!existingProduct.length) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Produto não encontrado' });
      }

      if (req.file) {
        if (existingProduct[0].image?.startsWith('/uploads/')) {
          try {
            await fs.unlink(path.join('public', existingProduct[0].image));
          } catch (err) {
            console.error('Erro ao deletar imagem antiga:', err);
          }
        }
        updateData.image = `/uploads/${req.file.filename}`;
      } else if (updateData.image === '') {
        if (existingProduct[0].image?.startsWith('/uploads/')) {
          try {
            await fs.unlink(path.join('public', existingProduct[0].image));
          } catch (err) {
            console.error('Erro ao deletar imagem antiga:', err);
          }
        }
        updateData.image = null;
      }

      const formattedPrice = parseFloat(updateData.price);
      const formattedOldPrice = updateData.old_price ? parseFloat(updateData.old_price) : null;
      const formattedSold = parseInt(updateData.sold) || 0;

      const updates = {
        name: updateData.name,
        price: formattedPrice,
        old_price: formattedOldPrice,
        description: updateData.description,
        category_id: parseInt(updateData.category_id),
        image: updateData.image,
        video_url: updateData.video_url,
        sold: formattedSold,
        is_featured: updateData.is_featured === true || updateData.is_featured === 'true',
        icon_url: updateData.icon_url || null
      };

      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined || updates[key] === null) {
          delete updates[key];
        }
      });

      console.log('Dados para atualização:', updates);

      const updateQuery = 'UPDATE products SET ? WHERE id = ?';
      await db.query(updateQuery, [updates, id]);

      await db.query('COMMIT');
      
      const [updatedProduct] = await db.query(`
        SELECT 
          p.*,
          COUNT(DISTINCT CASE WHEN si.status = 'AVAILABLE' THEN si.id END) as available_stock,
          COUNT(DISTINCT CASE WHEN si.status = 'SOLD' THEN si.id END) as sold_count
        FROM products p
        LEFT JOIN stock_items si ON p.id = si.product_id
        WHERE p.id = ?
        GROUP BY p.id
      `, [id]);

      const product = {
        ...updatedProduct[0],
        stock: parseInt(updatedProduct[0].available_stock || 0),
        sold: parseInt(updatedProduct[0].sold_count || 0),
        status: parseInt(updatedProduct[0].available_stock || 0) > 0 ? 'DISPONÍVEL' : 'ESGOTADO'
      };

      res.json(product);
    } catch (error) {
      await db.query('ROLLBACK');
      if (req.file) {
        try {
          await fs.unlink(path.join('public/uploads', req.file.filename));
        } catch (err) {
          console.error('Erro ao deletar imagem:', err);
        }
      }
      console.error('Erro ao atualizar produto:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async delete(req, res) {
    const { id } = req.params;
    try {
      const [product] = await db.query('SELECT image FROM products WHERE id = ?', [id]);
      
      await db.query('DELETE FROM products WHERE id = ?', [id]);

      if (product[0]?.image?.startsWith('/uploads/')) {
        try {
          await fs.unlink(path.join('public', product[0].image));
        } catch (err) {
          console.error('Erro ao deletar imagem:', err);
        }
      }

      res.json({ message: 'Produto deletado com sucesso' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      // Remover qualquer texto e manter apenas os números
      const productId = id.replace(/\D/g, '');
      
      const [product] = await db.query(
        `SELECT 
          p.*, 
          c.name as category_name,
          p.sold as sold_count,
          (SELECT COUNT(*) FROM stock_items si 
           WHERE si.product_id = p.id AND si.status = 'AVAILABLE') as available_stock
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ?`,
        [productId]
      );

      if (!product || product.length === 0) {
        return res.status(404).json({ message: 'Produto não encontrado' });
      }

      // Formatar o produto antes de retornar
      const formattedProduct = {
        ...product[0],
        sold: parseInt(product[0].sold_count || 0),
        stock: parseInt(product[0].available_stock || 0),
        status: parseInt(product[0].available_stock || 0) > 0 ? 'DISPONÍVEL' : 'ESGOTADO'
      };

      res.json(formattedProduct);
    } catch (error) {
      console.error('Erro ao buscar produto:', error);
      res.status(500).json({ message: 'Erro ao buscar produto' });
    }
  }

  async getByCategory(req, res) {
    const { category_id } = req.query;

    try {
      const [products] = await db.query(`
        SELECT 
          p.*,
          COUNT(DISTINCT si.id) as total_stock,
          COUNT(DISTINCT CASE WHEN si.status = 'AVAILABLE' THEN si.id END) as available_stock,
          COUNT(DISTINCT CASE WHEN si.status = 'SOLD' THEN si.id END) as sold_count,
          GROUP_CONCAT(
            CASE WHEN si.status = 'AVAILABLE' 
            THEN JSON_OBJECT('id', si.id, 'code', si.code)
            END
          ) as stock_items
        FROM products p
        LEFT JOIN stock_items si ON p.id = si.product_id
        WHERE p.category_id = ?
        GROUP BY p.id
        ORDER BY p.id DESC
      `, [category_id]);

      const updatedProducts = products.map(product => {
        let stockItems = [];
        try {
          stockItems = product.stock_items
            ? product.stock_items.split(',')
                .map(item => {
                  try {
                    return JSON.parse(item);
                  } catch {
                    return null;
                  }
                })
                .filter(item => item !== null)
            : [];
        } catch (e) {
          console.error('Erro ao parsear stock_items:', e);
        }

        return {
          ...product,
          stock: parseInt(product.available_stock || 0),
          available_stock: parseInt(product.available_stock || 0),
          sold: parseInt(product.sold_count || 0),
          status: parseInt(product.available_stock || 0) > 0 ? 'DISPONÍVEL' : 'ESGOTADO',
          stock_items: stockItems
        };
      });

      res.json(updatedProducts);
    } catch (error) {
      console.error('Erro ao listar produtos:', error);
      res.status(500).json({ error: 'Erro ao listar produtos' });
    }
  }
}

module.exports = new ProductController(); 