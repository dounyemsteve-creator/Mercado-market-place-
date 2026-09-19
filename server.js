/**
 * ============================================================
 * MERCADO — Production Server
 * ============================================================
 *
 * Features:
 * - Express
 * - GatePay.to payments
 * - Telegram order notifications
 * - eBay Browse API
 * - Resend / SMTP email
 * - Local products
 * - Orders
 * - Reviews
 * - Availability subscriptions
 * - Product view tracking
 * - Admin order access
 *
 * Node.js 18+
 * ============================================================
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

/* ============================================================
   CONFIG
============================================================ */

const PORT = Number(process.env.PORT || 10000);

const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

const CORS_ORIGIN =
  process.env.CORS_ORIGIN || "*";

const FRONTEND_SUCCESS_URL =
  process.env.FRONTEND_SUCCESS_URL ||
  `${PUBLIC_BASE_URL}/#confirm`;

const FRONTEND_CANCEL_URL =
  process.env.FRONTEND_CANCEL_URL ||
  `${PUBLIC_BASE_URL}/#payment`;

/* ============================================================
   GATEPAY
============================================================ */

const GATEPAY_API =
  "https://api.gatepay.to/pay.php";

const GATEPAY_WALLET =
  process.env.GATEPAY_WALLET_ADDRESS || "";

/* ============================================================
   EBAY
============================================================ */

const EBAY_CLIENT_ID =
  process.env.EBAY_CLIENT_ID || "";

const EBAY_CLIENT_SECRET =
  process.env.EBAY_CLIENT_SECRET || "";

const EBAY_ENVIRONMENT =
  String(
    process.env.EBAY_ENVIRONMENT || "production"
  ).toLowerCase();

const EBAY_API_BASE =
  EBAY_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

const EBAY_TOKEN_URL =
  `${EBAY_API_BASE}/identity/v1/oauth2/token`;

const EBAY_BROWSE_URL =
  `${EBAY_API_BASE}/buy/browse/v1/item_summary/search`;

/*
 * eBay application tokens are cached in memory.
 */
let ebayToken = null;
let ebayTokenExpiresAt = 0;

/* ============================================================
   EXPRESS
============================================================ */

app.use(
  cors({
    origin: CORS_ORIGIN
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

/* ============================================================
   STATIC WEBSITE
============================================================ */

const PUBLIC_DIR =
  path.join(__dirname, "public");

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res) => {
      res.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate"
      );
    }
  })
);

/* ============================================================
   DATA DIRECTORY
============================================================ */

const DATA_DIR =
  path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

const PRODUCTS_FILE =
  path.join(
    DATA_DIR,
    "products.json"
  );

const SUBSCRIBERS_FILE =
  path.join(
    DATA_DIR,
    "subscribers.json"
  );

const REVIEWS_FILE =
  path.join(
    DATA_DIR,
    "reviews.json"
  );

const PRODUCT_VIEWS_FILE =
  path.join(
    DATA_DIR,
    "product-views.json"
  );

const ORDERS_FILE =
  path.join(
    DATA_DIR,
    "orders.json"
  );

/* ============================================================
   FILE HELPERS
============================================================ */

function readJSON(file, fallback) {

  try {

    if (!fs.existsSync(file)) {
      return fallback;
    }

    const content =
      fs.readFileSync(
        file,
        "utf8"
      );

    if (!content.trim()) {
      return fallback;
    }

    return JSON.parse(content);

  } catch (error) {

    console.error(
      `JSON read error: ${path.basename(file)}`,
      error.message
    );

    return fallback;
  }
}

function writeJSON(file, data) {

  fs.writeFileSync(
    file,
    JSON.stringify(
      data,
      null,
      2
    ),
    "utf8"
  );
}

function ensureJSONFile(file) {

  if (!fs.existsSync(file)) {
    writeJSON(file, []);
  }
}

[
  PRODUCTS_FILE,
  SUBSCRIBERS_FILE,
  REVIEWS_FILE,
  PRODUCT_VIEWS_FILE,
  ORDERS_FILE
].forEach(ensureJSONFile);

/* ============================================================
   UTILITY
============================================================ */

function createId(prefix = "M") {

  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
}

function safeNumber(value, fallback = 0) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/* ============================================================
   HEALTH CHECK
============================================================ */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "MERCADO",
      payment: "GatePay.to",
      ebay:
        Boolean(
          EBAY_CLIENT_ID &&
          EBAY_CLIENT_SECRET
        ),
      telegram:
        Boolean(
          process.env.TELEGRAM_BOT_TOKEN &&
          process.env.TELEGRAM_CHAT_ID
        ),
      time:
        new Date().toISOString()
    });
  }
);

/* ============================================================
   LOCAL PRODUCTS
============================================================ */

app.get(
  "/api/products",
  (req, res) => {

    const products =
      readJSON(
        PRODUCTS_FILE,
        []
      );

    res.json({
      ok: true,
      products
    });
  }
);

/* ============================================================
   GET ONE LOCAL PRODUCT
============================================================ */

app.get(
  "/api/products/:id",
  (req, res) => {

    const products =
      readJSON(
        PRODUCTS_FILE,
        []
      );

    const product =
      products.find(
        item =>
          String(item.id) ===
          String(req.params.id)
      );

    if (!product) {

      return res.status(404).json({
        ok: false,
        error: "Product not found."
      });
    }

    res.json({
      ok: true,
      product
    });
  }
);

/* ============================================================
   EMAIL
============================================================ */

function createEmailTransporter() {

  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  ) {

    return nodemailer.createTransport({

      host:
        process.env.SMTP_HOST,

      port:
        Number(
          process.env.SMTP_PORT || 587
        ),

      secure:
        String(
          process.env.SMTP_SECURE
        ).toLowerCase() === "true",

      auth: {
        user:
          process.env.SMTP_USER,

        pass:
          process.env.SMTP_PASS
      }
    });
  }

  return null;
}

async function sendEmail({
  to,
  subject,
  html,
  text
}) {

  /*
   * Resend
   */

  if (process.env.RESEND_API_KEY) {

    const response =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${process.env.RESEND_API_KEY}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({

            from:
              process.env.RESEND_FROM ||
              "MERCADO <onboarding@resend.dev>",

            to: [to],

            subject,

            html,

            text
          })
        }
      );

    if (!response.ok) {

      const errorText =
        await response.text();

      throw new Error(
        `Resend error: ${errorText}`
      );
    }

    return true;
  }

  /*
   * SMTP
   */

  const transporter =
    createEmailTransporter();

  if (!transporter) {

    console.warn(
      "No email provider configured."
    );

    return false;
  }

  await transporter.sendMail({

    from:
      process.env.SMTP_FROM ||
      process.env.SMTP_USER,

    to,

    subject,

    text,

    html
  });

  return true;
}

/* ============================================================
   EMAIL VERIFICATION
============================================================ */

const verificationCodes =
  new Map();

app.post(
  "/api/email/send",
  async (req, res) => {

    try {

      const email =
        String(
          req.body?.email || ""
        )
        .trim()
        .toLowerCase();

      if (!email) {

        return res.status(400).json({
          ok: false,
          error: "Email required."
        });
      }

      const code =
        String(
          Math.floor(
            1000 +
            Math.random() * 9000
          )
        );

      verificationCodes.set(
        email,
        {
          code,

          expiresAt:
            Date.now() +
            10 * 60 * 1000
        }
      );

      await sendEmail({

        to: email,

        subject:
          "MERCADO — Email verification",

        text:
          `Your MERCADO verification code is ${code}. It expires in 10 minutes.`,

        html:
          `<p>Your MERCADO verification code is:</p>
           <h2>${code}</h2>
           <p>This code expires in 10 minutes.</p>`
      });

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Email verification error:",
        error.message
      );

      res.status(500).json({
        ok: false,
        error:
          "Unable to send verification email."
      });
    }
  }
);

app.post(
  "/api/email/verify",
  (req, res) => {

    const email =
      String(
        req.body?.email || ""
      )
      .trim()
      .toLowerCase();

    const code =
      String(
        req.body?.code || ""
      ).trim();

    const saved =
      verificationCodes.get(
        email
      );

    if (!saved) {

      return res.status(400).json({
        ok: false,
        error:
          "No verification code found."
      });
    }

    if (
      Date.now() >
      saved.expiresAt
    ) {

      verificationCodes.delete(
        email
      );

      return res.status(400).json({
        ok: false,
        error:
          "Verification code expired."
      });
    }

    if (
      saved.code !== code
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "Invalid verification code."
      });
    }

    verificationCodes.delete(
      email
    );

    res.json({
      ok: true,
      verified: true
    });
  }
);

/* ============================================================
   TELEGRAM
============================================================ */

async function sendTelegram(message) {

  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {

    console.warn(
      "Telegram is not configured."
    );

    return false;
  }

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          chat_id:
            chatId,

          text:
            message,

          disable_web_page_preview:
            true
        })
      }
    );

  if (!response.ok) {

    const error =
      await response.text();

    console.error(
      "Telegram error:",
      error
    );

    return false;
  }

  return true;
}

/* ============================================================
   TELEGRAM ORDER MESSAGE
============================================================ */

function buildOrderMessage(order) {

  let message =
    "🛒 MERCADO — NEW ORDER\n\n";

  message +=
    `Order ID: ${order.orderId}\n`;

  message +=
    `Payment: ${order.paymentMethod || "Unknown"}\n`;

  message +=
    `Status: ${order.paymentStatus || "pending"}\n`;

  message +=
    `Total: €${safeNumber(order.total).toFixed(2)}\n`;

  message +=
    `Date: ${order.createdAt || new Date().toISOString()}\n\n`;

  message +=
    "👤 CUSTOMER\n";

  const customer =
    order.customer || {};

  message +=
    `Name: ${customer.name || "-"}\n`;

  message +=
    `Email: ${customer.email || "-"}\n`;

  message +=
    `Phone: ${customer.phone || "-"}\n`;

  message +=
    `Address: ${customer.address || "-"}\n\n`;

  message +=
    "📦 ITEMS\n";

  const items =
    Array.isArray(order.items)
      ? order.items
      : [];

  items.forEach(
    (item, index) => {

      const quantity =
        Number(
          item.qty ||
          item.quantity ||
          1
        );

      message +=
        `\n${index + 1}. ${item.name || "Product"}\n`;

      message +=
        `Price: €${safeNumber(item.price).toFixed(2)}\n`;

      message +=
        `Quantity: ${quantity}\n`;

      if (item.desc) {

        message +=
          `Description: ${item.desc}\n`;
      }

      if (item.sourceUrl) {

        message +=
          `Link: ${item.sourceUrl}\n`;
      }

      if (item.itemUrl) {

        message +=
          `Product: ${item.itemUrl}\n`;
      }
    }
  );

  return message;
}

/* ============================================================
   CREATE ORDER
============================================================ */

app.post(
  "/api/order",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        String(
          body.orderId ||
          createId("MERCADO")
        );

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      /*
       * Prevent duplicate order IDs.
       */

      const existing =
        orders.find(
          order =>
            String(order.orderId) ===
            orderId
        );

      if (existing) {

        return res.json({
          ok: true,
          orderId,
          existing: true
        });
      }

      const order = {

        ...body,

        orderId,

        total:
          Number(
            body.total || 0
          ),

        paymentStatus:
          "pending",

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString()
      };

      orders.push(order);

      writeJSON(
        ORDERS_FILE,
        orders
      );

      /*
       * Telegram receives the order.
       */

      await sendTelegram(
        buildOrderMessage(order)
      );

      res.json({
        ok: true,
        orderId
      });

    } catch (error) {

      console.error(
        "Order creation error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Unable to create order."
      });
    }
  }
);

/* ============================================================
   GATEPAY — CREATE CHECKOUT
============================================================ */

app.post(
  "/api/payment/gatepay",
  async (req, res) => {

    try {

      if (!GATEPAY_WALLET) {

        return res.status(500).json({
          ok: false,
          error:
            "GATEPAY_WALLET_ADDRESS is not configured."
        });
      }

      const body =
        req.body || {};

      const orderId =
        String(
          body.orderId || ""
        ).trim();

      const total =
        Number(
          body.total
        );

      if (!orderId) {

        return res.status(400).json({
          ok: false,
          error:
            "orderId is required."
        });
      }

      if (
        !Number.isFinite(total) ||
        total <= 0
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid payment amount."
        });
      }

      const amount =
        total.toFixed(2);

      const callbackUrl =
        `${PUBLIC_BASE_URL}/api/payment/gatepay/callback`;

      /*
       * Make sure order exists.
       */

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      let index =
        orders.findIndex(
          order =>
            String(order.orderId) ===
            orderId
        );

      if (index === -1) {

        const order = {

          ...body,

          orderId,

          total,

          paymentMethod:
            "gatepay",

          paymentStatus:
            "pending",

          createdAt:
            new Date().toISOString(),

          updatedAt:
            new Date().toISOString()
        };

        orders.push(order);

        index =
          orders.length - 1;

      } else {

        orders[index] = {

          ...orders[index],

          ...body,

          orderId,

          total,

          paymentMethod:
            "gatepay",

          paymentStatus:
            orders[index]
              .paymentStatus === "paid"
              ? "paid"
              : "pending",

          updatedAt:
            new Date().toISOString()
        };
      }

      writeJSON(
        ORDERS_FILE,
        orders
      );

      /*
       * GatePay request.
       */

      const payload = {

        wallet:
          GATEPAY_WALLET,

        amount,

        currency:
          process.env.GATEPAY_CURRENCY ||
          "EUR",

        callback_url:
          callbackUrl
      };

      console.log(
        "Creating GatePay payment:",
        {
          orderId,
          amount
        }
      );

      const response =
        await fetch(
          GATEPAY_API,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Accept":
                "application/json"
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const raw =
        await response.text();

      let data;

      try {

        data =
          JSON.parse(raw);

      } catch {

        data = {
          raw
        };
      }

      if (!response.ok) {

        console.error(
          "GatePay error:",
          response.status,
          data
        );

        return res.status(502).json({
          ok: false,
          error:
            "GatePay payment creation failed.",
          details:
            data
        });
      }

      /*
       * Accept the common URL fields returned
       * by the gateway integration.
       */

      const paymentUrl =
        data?.payment_url ||
        data?.checkout_url ||
        data?.url ||
        data?.checkout ||
        data?.payment?.url ||
        data?.data?.payment_url ||
        data?.data?.checkout_url ||
        data?.data?.url;

      if (!paymentUrl) {

        console.error(
          "GatePay response without checkout URL:",
          data
        );

        return res.status(502).json({
          ok: false,
          error:
            "GatePay did not return a checkout URL.",
          response:
            data
        });
      }

      orders[index].gatepay = {

        paymentUrl,

        response:
          data,

        createdAt:
          new Date().toISOString()
      };

      orders[index].updatedAt =
        new Date().toISOString();

      writeJSON(
        ORDERS_FILE,
        orders
      );

      res.json({

        ok: true,

        orderId,

        payment_url:
          paymentUrl,

        checkout_url:
          paymentUrl,

        success_url:
          FRONTEND_SUCCESS_URL,

        cancel_url:
          FRONTEND_CANCEL_URL
      });

    } catch (error) {

      console.error(
        "GatePay create error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Internal GatePay error."
      });
    }
  }
);

/* ============================================================
   GATEPAY — CALLBACK
============================================================ */

app.post(
  "/api/payment/gatepay/callback",
  async (req, res) => {

    try {

      const callback =
        req.body || {};

      console.log(
        "GatePay callback:",
        JSON.stringify(
          callback
        )
      );

      /*
       * We keep the complete callback.
       * This is useful because the exact callback
       * payload must be confirmed from the actual
       * GatePay integration response.
       */

      const possibleIds = [

        callback.order_id,

        callback.orderId,

        callback.merchant_order_id,

        callback.reference,

        callback.invoice_id,

        callback.payment_id,

        callback.order
      ];

      const orderId =
        possibleIds.find(
          value =>
            value !== undefined &&
            value !== null &&
            String(value).trim()
        );

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      if (!orderId) {

        console.warn(
          "GatePay callback has no order ID."
        );

        return res.status(200).json({
          ok: true,
          received: true,
          matched: false
        });
      }

      const index =
        orders.findIndex(
          order =>
            String(order.orderId) ===
            String(orderId)
        );

      if (index === -1) {

        console.warn(
          "Unknown GatePay order:",
          orderId
        );

        return res.status(200).json({
          ok: true,
          received: true,
          matched: false
        });
      }

      const status =
        String(
          callback.status ||
          callback.payment_status ||
          callback.state ||
          callback.result ||
          ""
        ).toLowerCase();

      const paidStatuses = [

        "paid",

        "completed",

        "complete",

        "success",

        "successful",

        "confirmed",

        "confirmed_payment"
      ];

      const failedStatuses = [

        "failed",

        "failure",

        "cancelled",

        "canceled",

        "expired",

        "declined"
      ];

      orders[index].gatepayCallback =
        callback;

      orders[index].updatedAt =
        new Date().toISOString();

      if (
        paidStatuses.includes(
          status
        )
      ) {

        const wasPaid =
          orders[index]
            .paymentStatus ===
          "paid";

        orders[index]
          .paymentStatus =
          "paid";

        orders[index]
          .paidAt =
          orders[index]
            .paidAt ||
          new Date().toISOString();

        writeJSON(
          ORDERS_FILE,
          orders
        );

        /*
         * Send a second Telegram message only
         * when payment becomes confirmed.
         */

        if (!wasPaid) {

          await sendTelegram(
            "✅ PAYMENT CONFIRMED\n\n" +
            buildOrderMessage(
              orders[index]
            )
          );
        }

      } else if (
        failedStatuses.includes(
          status
        )
      ) {

        orders[index]
          .paymentStatus =
          "failed";

        writeJSON(
          ORDERS_FILE,
          orders
        );

      } else {

        /*
         * Unknown status:
         * save callback but NEVER assume paid.
         */

        writeJSON(
          ORDERS_FILE,
          orders
        );
      }

      res.status(200).json({
        ok: true,
        received: true
      });

    } catch (error) {

      console.error(
        "GatePay callback error:",
        error
      );

      res.status(500).json({
        ok: false
      });
    }
  }
);

/* ============================================================
   EBAY OAUTH
============================================================ */

async function getEbayApplicationToken() {

  if (
    !EBAY_CLIENT_ID ||
    !EBAY_CLIENT_SECRET
  ) {

    throw new Error(
      "eBay API credentials are not configured."
    );
  }

  /*
   * Reuse token until shortly before expiration.
   */

  if (
    ebayToken &&
    Date.now() <
      ebayTokenExpiresAt
  ) {

    return ebayToken;
  }

  const credentials =
    Buffer
      .from(
        `${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`
      )
      .toString(
        "base64"
      );

  const response =
    await fetch(
      EBAY_TOKEN_URL,
      {
        method: "POST",

        headers: {

          "Content-Type":
            "application/x-www-form-urlencoded",

          "Authorization":
            `Basic ${credentials}`
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            scope:
              "https://api.ebay.com/oauth/api_scope"
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    console.error(
      "eBay OAuth error:",
      data
    );

    throw new Error(
      data.error_description ||
      "Unable to obtain eBay access token."
    );
  }

  ebayToken =
    data.access_token;

  const expiresIn =
    Number(
      data.expires_in ||
      7200
    );

  /*
   * Refresh 60 seconds before expiration.
   */

  ebayTokenExpiresAt =
    Date.now() +
    Math.max(
      60,
      expiresIn - 60
    ) * 1000;

  return ebayToken;
}

/* ============================================================
   EBAY SEARCH
============================================================ */

app.get(
  "/api/catalog/search",
  async (req, res) => {

    try {

      const query =
        String(
          req.query.q || ""
        ).trim();

      if (!query) {

        return res.status(400).json({
          ok: false,
          error:
            "Search query is required."
        });
      }

      const country =
        String(
          req.query.country ||
          "US"
        ).toUpperCase();

      const limit =
        Math.min(
          Math.max(
            Number(
              req.query.limit || 20
            ),
            1
          ),
          50
        );

      const token =
        await getEbayApplicationToken();

      const params =
        new URLSearchParams();

      params.set(
        "q",
        query
      );

      params.set(
        "limit",
        String(limit)
      );

      /*
       * Fixed-price products are normally
       * more suitable for an ecommerce catalog.
       */

      params.set(
        "filter",
        "buyingOptions:{FIXED_PRICE}"
      );

      const response =
        await fetch(
          `${EBAY_BROWSE_URL}?${params}`,
          {
            headers: {

              "Authorization":
                `Bearer ${token}`,

              "X-EBAY-C-MARKETPLACE-ID":
                `EBAY_${country}`,

              "Accept":
                "application/json"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok) {

        return res.status(
          response.status
        ).json({
          ok: false,
          error:
            "eBay search failed.",
          details:
            data
        });
      }

      res.json({

        ok: true,

        query,

        country,

        total:
          data.total || 0,

        items:
          data.itemSummaries || []
      });

    } catch (error) {

      console.error(
        "eBay search error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* ============================================================
   EBAY ITEM
============================================================ */

app.get(
  "/api/catalog/item/:itemId",
  async (req, res) => {

    try {

      const itemId =
        String(
          req.params.itemId || ""
        ).trim();

      if (!itemId) {

        return res.status(400).json({
          ok: false,
          error:
            "Item ID required."
        });
      }

      const token =
        await getEbayApplicationToken();

      const response =
        await fetch(
          `${EBAY_API_BASE}/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
          {
            headers: {

              "Authorization":
                `Bearer ${token}`,

              "X-EBAY-C-MARKETPLACE-ID":
                "EBAY_US",

              "Accept":
                "application/json"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok) {

        return res.status(
          response.status
        ).json({
          ok: false,
          error:
            "eBay item lookup failed.",
          details:
            data
        });
      }

      res.json({
        ok: true,
        item: data
      });

    } catch (error) {

      console.error(
        "eBay item error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* ============================================================
   REVIEWS
============================================================ */

app.get(
  "/api/reviews",
  (req, res) => {

    const reviews =
      readJSON(
        REVIEWS_FILE,
        []
      );

    const productId =
      req.query.productId;

    if (!productId) {

      return res.json({
        ok: true,
        reviews
      });
    }

    const filtered =
      reviews.filter(
        review =>
          String(
            review.productId
          ) ===
          String(productId)
      );

    res.json({
      ok: true,
      reviews: filtered
    });
  }
);

app.post(
  "/api/reviews",
  (req, res) => {

    const body =
      req.body || {};

    const productId =
      String(
        body.productId || ""
      ).trim();

    const rating =
      Number(
        body.rating
      );

    const comment =
      String(
        body.comment || ""
      ).trim();

    if (!productId) {

      return res.status(400).json({
        ok: false,
        error:
          "productId is required."
      });
    }

    if (
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 5
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "Rating must be between 1 and 5."
      });
    }

    if (!comment) {

      return res.status(400).json({
        ok: false,
        error:
          "Review comment is required."
      });
    }

    const reviews =
      readJSON(
        REVIEWS_FILE,
        []
      );

    const review = {

      id:
        createId("REV"),

      productId,

      name:
        String(
          body.name ||
          "Customer"
        ).trim(),

      rating,

      comment,

      createdAt:
        new Date().toISOString()
    };

    reviews.push(review);

    writeJSON(
      REVIEWS_FILE,
      reviews
    );

    res.json({
      ok: true,
      review
    });
  }
);

/* ============================================================
   PRODUCT VIEWS
============================================================ */

app.post(
  "/api/track-view",
  (req, res) => {

    const body =
      req.body || {};

    const views =
      readJSON(
        PRODUCT_VIEWS_FILE,
        []
      );

    views.push({

      id:
        createId("VIEW"),

      email:
        String(
          body.email || ""
        ).trim(),

      product:
        body.product || {},

      viewedAt:
        new Date().toISOString(),

      reminded:
        false
    });

    /*
     * Keep only the latest 500 records.
     */

    writeJSON(
      PRODUCT_VIEWS_FILE,
      views.slice(-500)
    );

    res.json({
      ok: true
    });
  }
);

/* ============================================================
   AVAILABILITY SUBSCRIBERS
============================================================ */

app.post(
  "/api/notify/subscribe",
  (req, res) => {

    const email =
      String(
        req.body?.email || ""
      )
      .trim()
      .toLowerCase();

    const query =
      String(
        req.body?.query || ""
      ).trim();

    if (!email) {

      return res.status(400).json({
        ok: false,
        error:
          "Email is required."
      });
    }

    const subscribers =
      readJSON(
        SUBSCRIBERS_FILE,
        []
      );

    const alreadySubscribed =
      subscribers.some(
        item =>
          item.email === email &&
          item.query === query
      );

    if (
      !alreadySubscribed
    ) {

      subscribers.push({

        id:
          createId("SUB"),

        email,

        query,

        createdAt:
          new Date().toISOString()
      });

      writeJSON(
        SUBSCRIBERS_FILE,
        subscribers
      );
    }

    res.json({
      ok: true
    });
  }
);

/* ============================================================
   BANK TRANSFER
============================================================ */

app.get(
  "/api/payment/bank-info",
  (req, res) => {

    res.json({

      ok: true,

      beneficiary:
        process.env.BANK_BENEFICIARY ||
        "",

      bank:
        process.env.BANK_NAME ||
        "",

      iban:
        process.env.BANK_IBAN ||
        "",

      bic:
        process.env.BANK_BIC ||
        ""
    });
  }
);

/* ============================================================
   ADMIN AUTH
============================================================ */

function requireAdmin(req, res, next) {

  const adminKey =
    process.env.ADMIN_KEY;

  if (!adminKey) {

    return res.status(503).json({
      ok: false,
      error:
        "Admin key is not configured."
    });
  }

  const provided =
    req.headers[
      "x-admin-key"
    ];

  if (
    !provided ||
    provided !== adminKey
  ) {

    return res.status(401).json({
      ok: false,
      error:
        "Unauthorized."
    });
  }

  next();
}

/* ============================================================
   ADMIN — ORDERS
============================================================ */

app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {

    const orders =
      readJSON(
        ORDERS_FILE,
        []
      );

    res.json({
      ok: true,
      orders
    });
  }
);

/* ============================================================
   ADMIN — ORDER BY ID
============================================================ */

app.get(
  "/api/admin/orders/:orderId",
  requireAdmin,
  (req, res) => {

    const orders =
      readJSON(
        ORDERS_FILE,
        []
      );

    const order =
      orders.find(
        item =>
          String(
            item.orderId
          ) ===
          String(
            req.params.orderId
          )
      );

    if (!order) {

      return res.status(404).json({
        ok: false,
        error:
          "Order not found."
      });
    }

    res.json({
      ok: true,
      order
    });
  }
);

/* ============================================================
   ADMIN — SUBSCRIBERS
============================================================ */

app.get(
  "/api/admin/subscribers",
  requireAdmin,
  (req, res) => {

    const subscribers =
      readJSON(
        SUBSCRIBERS_FILE,
        []
      );

    res.json({
      ok: true,
      subscribers
    });
  }
);

/* ============================================================
   SPA FALLBACK
============================================================ */

app.get(
  "*",
  (req, res) => {

    const indexFile =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(indexFile)
    ) {

      return res.sendFile(
        indexFile
      );
    }

    res.status(404).send(
      "MERCADO: public/index.html not found."
    );
  }
);

/* ============================================================
   START
============================================================ */

app.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      "MERCADO SERVER STARTED"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `URL: ${PUBLIC_BASE_URL}`
    );

    console.log(
      `GatePay: ${
        GATEPAY_WALLET
          ? "configured"
          : "NOT configured"
      }`
    );

    console.log(
      `eBay: ${
        EBAY_CLIENT_ID &&
        EBAY_CLIENT_SECRET
          ? "configured"
          : "NOT configured"
      }`
    );

    console.log(
      `Telegram: ${
        process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_CHAT_ID
          ? "configured"
          : "NOT configured"
      }`
    );

    console.log(
      "================================="
    );
  }
);
