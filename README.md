# MERCADO

MERCADO is an ecommerce website with a Node.js/Express backend.

## Requirements

- Node.js 18 or newer
- eBay Developer credentials
- GatePay wallet address
- Telegram bot credentials (optional)
- Email provider (optional)
- Render account

## Project Structure

MERCADO/
├── package.json
├── server.js
├── README.md
├── public/
│   └── index.html
└── data/
    ├── products.json
    ├── subscribers.json
    ├── reviews.json
    ├── product-views.json
    └── orders.json

## eBay

MERCADO uses the eBay Browse API.

Required:

EBAY_CLIENT_ID=YOUR_EBAY_APP_ID
EBAY_CLIENT_SECRET=YOUR_EBAY_CERT_ID

The server automatically obtains the eBay access token.

## GatePay

MERCADO uses GatePay.to for cryptocurrency payments.

Wallet address:

0xB7414134da31fE43473bA28c38dDfc825BE021eE

Currency:

EUR

## Telegram

Telegram can be used to receive order notifications.

Required environment variables:

TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_CHAT_ID

## Render

Build Command:

npm install

Start Command:

npm start

Add the required environment variables in:

Render → Web Service → Environment

## Security

Never publish:

- EBAY_CLIENT_SECRET
- TELEGRAM_BOT_TOKEN
- RESEND_API_KEY
- SMTP_PASS
- ADMIN_KEY

These must be stored as environment variables on Render.

## Start

npm install

npm start
