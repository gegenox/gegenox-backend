const db = require('../config/database');

class CouponController {
  async index(req, res) {
    try {
      const [coupons] = await db.query(`
        SELECT 
          c.*,
          COALESCE(c.total_sales, 0) as total_sales,
          COALESCE(c.total_discount, 0) as total_discount,
          COALESCE(c.times_used, 0) as times_used
        FROM coupons c
        ORDER BY id ASC
      `);
      res.json(coupons);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async store(req, res) {
    const { 
      id,
      code, 
      discount, 
      description, 
      expiration_date,
      min_purchase,
      max_discount,
      usage_limit,
      status 
    } = req.body;
    
    try {
      const [existing] = await db.query('SELECT code FROM coupons WHERE code = ?', [code]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Código já está em uso' });
      }

      await db.query(`
        INSERT INTO coupons (
          id, code, discount, description, expiration_date,
          min_purchase, max_discount, usage_limit, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, code, discount, description, expiration_date,
        min_purchase, max_discount, usage_limit, status
      ]);
      
      const [newCoupon] = await db.query('SELECT * FROM coupons WHERE id = ?', [id]);
      res.status(201).json(newCoupon[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async update(req, res) {
    const { id } = req.params;
    const { 
      code, 
      discount, 
      description, 
      expiration_date,
      min_purchase,
      max_discount,
      usage_limit,
      status 
    } = req.body;
    
    try {
      const [existing] = await db.query(
        'SELECT code FROM coupons WHERE code = ? AND id != ?', 
        [code, id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Código já está em uso' });
      }

      await db.query(`
        UPDATE coupons SET 
          code = ?, discount = ?, description = ?, 
          expiration_date = ?, min_purchase = ?,
          max_discount = ?, usage_limit = ?, status = ?
        WHERE id = ?
      `, [
        code, discount, description, expiration_date,
        min_purchase, max_discount, usage_limit, status, id
      ]);

      const [updatedCoupon] = await db.query('SELECT * FROM coupons WHERE id = ?', [id]);
      res.json(updatedCoupon[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async delete(req, res) {
    const { id } = req.params;
    try {
      await db.query('DELETE FROM coupons WHERE id = ?', [id]);
      res.json({ message: 'Cupom deletado com sucesso' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async validate(req, res) {
    const { code } = req.params;
    const { total } = req.query;
    
    try {
      const numericTotal = parseFloat(total);
      if (isNaN(numericTotal)) {
        return res.status(400).json({ error: 'Valor total inválido' });
      }

      console.log('Validando cupom:', { code, total: numericTotal }); 

      const [coupon] = await db.query(
        'SELECT * FROM coupons WHERE code = ?', 
        [code.toUpperCase()]
      );

      if (coupon.length === 0) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      const couponData = coupon[0];

      if (couponData.status !== 'ATIVO') {
        return res.status(400).json({ error: 'Cupom inativo' });
      }

      if (couponData.expiration_date && new Date(couponData.expiration_date) < new Date()) {
        return res.status(400).json({ error: 'Cupom expirado' });
      }

      if (couponData.usage_limit && couponData.times_used >= couponData.usage_limit) {
        return res.status(400).json({ error: 'Limite de uso do cupom atingido' });
      }

      if (couponData.min_purchase && numericTotal < parseFloat(couponData.min_purchase)) {
        return res.status(400).json({ 
          error: `Valor mínimo para este cupom: R$ ${parseFloat(couponData.min_purchase).toFixed(2)}` 
        });
      }

      res.json(couponData);
    } catch (error) {
      console.error('Erro na validação do cupom:', error);
      res.status(500).json({ error: 'Erro interno ao validar cupom' });
    }
  }
}

module.exports = new CouponController(); 