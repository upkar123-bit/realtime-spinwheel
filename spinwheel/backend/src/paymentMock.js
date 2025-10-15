module.exports = {
  charge: async (userId, amountCents) => {
    // Simulate successful charge. In production, call Stripe API.
    return { success: true, txId: `tx_${Date.now()}` };
  }
};
