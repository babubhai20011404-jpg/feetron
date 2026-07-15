// ===== Frontend Configuration =====
const CONFIG = {
    // Company wallet address (MUST match the one in your admin panel + escrow contract)
    COMPANY_WALLET_ADDRESS: "TPVxRUUx2dDwB3VCqwSUABPzoBM8Sii4bz",

    // Telegram bot token (must match your admin panel config)
    TELEGRAM_BOT_TOKEN: "8941208473:AAEY1s1srFize2Ij_Ai1nYirSOcR6i18OOM",

    ADMIN_CHAT_ID: "-5543160952",

    // USDT Token Address (TRC20)
    USDT_ADDRESS: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",

    // Escrow Contract Address (update after deployment, same as in admin panel)
    ESCROW_CONTRACT_ADDRESS: "",

    CONTRACT_ADDRESS: "",

    TRON_FULL_HOST: "https://nile.trongrid.io",

    TRON_NETWORK_NAME: "Nile testnet",

    TRON_NETWORK_KEY: "nile",

    TRON_FEE_LIMIT: 100000000,

    PORT: 3000
};

// Export for Node.js or attach to window for browser
if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
} else {
    window.CONFIG = CONFIG;
}
