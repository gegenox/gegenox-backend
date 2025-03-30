const db = require('../config/database');
const axios = require('axios');

class SettingsController {
  async getWebhooks(req, res) {
    try {
      const [webhooks] = await db.query(`
        SELECT * FROM discord_webhooks 
        ORDER BY created_at DESC
      `);
      res.json(webhooks);
    } catch (error) {
      res.status(500).json({ message: 'Erro ao buscar webhooks' });
    }
  }

  async saveWebhook(req, res) {
    try {
      const { url, name, description, active } = req.body;
      if (!url || !name) {
        return res.status(400).json({ message: 'URL e nome são obrigatórios' });
      }

      // Testar o webhook
      try {
        await axios.post(url, {
          content: '🔔 Webhook configurado com sucesso!'
        });
      } catch (error) {
        return res.status(400).json({ message: 'URL do webhook inválida' });
      }

      await db.query(`
        INSERT INTO discord_webhooks 
        (url, name, description, active, created_at, updated_at) 
        VALUES (?, ?, ?, ?, NOW(), NOW())
      `, [url, name, description, active ? 1 : 0]);

      res.json({ message: 'Webhook salvo com sucesso' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao salvar webhook' });
    }
  }

  async updateWebhook(req, res) {
    try {
      const { id } = req.params;
      const { url, name, description, active } = req.body;

      if (!url || !name) {
        return res.status(400).json({ message: 'URL e nome são obrigatórios' });
      }

      // Testar o webhook
      try {
        await axios.post(url, {
          content: '🔔 Webhook atualizado com sucesso!'
        });
      } catch (error) {
        return res.status(400).json({ message: 'URL do webhook inválida' });
      }

      await db.query(`
        UPDATE discord_webhooks 
        SET url = ?, name = ?, description = ?, active = ?, updated_at = NOW()
        WHERE id = ?
      `, [url, name, description, active ? 1 : 0, id]);

      res.json({ message: 'Webhook atualizado com sucesso' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao atualizar webhook' });
    }
  }

  async deleteWebhook(req, res) {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM discord_webhooks WHERE id = ?', [id]);
      res.json({ message: 'Webhook removido com sucesso' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao remover webhook' });
    }
  }

  async getPaymentSettings(req, res) {
    try {
      const [settings] = await db.query('SELECT * FROM payment_settings LIMIT 1');
      res.json(settings[0] || {});
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
      res.status(500).json({ message: 'Erro ao buscar configurações' });
    }
  }

  async updatePaymentSettings(req, res) {
    const { pixup_api_user, pixup_api_secret } = req.body;
    
    try {
      const [existing] = await db.query('SELECT id FROM payment_settings LIMIT 1');
      
      if (existing.length > 0) {
        await db.query(
          'UPDATE payment_settings SET pixup_api_user = ?, pixup_api_secret = ?',
          [pixup_api_user, pixup_api_secret]
        );
      } else {
        await db.query(
          'INSERT INTO payment_settings (pixup_api_user, pixup_api_secret) VALUES (?, ?)',
          [pixup_api_user, pixup_api_secret]
        );
      }
      
      res.json({ message: 'Configurações atualizadas com sucesso' });
    } catch (error) {
      console.error('Erro ao atualizar configurações:', error);
      res.status(500).json({ message: 'Erro ao atualizar configurações' });
    }
  }

  async getCrispSettings(req, res) {
    try {
      const [settings] = await db.query('SELECT * FROM crisp_settings LIMIT 1');
      res.json(settings[0] || { website_id: '' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao buscar configurações do Crisp' });
    }
  }

  async updateCrispSettings(req, res) {
    const { website_id } = req.body;
    try {
      const [existing] = await db.query('SELECT id FROM crisp_settings LIMIT 1');
      
      if (existing.length > 0) {
        await db.query(
          'UPDATE crisp_settings SET website_id = ?',
          [website_id]
        );
      } else {
        await db.query(
          'INSERT INTO crisp_settings (website_id) VALUES (?)',
          [website_id]
        );
      }
      
      res.json({ message: 'Configurações do Crisp atualizadas com sucesso' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao atualizar configurações do Crisp' });
    }
  }
}

module.exports = new SettingsController(); 