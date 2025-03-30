const axios = require('axios');
const crypto = require('crypto');

const pixupConfig = {
  baseUrl: 'https://api.pixupbr.com/v2',
  credentials: {
    clientId: process.env.PIXUP_API_USER,
    clientSecret: process.env.PIXUP_API_SECRET
  },
  webhookSecret: process.env.PIXUP_WEBHOOK_SECRET,

  async getAccessToken() {
    try {
      const basicToken = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');
      const response = await axios.post(
        `${this.baseUrl}/oauth/token`,
        { grant_type: 'client_credentials' },
        {
          headers: {
            'Authorization': `Basic ${basicToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.access_token;
    } catch (error) {
      console.error('Erro ao obter token:', error);
      throw error;
    }
  },

  validateWebhookSignature(payload, signature) {
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const calculatedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(calculatedSignature)
    );
  },

  async createPayment(data) {
    const token = await this.getAccessToken();
    return axios.post(
      `${this.baseUrl}/pix/qrcode`,
      {
        ...data,
        expiration: 300,
        postbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  },

  async checkPaymentStatus(external_id) {
    const token = await this.getAccessToken();
    return axios.get(
      `${this.baseUrl}/pix/qrcode/${external_id}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
  },

  async makeRequest(path, method, data = null) {
    try {
      const token = await this.getAccessToken();
      
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Erro na requisição:', error);
      throw error;
    }
  }
};

module.exports = pixupConfig; 