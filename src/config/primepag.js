const axios = require('axios');
const crypto = require('crypto');

const primepagConfig = {
  baseUrl: 'https://api.primepag.com.br',
  credentials: {
    clientId: process.env.PRIMEPAG_CLIENT_ID || '371efc97-8e0f-4301-a2cf-36db65853c01',
    clientSecret: process.env.PRIMEPAG_CLIENT_SECRET || '1ff40e7f-4e34-42fb-86d8-19593b7438fe'
  },

  async getAccessToken() {
    try {
      const basicAuth = Buffer.from(
        `${this.credentials.clientId}:${this.credentials.clientSecret}`
      ).toString('base64');

      console.log('Tentando autenticar com:', {
        url: `${this.baseUrl}/auth/generate_token`,
        basicAuth: `Basic ${basicAuth}`
      });

      const response = await axios.post(
        `${this.baseUrl}/auth/generate_token`,
        {
          grant_type: 'client_credentials'
        },
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Resposta da autenticação:', response.data);

      if (!response.data || !response.data.access_token) {
        throw new Error('Token não retornado pela API');
      }

      return response.data.access_token;
    } catch (error) {
      console.error('Erro ao obter token PrimePag:', {
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers
      });
      throw error;
    }
  },

  async makeRequest(path, method = 'GET', data = null) {
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

      console.log('Requisição PrimePag:', {
        url: config.url,
        method: config.method,
        data: config.data,
        headers: config.headers
      });

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Erro na requisição PrimePag:', {
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers
      });
      throw error;
    }
  },

  async createPayment(data) {
    try {
      // Ajustando o payload conforme documentação da PrimePag para QRCode
      const payload = {
        value_cents: Math.round(data.amount * 100),
        generator_name: data.payer?.name || "Cliente GGBLOX",
        // Usando um CPF válido para testes - você deve ajustar isso conforme necessário
        generator_document: "59014948816", // CPF válido para testes
        expiration_time: data.expiresIn || 300,
        external_reference: data.external_id
      };

      console.log('Criando QRCode com payload:', payload);

      const response = await this.makeRequest('/v1/pix/qrcodes', 'POST', payload);

      console.log('Resposta da criação de QRCode:', response);

      // Adaptando a resposta para o formato esperado pelo sistema
      return {
        payment_id: response.qrcode.reference_code,
        external_id: response.qrcode.external_reference,
        status: 'pending',
        qr_code: {
          image: response.qrcode.image_base64,
          text: response.qrcode.content
        },
        amount: payload.value_cents / 100,
        expires_at: new Date(Date.now() + (payload.expiration_time * 1000)).toISOString(),
        customer: {
          name: payload.generator_name,
          document: data.payer?.document || "59014948816",
          email: data.payer?.email
        }
      };
    } catch (error) {
      console.error('Erro ao criar QRCode PrimePag:', error);
      throw error;
    }
  },

  async getPaymentStatus(paymentId) {
    try {
      const response = await this.makeRequest(`/charges/${paymentId}`);
      
      return {
        status: this.mapStatus(response.status),
        payment_id: response.id,
        external_id: response.external_id,
        amount: response.amount / 100,
        customer: {
          name: response.payer.name,
          email: response.payer.email,
          document: response.payer.tax_id
        }
      };
    } catch (error) {
      console.error('Erro ao consultar status PrimePag:', error);
      throw error;
    }
  },

  // Mapeia os status da PrimePag para o formato usado internamente
  mapStatus(primepagStatus) {
    const statusMap = {
      'pending': 'pending',
      'processing': 'pending',
      'paid': 'APPROVED',
      'completed': 'APPROVED',
      'canceled': 'failed',
      'failed': 'failed'
    };
    return statusMap[primepagStatus.toLowerCase()] || primepagStatus;
  },

  async setupWebhook() {
    try {
      // URL do webhook com porta e caminho completo
      const webhookUrl = 'https://ggnox.com:21135/api/payments/webhooks';
      
      const webhookData = {
        url: webhookUrl,
        authorization: process.env.PRIMEPAG_WEBHOOK_AUTH || 'GGNOX-AUTH'
      };

      console.log('Configurando webhook PrimePag:', webhookData);

      // Configurar webhook para QRCodes (webhook_type_id = 1)
      const response = await this.makeRequest('/v1/webhooks/1', 'POST', webhookData);

      console.log('Webhook configurado com sucesso:', response);
      return response;
    } catch (error) {
      console.error('Erro ao configurar webhook PrimePag:', error);
      throw error;
    }
  },

  validateWebhookSignature(webhookData) {
    try {
      const { message, md5: receivedMd5 } = webhookData;
      
      if (!message || !receivedMd5) {
        console.error('Dados do webhook inválidos');
        return false;
      }

      // Montar a string conforme documentação
      const stringToHash = `qrcode.${message.reference_code}.${message.end_to_end}.${message.value_cents}.${process.env.PRIMEPAG_SECRET_KEY}`;
      
      // Gerar o hash MD5
      const calculatedMd5 = crypto
        .createHash('md5')
        .update(stringToHash)
        .digest('hex');

      // Comparar os hashes
      const isValid = calculatedMd5 === receivedMd5;
      
      console.log('Validação do webhook:', {
        received: receivedMd5,
        calculated: calculatedMd5,
        isValid,
        stringToHash
      });

      return isValid;
    } catch (error) {
      console.error('Erro ao validar assinatura do webhook:', error);
      return false;
    }
  },

  async processWebhook(webhookData) {
    console.log('Processando webhook PrimePag:', webhookData);
    
    const { message } = webhookData;

    if (!message || !message.reference_code) {
      throw new Error('Webhook inválido - dados faltando');
    }

    return {
      payment_id: message.reference_code,
      external_id: message.external_reference,
      status: message.status,
      amount: message.value_cents / 100,
      customer: {
        name: message.generator_name,
        document: message.generator_document
      },
      payer: {
        name: message.payer_name,
        document: message.payer_document
      },
      payment_date: message.payment_date,
      end_to_end: message.end_to_end
    };
  }
};

module.exports = primepagConfig; 