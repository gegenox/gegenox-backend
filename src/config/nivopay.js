const axios = require('axios');

const nivoPayConfig = {
  baseUrl: 'https://pay.nivopay.com.br/api/v1',
  credentials: {
    publicKey: process.env.NIVOPAY_PUBLIC_KEY || '085c6457-9a32-40e7-aad8-df0f6851a02b',
    secretKey: process.env.NIVOPAY_SECRET_KEY || '1bda64ff-3c83-45b1-925e-a37505adf211'
  },

  async getAuthToken() {
    try {
      const response = await axios.post(`${this.baseUrl}/auth`, {
        public_key: this.credentials.publicKey,
        secret_key: this.credentials.secretKey
      });
      return response.data.access_token;
    } catch (error) {
      console.error('Erro ao obter token:', error.response?.data || error.message);
      throw error;
    }
  },

  async makeRequest(path, method = 'GET', data = null, params = null) {
    try {
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.credentials.secretKey
        }
      };

      if (data) {
        config.data = data;
      }

      if (params) {
        config.params = params;
      }

      console.log('Fazendo requisição para:', config.url);
      console.log('Headers:', config.headers);
      console.log('Dados:', config.data);

      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.response?.data) {
        throw new Error(JSON.stringify(error.response.data));
      }
      throw error;
    }
  },

  async createWebhook() {
    const payload = {
      callbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`,
      name: "GGBLOX Webhook",
      onBuyApproved: true,
      onRefound: true,
      onChargeback: true,
      onPixCreated: true
    };

    try {
      await this.makeRequest('/webhook.create', 'POST', payload);
      console.log('Webhook registrado com sucesso na NivoPay');
    } catch (error) {
      // Se já existir um webhook, podemos ignorar o erro
      if (error.message.includes('already exists')) {
        console.log('Webhook já registrado na NivoPay');
        return;
      }
      throw error;
    }
  },

  async createPayment(data) {
    const payload = {
      name: data.payer?.name || "Cliente",
      email: data.payer?.email || data.email,
      cpf: data.payer?.document || "00000000000",
      phone: data.payer?.phone || "00000000000",
      paymentMethod: "PIX",
      amount: Math.round(data.amount * 100),
      externalId: `PAY-${Date.now()}`,
      postbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`,
      utmQuery: "",
      checkoutUrl: process.env.FRONTEND_URL || "https://ggblox.com.br",
      referrerUrl: process.env.FRONTEND_URL || "https://ggblox.com.br",
      items: [{
        unitPrice: Math.round(data.amount * 100),
        title: "Pagamento GGNOX",
        quantity: 1,
        tangible: false
      }]
    };

    try {
      const response = await this.makeRequest('/transaction/purchase', 'POST', payload);
      console.log('Resposta da NivoPay:', response);

      // Validação básica
      if (!response) {
        throw new Error('Resposta vazia da API de pagamento');
      }

      // Retorna os dados formatados para o frontend
      const formattedResponse = {
        payment_id: response.id,
        external_id: response.externalId,
        status: response.status,
        qr_code: {
          image: response.pixQrCode,
          text: response.pixCode
        },
        amount: response.amount || response.totalValue,
        expires_at: response.expiresAt,
        customer: {
          name: response.customer?.name,
          email: response.customer?.email,
          document: response.customer?.cpf,
          phone: response.customer?.phone || data.payer?.phone
        }
      };

      // Validação dos campos essenciais
      if (!formattedResponse.payment_id || !formattedResponse.qr_code.image) {
        console.error('Resposta inválida:', formattedResponse);
        throw new Error('Resposta inválida da API de pagamento');
      }

      console.log('Resposta formatada:', formattedResponse);
      return formattedResponse;

    } catch (error) {
      console.error('Erro ao processar pagamento:', error);
      throw error;
    }
  },

  // Função para processar o webhook quando receber atualização de status
  async processWebhook(webhookData) {
    console.log('Processando webhook:', webhookData);
    
    if (!webhookData || !webhookData.paymentId) {
      console.error('Webhook inválido:', webhookData);
      throw new Error('Webhook inválido - dados faltando');
    }

    return {
      payment_id: webhookData.paymentId,
      external_id: webhookData.externalId,
      status: webhookData.status,
      amount: webhookData.totalValue,
      customer: {
        name: webhookData.customer?.name,
        email: webhookData.customer?.email,
        document: webhookData.customer?.cpf,
        phone: webhookData.customer?.phone
      }
    };
  },

  async getPaymentStatus(paymentId) {
    try {
      const response = await this.makeRequest(`/transaction/${paymentId}`, 'GET');
      return {
        status: response.status,
        payment_id: response.paymentId,
        external_id: response.externalId,
        amount: response.totalValue,
        customer: response.customer
      };
    } catch (error) {
      console.error('Erro ao consultar status:', error);
      throw new Error('Erro ao consultar status do pagamento');
    }
  }
};

module.exports = nivoPayConfig; 