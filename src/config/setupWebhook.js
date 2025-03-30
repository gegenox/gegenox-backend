const nivoPayConfig = require('./nivopay');

async function setupWebhook() {
  try {
    // Primeiro, vamos verificar se já existe um webhook configurado
    const webhooksResponse = await nivoPayConfig.makeRequest('/webhook.getWebhooks', 'GET');
    
    if (webhooksResponse.result && webhooksResponse.result.length === 0) {
      // Se não existir webhook, vamos criar
      const webhookData = {
        callbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`,
        name: "GGNOX Payment Webhook",
        onBuyApproved: true,
        onRefound: true,
        onChargeback: true,
        onPixCreated: true
      };

      await nivoPayConfig.makeRequest('/webhook.create', 'POST', webhookData);
      console.log('Webhook configurado com sucesso!');
    }
  } catch (error) {
    console.error('Erro ao configurar webhook:', error);
  }
}

module.exports = setupWebhook; 